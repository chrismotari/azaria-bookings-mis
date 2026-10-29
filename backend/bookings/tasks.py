import logging
import mimetypes
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from core.emails import EMAIL_TASK_OPTIONS, format_date, format_datetime, format_price, send_email
from core.models import AppSettings

from .models import Booking

logger = logging.getLogger(__name__)


def _booking_in(booking_id, status):
    """The booking, or None when it is gone or no longer in the status the email describes."""
    return (
        Booking.objects.select_related("user", "offering__origin", "offering__destination")
        .filter(pk=booking_id, status=status)
        .first()
    )


def describe_booking(booking):
    offering = booking.offering
    return {
        "booking": booking,
        "route": (
            f"{offering.origin.city} ({offering.origin.code}) → {offering.destination.city} ({offering.destination.code})"
        ),
        "departure": format_date(offering.departure_date),
        "ticket_class": offering.get_ticket_class_display(),
        "total": format_price(booking.total_price),
    }


@shared_task(**EMAIL_TASK_OPTIONS)
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


@shared_task(**EMAIL_TASK_OPTIONS)
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
        },
    )


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_customer_unavailable(booking_id):
    booking = _booking_in(booking_id, Booking.Status.UNAVAILABLE)
    if booking is None:
        return
    send_email("unavailable", "Your booking could not be confirmed", booking.user.email, describe_booking(booking))


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_customer_payment_received(booking_id):
    booking = _booking_in(booking_id, Booking.Status.PAID)
    if booking is None:
        return
    send_email("payment_received", "Payment received", booking.user.email, describe_booking(booking))


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_customer_booking_expired(booking_id):
    booking = _booking_in(booking_id, Booking.Status.EXPIRED)
    if booking is None:
        return
    send_email("booking_expired", "Your booking has expired", booking.user.email, describe_booking(booking))


@shared_task(**EMAIL_TASK_OPTIONS)
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


@shared_task(**EMAIL_TASK_OPTIONS)
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


# Scheduled tasks (CELERY_BEAT_SCHEDULE). bookings.services imports this module for the email
# tasks, so these import it when they run.


def _expire(booking_ids):
    from .services import InvalidTransition, transition

    expired = 0
    for booking_id in booking_ids:
        try:
            transition(booking_id, Booking.Status.EXPIRED, actor=None)
        except InvalidTransition:
            # Changed in the meantime, e.g. paid or cancelled.
            continue
        expired += 1
    return expired


@shared_task
def expire_unpaid_bookings():
    """Confirmed bookings whose payment deadline has passed."""
    booking_ids = Booking.objects.filter(
        status=Booking.Status.AVAILABILITY_CONFIRMED, payment_deadline__lt=timezone.now()
    ).values_list("pk", flat=True)
    expired = _expire(list(booking_ids))
    logger.info("Expired %d unpaid booking(s).", expired)
    return expired


@shared_task
def expire_stale_requests():
    """Requested bookings whose flight has already departed."""
    booking_ids = Booking.objects.filter(
        status=Booking.Status.REQUESTED, offering__departure_date__lt=timezone.localdate()
    ).values_list("pk", flat=True)
    expired = _expire(list(booking_ids))
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
            transaction.on_commit(lambda booking_id=booking_id: notify_customer_payment_reminder.delay(booking_id))
        sent += 1
    logger.info("Queued %d payment reminder(s).", sent)
    return sent
