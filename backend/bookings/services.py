"""Every booking status change, including creation, goes through this module."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from catalog.models import Offering
from core.exceptions import Conflict
from core.models import AppSettings

from . import tasks
from .models import Booking, BookingEvent

Status = Booking.Status

ADMIN, CUSTOMER, SYSTEM = "admin", "customer", "system"

# (from, to) -> who may make the move. "customer" means the booking's own customer.
TRANSITIONS = {
    (Status.REQUESTED, Status.AVAILABILITY_CONFIRMED): ADMIN,
    (Status.REQUESTED, Status.UNAVAILABLE): ADMIN,
    (Status.REQUESTED, Status.CANCELLED): CUSTOMER,
    (Status.REQUESTED, Status.EXPIRED): SYSTEM,
    (Status.AVAILABILITY_CONFIRMED, Status.PAID): ADMIN,
    (Status.AVAILABILITY_CONFIRMED, Status.UNAVAILABLE): ADMIN,
    (Status.AVAILABILITY_CONFIRMED, Status.CANCELLED): CUSTOMER,
    (Status.AVAILABILITY_CONFIRMED, Status.EXPIRED): SYSTEM,
}

# The email each new status queues; cancelled queues none.
EMAILS = {
    Status.AVAILABILITY_CONFIRMED: tasks.notify_customer_availability_confirmed,
    Status.UNAVAILABLE: tasks.notify_customer_unavailable,
    Status.PAID: tasks.notify_customer_payment_received,
    Status.EXPIRED: tasks.notify_customer_booking_expired,
}


class InvalidTransition(Conflict):
    """A status change the state machine does not allow; the API returns it as 409."""


def _role(booking, actor):
    if actor is None:
        return SYSTEM
    if actor.role == actor.Role.ADMIN:
        return ADMIN
    if actor.pk == booking.user_id:
        return CUSTOMER
    return None


def _queue_email(task, booking_id):
    transaction.on_commit(lambda: task.delay(booking_id))


def create_booking(user, data):
    """data: offering (id), passenger_count, notes and optionally query, already validated by the serializer."""
    with transaction.atomic():
        # Locking the offering serialises concurrent bookings of it, so the duplicate check holds.
        offering = (
            Offering.objects.visible_to(user).bookable().select_for_update().filter(pk=data["offering"]).first()
        )
        if offering is None:
            raise ValidationError({"offering": "This offering is not available to book."})
        if Booking.objects.filter(user=user, offering=offering, status__in=Booking.ACTIVE_STATUSES).exists():
            raise Conflict("You already have an active booking for this offering.")
        booking = Booking.objects.create(
            user=user,
            offering=offering,
            query=data.get("query"),
            passenger_count=data["passenger_count"],
            notes=data.get("notes", ""),
            unit_price=offering.price,
        )
        BookingEvent.objects.create(booking=booking, to_status=Status.REQUESTED, actor=user)
        _queue_email(tasks.notify_admin_new_booking, booking.pk)
    return booking


def transition(booking_id, to_status, actor):
    """Moves the booking to to_status on behalf of actor (None for the system). Raises InvalidTransition."""
    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id)
        from_status = booking.status
        allowed = TRANSITIONS.get((from_status, to_status))
        if allowed is None:
            raise InvalidTransition(
                f"A booking that is {Status(from_status).label.lower()} "
                f"cannot be changed to {Status(to_status).label.lower()}."
            )
        if _role(booking, actor) != allowed:
            raise InvalidTransition("You are not allowed to make this change to the booking.")

        now = timezone.now()
        if to_status == Status.AVAILABILITY_CONFIRMED:
            app_settings = AppSettings.get()
            if not app_settings.payment_instructions.strip():
                raise InvalidTransition("Add payment instructions in Settings before confirming availability.")
            booking.payment_deadline = now + timedelta(hours=app_settings.payment_hold_hours)
            booking.reminder_sent_at = None
        elif to_status == Status.PAID and now > booking.payment_deadline:
            raise InvalidTransition("The payment deadline has passed; the booking will expire.")

        booking.status = to_status
        booking.save()
        BookingEvent.objects.create(booking=booking, from_status=from_status, to_status=to_status, actor=actor)
        if to_status in EMAILS:
            _queue_email(EMAILS[to_status], booking.pk)
    return booking
