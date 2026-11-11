import logging
import mimetypes
from datetime import timedelta
from decimal import Decimal

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from core.emails import (
    EMAIL_TASK_OPTIONS,
    format_date,
    format_datetime,
    format_baggage,
    format_conditions,
    format_direction,
    format_price,
    format_segment_changes,
    send_email,
)
from catalog.itinerary import by_direction
from catalog.models import Trip
from core.models import AppSettings
from core.tenancy import for_each_tenant, queue, tenant_task

from .models import Booking

logger = logging.getLogger(__name__)


def _booking_in(booking_id, status):
    """The booking, or None when it is gone or no longer in the status the email describes."""
    return (
        Booking.objects.select_related("user", "offer__origin", "offer__destination", "offer__airline")
        .prefetch_related(*(f"segments__{field}" for field in ("airline", "operating_airline", "origin", "destination")))
        .filter(pk=booking_id, status=status)
        .first()
    )


def describe_booking(booking):
    offer = booking.offer
    flights = by_direction([segment.as_data() for segment in booking.segments.all()])
    arrow = "⇄" if booking.trip_type == Trip.TripType.RETURN else "→"
    return {
        "booking": booking,
        "route": (
            f"{offer.origin.city} ({offer.origin.code}) {arrow} {offer.destination.city} ({offer.destination.code})"
        ),
        "departure": format_date(offer.departure_date),
        "outbound_flights": format_direction(flights["outbound"]),
        "return_flights": format_direction(flights["return"]),
        "baggage": format_baggage(booking),
        "conditions": format_conditions(booking),
        "ticket_class": offer.get_ticket_class_display(),
        "total": format_price(booking.total_price),
    }


def describe_changes(booking):
    """Each change made on confirming as {label, old, new}, for the confirmation email; empty when there are none."""
    changes = booking.changes or {}
    described = []
    if "unit_price" in changes:
        old, new = (format_price(Decimal(changes["unit_price"][key])) for key in ("old", "new"))
        described.append({"label": "Price per person", "old": old, "new": new})
    if "segments" in changes:
        old, new = (format_segment_changes(changes["segments"][key]) for key in ("old", "new"))
        described.append({"label": "Flights", "old": old, "new": new})
    return described


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_admin_new_booking(booking_id):
    booking = _booking_in(booking_id, Booking.Status.REQUESTED)
    if booking is None:
        return
    details = describe_booking(booking)
    send_email(
        "new_booking",
        f"New booking from {booking.user.full_name}: {details['route']}",
        AppSettings.get().admin_notification_email,
        details,
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_availability_confirmed(booking_id):
    booking = _booking_in(booking_id, Booking.Status.AVAILABILITY_CONFIRMED)
    if booking is None:
        return
    send_email(
        "availability_confirmed",
        "Seats confirmed: please complete your payment",
        booking.user.email,
        {
            **describe_booking(booking),
            "payment_instructions": AppSettings.get().payment_instructions,
            "deadline": format_datetime(booking.payment_deadline),
            "changes": describe_changes(booking),
        },
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_unavailable(booking_id):
    booking = _booking_in(booking_id, Booking.Status.UNAVAILABLE)
    if booking is None:
        return
    context = describe_booking(booking)
    # Options suggested by the admin, in the one response of the alternatives request.
    response = booking.alternatives.responses.first() if booking.alternatives_id else None
    if response is not None:
        context.update(
            alternatives=booking.alternatives, message=response.message, option_count=response.offers.count()
        )
    send_email("unavailable", "Your booking could not be confirmed", booking.user.email, context)


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_payment_received(booking_id):
    booking = _booking_in(booking_id, Booking.Status.PAID)
    if booking is None:
        return
    send_email("payment_received", "Payment received", booking.user.email, describe_booking(booking))


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_booking_expired(booking_id):
    booking = _booking_in(booking_id, Booking.Status.EXPIRED)
    if booking is None:
        return
    send_email("booking_expired", "Your booking has expired", booking.user.email, describe_booking(booking))


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_boarding_passes(booking_id):
    booking = _booking_in(booking_id, Booking.Status.COMPLETED)
    if booking is None:
        return
    attachments = []
    for boarding_pass in booking.boarding_passes.all():
        with boarding_pass.file.open("rb") as file:
            content = file.read()
        mimetype = mimetypes.guess_type(boarding_pass.original_name)[0] or "application/octet-stream"
        attachments.append((boarding_pass.original_name, content, mimetype))
    send_email(
        "boarding_passes",
        f"Your boarding pass{'es' if len(attachments) > 1 else ''}: {describe_booking(booking)['route']}",
        booking.user.email,
        {**describe_booking(booking), "pass_count": len(attachments)},
        attachments,
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_customer_payment_reminder(booking_id):
    booking = _booking_in(booking_id, Booking.Status.AVAILABILITY_CONFIRMED)
    if booking is None or booking.payment_deadline <= timezone.now():
        return
    send_email(
        "payment_reminder",
        "Reminder: your payment is due soon",
        booking.user.email,
        {
            **describe_booking(booking),
            "payment_instructions": AppSettings.get().payment_instructions,
            "deadline": format_datetime(booking.payment_deadline),
        },
    )


# Scheduled tasks. bookings.services imports this module, so these import it lazily.


def _expire(booking_ids, from_status):
    from .services import InvalidTransition, transition

    expired = 0
    for booking_id in booking_ids:
        try:
            transition(booking_id, Booking.Status.EXPIRED, actor=None, from_status=from_status)
        except InvalidTransition:
            # Changed in the meantime, e.g. paid or cancelled.
            continue
        expired += 1
    return expired


@shared_task
def expire_unpaid_bookings():
    """Confirmed bookings whose payment deadline has passed, in every active tenant."""
    return for_each_tenant(_expire_unpaid_bookings, "expire_unpaid_bookings")


def _expire_unpaid_bookings():
    booking_ids = Booking.objects.filter(
        status=Booking.Status.AVAILABILITY_CONFIRMED, payment_deadline__lt=timezone.now()
    ).values_list("pk", flat=True)
    expired = _expire(list(booking_ids), Booking.Status.AVAILABILITY_CONFIRMED)
    logger.info("Expired %d unpaid booking(s).", expired)
    return expired


@shared_task
def expire_stale_requests():
    """Requested bookings whose flight has already departed, in every active tenant."""
    return for_each_tenant(_expire_stale_requests, "expire_stale_requests")


def _expire_stale_requests():
    booking_ids = Booking.objects.filter(
        status=Booking.Status.REQUESTED, offer__departure_date__lt=timezone.localdate()
    ).values_list("pk", flat=True)
    expired = _expire(list(booking_ids), Booking.Status.REQUESTED)
    logger.info("Expired %d stale booking request(s).", expired)
    return expired


def _reminder_due(now, hours_before):
    """Confirmed bookings, not yet reminded, within hours_before of their deadline."""
    return Booking.objects.filter(
        status=Booking.Status.AVAILABILITY_CONFIRMED,
        reminder_sent_at__isnull=True,
        payment_deadline__gt=now,
        payment_deadline__lte=now + timedelta(hours=hours_before),
    )


@shared_task
def send_payment_reminders():
    """Reminders for confirmed bookings near their payment deadline, in every active tenant."""
    return for_each_tenant(_send_payment_reminders, "send_payment_reminders")


def _send_payment_reminders():
    hours_before = AppSettings.get().reminder_hours_before
    sent = 0
    for booking_id in list(_reminder_due(timezone.now(), hours_before).values_list("pk", flat=True)):
        with transaction.atomic():
            # Re-check under the lock: the booking may have been paid, expired or reminded since.
            booking = _reminder_due(timezone.now(), hours_before).select_for_update().filter(pk=booking_id).first()
            if booking is None:
                continue
            booking.reminder_sent_at = timezone.now()
            booking.save(update_fields=["reminder_sent_at"])
            queue(notify_customer_payment_reminder, booking_id)
        sent += 1
    logger.info("Queued %d payment reminder(s).", sent)
    return sent
