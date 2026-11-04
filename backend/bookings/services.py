"""Every booking status change, including creation, goes through this module."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from catalog.models import Offer
from core.exceptions import Conflict
from core.models import AppSettings
from core.tenancy import queue
from customer_requests.models import Query
from customer_requests.services import add_response

from . import tasks
from .models import BoardingPass, Booking, BookingEvent, BookingStop

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
    # Only while changes made on confirming await acceptance.
    (Status.AVAILABILITY_CONFIRMED, Status.DECLINED): CUSTOMER,
    (Status.PAID, Status.COMPLETED): ADMIN,
}

# The email each new status queues; cancelled and declined queue none.
EMAILS = {
    Status.AVAILABILITY_CONFIRMED: tasks.notify_customer_availability_confirmed,
    Status.UNAVAILABLE: tasks.notify_customer_unavailable,
    Status.PAID: tasks.notify_customer_payment_received,
    Status.EXPIRED: tasks.notify_customer_booking_expired,
    Status.COMPLETED: tasks.notify_customer_boarding_passes,
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
    queue(task, booking_id)


def create_booking(user, data, admin=None):
    """data: offer (id), passenger_count, notes and optionally query, already validated by the serializer.

    admin: set when the admin books on the customer's behalf. Then any bookable offer may be booked (public or
    private), the admin is the creation event's actor, and email 3 is not sent.
    """
    with transaction.atomic():
        offers = Offer.objects.bookable() if admin is not None else Offer.objects.visible_to(user).bookable()
        # Locking the offer serialises concurrent bookings of it, so the duplicate check holds.
        offer = offers.select_for_update().filter(pk=data["offer"]).first()
        if offer is None:
            raise ValidationError({"offer": "This offer is not available to book."})
        if Booking.objects.filter(user=user, offer=offer, status__in=Booking.ACTIVE_STATUSES).exists():
            raise Conflict(
                "This customer already has an active booking for this offer."
                if admin is not None
                else "You already have an active booking for this offer."
            )
        booking = Booking.objects.create(
            user=user,
            offer=offer,
            query=data.get("query"),
            passenger_count=data["passenger_count"],
            notes=data.get("notes", ""),
            unit_price=offer.price,
        )
        BookingStop.objects.bulk_create(
            BookingStop(
                booking=booking,
                position=stop.position,
                airport_id=stop.airport_id,
                duration_minutes=stop.duration_minutes,
            )
            for stop in offer.stops.all()
        )
        BookingEvent.objects.create(booking=booking, to_status=Status.REQUESTED, actor=admin or user)
        if admin is None:
            _queue_email(tasks.notify_admin_new_booking, booking.pk)
    return booking


def transition(booking_id, to_status, actor, apply=None):
    """Moves the booking to to_status on behalf of actor (None for the system). Raises InvalidTransition.

    apply(booking), when given, makes further changes to the locked booking in the same transaction, after the checks.
    """
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
        elif to_status == Status.PAID:
            if booking.changes_awaiting_acceptance:
                raise InvalidTransition("The customer has not accepted the changes yet.")
            if now > booking.payment_deadline:
                raise InvalidTransition("The payment deadline has passed; the booking will expire.")
        elif to_status == Status.DECLINED and not booking.changes_awaiting_acceptance:
            raise InvalidTransition("There are no changes to decline.")
        elif to_status == Status.COMPLETED and not booking.boarding_passes.exists():
            raise InvalidTransition("Upload at least one boarding pass before sending them.")

        if apply is not None:
            apply(booking)
        booking.status = to_status
        booking.save()
        BookingEvent.objects.create(booking=booking, from_status=from_status, to_status=to_status, actor=actor)
        if to_status in EMAILS:
            _queue_email(EMAILS[to_status], booking.pk)
    return booking


def _stop_change(airport, duration_minutes):
    return {"code": airport.code, "city": airport.city, "duration_minutes": duration_minutes}


def confirm_availability(booking_id, actor, unit_price=None, stops=None):
    """Confirms availability, applying a new unit price and stop list where they differ from the booking's.

    stops: ordered dicts of airport and duration_minutes, already validated. What changed is recorded in
    booking.changes for the customer to accept or decline.
    """

    def apply(booking):
        changes = {}
        if unit_price is not None and unit_price != booking.unit_price:
            changes["unit_price"] = {"old": str(booking.unit_price), "new": str(unit_price)}
            booking.unit_price = unit_price
        if stops is not None:
            current = list(booking.stops.select_related("airport"))
            if [(s.airport_id, s.duration_minutes) for s in current] != [
                (s["airport"].pk, s["duration_minutes"]) for s in stops
            ]:
                changes["stops"] = {
                    "old": [_stop_change(s.airport, s.duration_minutes) for s in current],
                    "new": [_stop_change(s["airport"], s["duration_minutes"]) for s in stops],
                }
                booking.stops.all().delete()
                BookingStop.objects.bulk_create(
                    BookingStop(
                        booking=booking, position=position, airport=s["airport"], duration_minutes=s["duration_minutes"]
                    )
                    for position, s in enumerate(stops, start=1)
                )
        booking.changes = changes or None
        booking.changes_accepted = False

    return transition(booking_id, Status.AVAILABILITY_CONFIRMED, actor, apply=apply)


def mark_unavailable(booking_id, actor, message="", offers=(), new_offers=()):
    """Marks the booking unavailable. With at least one offer, also suggests them to the customer.

    The suggestions go into a new request for the booking's customer (route, date and class from the booked
    offer), answered with one response holding the message and offers, and linked as booking.alternatives.
    The request's own emails (1 and 2) are not sent; email 5 tells the customer instead.
    """

    def apply(booking):
        if not offers and not new_offers:
            return
        booked = booking.offer
        query = Query.objects.create(
            user=booking.user,
            origin=booked.origin,
            destination=booked.destination,
            date_from=booked.departure_date,
            ticket_class=booked.ticket_class,
            status=Query.Status.RESPONDED,
        )
        add_response(query, message, offers, new_offers)
        booking.alternatives = query

    return transition(booking_id, Status.UNAVAILABLE, actor, apply=apply)


def accept_changes(booking_id, user):
    """The booking's customer accepts the changes made when availability was confirmed."""
    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id, user=user)
        if booking.status != Status.AVAILABILITY_CONFIRMED or not booking.changes_awaiting_acceptance:
            raise Conflict("There are no changes waiting for you to accept.")
        booking.changes_accepted = True
        booking.save(update_fields=["changes_accepted"])
    return booking


def _lock_paid_booking(booking_id):
    booking = Booking.objects.select_for_update().get(pk=booking_id)
    if booking.status != Status.PAID:
        raise Conflict("Boarding passes can only be changed while the booking is paid.")
    return booking


def add_boarding_pass(booking_id, uploaded_file):
    """uploaded_file has already passed the type and size checks."""
    with transaction.atomic():
        booking = _lock_paid_booking(booking_id)
        if booking.boarding_passes.count() >= BoardingPass.MAX_PER_BOOKING:
            raise ValidationError({"file": f"A booking can have at most {BoardingPass.MAX_PER_BOOKING} boarding passes."})
        return BoardingPass.objects.create(booking=booking, file=uploaded_file, original_name=uploaded_file.name)


def delete_boarding_pass(boarding_pass):
    with transaction.atomic():
        _lock_paid_booking(boarding_pass.booking_id)
        storage, name = boarding_pass.file.storage, boarding_pass.file.name
        boarding_pass.delete()
        # Remove the file only once the row is gone for good.
        transaction.on_commit(lambda: storage.delete(name))
