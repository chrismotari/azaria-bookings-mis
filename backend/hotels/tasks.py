import logging
import mimetypes
from decimal import Decimal

from django.utils import timezone

from core.emails import EMAIL_TASK_OPTIONS, format_date, format_datetime, format_price, send_email
from core.models import AppSettings
from core.tenancy import tenant_task

from .models import HotelBooking

logger = logging.getLogger(__name__)

Status = HotelBooking.Status


def _booking(booking_id, **state):
    """The booking, or None when it is gone or no longer in the state the email describes."""
    return (
        HotelBooking.objects.select_related("user", "hotel")
        .prefetch_related("rooms__travellers")
        .filter(pk=booking_id, **state)
        .first()
    )


def _count(count, one, many):
    return f"{count} {one if count == 1 else many}"


def _room_line(room):
    guests = list(room.travellers.all())
    people = _count(room.adults, "adult", "adults") + (
        f", {_count(room.children, 'child', 'children')}" if room.children else ""
    )
    lead = f"; lead guest {guests[0].full_name}" if guests else ""
    return f"{room.room_name}, {room.rate_name} ({people}{lead}): {format_price(room.price)}"


def describe_hotel_booking(booking):
    hotel = booking.hotel
    nights = booking.nights
    return {
        "booking": booking,
        "hotel": hotel,
        "dates": f"{format_date(booking.check_in)} – {format_date(booking.check_out)}",
        "nights": _count(nights, "night", "nights"),
        "times": f"Check-in from {hotel.check_in_time:%H:%M}, check-out by {hotel.check_out_time:%H:%M}",
        "rooms": "\n".join(_room_line(room) for room in booking.rooms.all()),
        "total": format_price(booking.total),
    }


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_admin_new_hotel_booking(booking_id):
    booking = _booking(booking_id, status=Status.REQUESTED, created_by__isnull=True)
    if booking is None:
        return
    send_email(
        "new_hotel_booking",
        f"New hotel booking from {booking.user.full_name}: {booking.hotel.name}",
        AppSettings.get().admin_notification_email,
        describe_hotel_booking(booking),
    )


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_customer_hotel_availability_confirmed(booking_id):
    booking = _booking(booking_id, status=Status.AVAILABILITY_CONFIRMED)
    if booking is None:
        return
    changes = booking.changes or {}
    send_email(
        "hotel_availability_confirmed",
        f"Rooms confirmed: please complete your payment for {booking.hotel.name}",
        booking.user.email,
        {
            **describe_hotel_booking(booking),
            "payment_instructions": AppSettings.get().payment_instructions,
            "deadline": format_datetime(booking.payment_deadline),
            "old_total": format_price(Decimal(changes["total"]["old"])) if changes else "",
            "new_total": format_price(Decimal(changes["total"]["new"])) if changes else "",
            "note": changes.get("note", ""),
        },
    )


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_customer_hotel_unavailable(booking_id):
    booking = _booking(booking_id, status=Status.UNAVAILABLE)
    if booking is None:
        return
    send_email(
        "hotel_unavailable",
        f"Your hotel booking could not be confirmed: {booking.hotel.name}",
        booking.user.email,
        {**describe_hotel_booking(booking), "message": booking.unavailable_message},
    )


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_customer_hotel_payment_received(booking_id):
    booking = _booking(booking_id, status=Status.PAID)
    if booking is None:
        return
    send_email(
        "hotel_payment_received",
        f"Payment received: {booking.hotel.name}",
        booking.user.email,
        describe_hotel_booking(booking),
    )


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_customer_hotel_booking_expired(booking_id):
    booking = _booking(booking_id, status=Status.EXPIRED)
    if booking is None:
        return
    send_email(
        "hotel_booking_expired",
        f"Your hotel booking has expired: {booking.hotel.name}",
        booking.user.email,
        describe_hotel_booking(booking),
    )


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_customer_hotel_payment_reminder(booking_id):
    booking = _booking(booking_id, status=Status.AVAILABILITY_CONFIRMED)
    if booking is None or booking.payment_deadline <= timezone.now():
        return
    send_email(
        "hotel_payment_reminder",
        f"Reminder: your payment for {booking.hotel.name} is due soon",
        booking.user.email,
        {
            **describe_hotel_booking(booking),
            "payment_instructions": AppSettings.get().payment_instructions,
            "deadline": format_datetime(booking.payment_deadline),
        },
    )


@tenant_task("hotels", **EMAIL_TASK_OPTIONS)
def notify_customer_hotel_voucher(booking_id):
    booking = _booking(booking_id, status=Status.COMPLETED)
    if booking is None:
        return
    attachments = []
    for voucher in booking.vouchers.all():
        with voucher.file.open("rb") as file:
            content = file.read()
        mimetype = mimetypes.guess_type(voucher.original_name)[0] or "application/octet-stream"
        attachments.append((voucher.original_name, content, mimetype))
    send_email(
        "hotel_voucher",
        f"Your hotel voucher: {booking.hotel.name}",
        booking.user.email,
        {**describe_hotel_booking(booking), "voucher_count": len(attachments)},
        attachments,
    )


# Scheduled jobs, run by the bookings app's tasks for agencies with hotels. hotels.services imports this module.


def expire_unpaid_hotel_bookings():
    from .services import expire_unpaid

    expired = expire_unpaid()
    logger.info("Expired %d unpaid hotel booking(s).", expired)
    return expired


def expire_stale_hotel_requests():
    from .services import expire_stale

    expired = expire_stale()
    logger.info("Expired %d stale hotel booking request(s).", expired)
    return expired


def send_hotel_payment_reminders():
    from .services import send_reminders

    sent = send_reminders()
    logger.info("Queued %d hotel payment reminder(s).", sent)
    return sent
