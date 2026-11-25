import logging

from celery import shared_task

from core.emails import EMAIL_TASK_OPTIONS, format_date, format_price, send_email
from core.models import AppSettings
from core.tenancy import for_each_tenant, tenant_task

from .models import TourBooking, TourNotice

logger = logging.getLogger(__name__)

Status = TourBooking.Status


def _booking(booking_id, **state):
    """The booking, or None when it is gone or no longer in the state the email describes."""
    return (
        TourBooking.objects.select_related("user", "tour")
        .prefetch_related("lines__travellers")
        .filter(pk=booking_id, **state)
        .first()
    )


def _unit(people_per_unit):
    return "per person" if people_per_unit == 1 else f"for {people_per_unit} people"


def describe_tour_booking(booking):
    tour = booking.tour
    lines = booking.lines.all()
    names = [traveller.full_name for line in lines for traveller in line.travellers.all()]
    return {
        "booking": booking,
        "tour": tour,
        "dates": f"{format_date(tour.start_date)} – {format_date(tour.end_date)} ({tour.duration_days} days)",
        "lines": "\n".join(
            f"{line.quantity} × {line.option_name} ({format_price(line.unit_price)} {_unit(line.people_per_unit)}): "
            f"{format_price(line.total_price)}"
            for line in lines
        ),
        "travellers": ", ".join(names) or "None added yet",
        "total": format_price(booking.total_price),
        "cancellation_deadline": format_date(tour.cancellation_deadline),
    }


@tenant_task("tours", **EMAIL_TASK_OPTIONS)
def notify_customer_tour_booked(booking_id):
    booking = _booking(booking_id, status=Status.CONFIRMED)
    if booking is None:
        return
    send_email(
        "tour_booked",
        f"You're booked: {booking.tour.title}",
        booking.user.email,
        {**describe_tour_booking(booking), "payment_instructions": AppSettings.get().payment_instructions},
    )


@tenant_task("tours", **EMAIL_TASK_OPTIONS)
def notify_admin_new_tour_booking(booking_id):
    booking = _booking(booking_id, status=Status.CONFIRMED, created_by__isnull=True)
    if booking is None:
        return
    send_email(
        "new_tour_booking",
        f"New tour booking from {booking.user.full_name}: {booking.tour.title}",
        AppSettings.get().admin_notification_email,
        describe_tour_booking(booking),
    )


@tenant_task("tours", **EMAIL_TASK_OPTIONS)
def notify_customer_tour_changed(booking_id, notice_id):
    booking = _booking(booking_id, status=Status.CONFIRMED)
    notice = TourNotice.objects.filter(pk=notice_id).first()
    if booking is None or notice is None:
        return
    send_email(
        "tour_changed",
        f"Change to your tour: {booking.tour.title}",
        booking.user.email,
        {**describe_tour_booking(booking), "message": notice.message},
    )


@tenant_task("tours", **EMAIL_TASK_OPTIONS)
def notify_customer_tour_booking_cancelled(booking_id):
    booking = _booking(booking_id, status=Status.CANCELLED, cancelled_by=TourBooking.CancelledBy.ADMIN)
    if booking is None or not booking.cancel_reason:
        return
    send_email(
        "tour_booking_cancelled",
        f"Your booking was cancelled: {booking.tour.title}",
        booking.user.email,
        {**describe_tour_booking(booking), "message": booking.cancel_reason},
    )


@tenant_task("tours", **EMAIL_TASK_OPTIONS)
def notify_customer_tour_cancelled(booking_id):
    booking = _booking(booking_id, status=Status.CANCELLED, tour__cancelled_at__isnull=False)
    if booking is None:
        return
    send_email(
        "tour_cancelled",
        f"Tour cancelled: {booking.tour.title}",
        booking.user.email,
        {**describe_tour_booking(booking), "message": booking.cancel_reason},
    )


@tenant_task("tours", **EMAIL_TASK_OPTIONS)
def notify_admin_tour_booking_cancelled(booking_id):
    booking = _booking(booking_id, status=Status.CANCELLED, cancelled_by=TourBooking.CancelledBy.CUSTOMER)
    if booking is None:
        return
    send_email(
        "tour_booking_cancelled_by_customer",
        f"Tour booking cancelled by {booking.user.full_name}: {booking.tour.title}",
        AppSettings.get().admin_notification_email,
        describe_tour_booking(booking),
    )


@shared_task
def complete_finished_tour_bookings():
    """Confirmed bookings whose tour has ended, in every active tenant with tours."""
    return for_each_tenant(_complete_finished_tour_bookings, "complete_finished_tour_bookings", "tours")


def _complete_finished_tour_bookings():
    from .services import complete_finished

    completed = complete_finished()
    logger.info("Completed %d tour booking(s).", completed)
    return completed
