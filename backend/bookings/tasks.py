import mimetypes

from celery import shared_task

from core.emails import EMAIL_TASK_OPTIONS, format_date, format_datetime, format_price, send_email
from core.models import AppSettings

from .models import Booking


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
