"""Every booking status change, including creation, goes through this module."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from catalog.itinerary import change_lines, derived_fields, same_itinerary
from catalog.models import Offer, Trip
from core.exceptions import Conflict
from core.models import AppSettings
from core.tenancy import queue
from customer_requests.models import Query
from customer_requests.services import add_response

from . import tasks
from .models import BoardingPass, Booking, BookingEvent, BookingSegment

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


SEGMENT_RELATED = ["airline", "operating_airline", "origin", "destination"]


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
    private), the admin is the creation event's actor, and the admin is not notified.
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
            **{field: getattr(offer, field) for field in Trip.FIELDS},
        )
        BookingSegment.objects.bulk_create(
            BookingSegment.build(
                [segment.as_data() for segment in offer.segments.select_related(*SEGMENT_RELATED)], booking=booking
            )
        )
        BookingEvent.objects.create(booking=booking, to_status=Status.REQUESTED, actor=admin or user)
        if admin is None:
            _queue_email(tasks.notify_admin_new_booking, booking.pk)
    return booking


def transition(booking_id, to_status, actor, apply=None, from_status=None):
    """Moves the booking to to_status on behalf of actor (None for the system). Raises InvalidTransition.

    apply(booking), when given, makes further changes to the locked booking in the same transaction, after the checks.
    from_status, when given, is the status the caller selected the booking in; if it has moved on since, the
    change is refused (scheduled jobs use it so a booking confirmed or paid meanwhile is left alone).
    """
    with transaction.atomic():
        booking = Booking.objects.select_for_update().get(pk=booking_id)
        if from_status is not None and booking.status != from_status:
            raise InvalidTransition("The booking changed in the meantime.")
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


def check_transition(booking, to_status):
    """Refuses (409) a move the state machine never allows from the booking's status, before a body is validated."""
    if (booking.status, to_status) not in TRANSITIONS:
        raise InvalidTransition(
            f"A booking that is {Status(booking.status).label.lower()} "
            f"cannot be changed to {Status(to_status).label.lower()}."
        )


def confirm_availability(booking_id, actor, unit_price=None, segments=None):
    """Confirms availability, applying a new unit price and segments where they differ from the booking's.

    segments: validated segment dicts in flight order. What changed is recorded in booking.changes for the
    customer to accept or decline.
    """

    def apply(booking):
        changes = {}
        if unit_price is not None and unit_price != booking.unit_price:
            changes["unit_price"] = {"old": str(booking.unit_price), "new": str(unit_price)}
            booking.unit_price = unit_price
        if segments is not None:
            current = [s.as_data() for s in booking.segments.select_related(*SEGMENT_RELATED)]
            if not same_itinerary(current, segments):
                changes["segments"] = {"old": change_lines(current), "new": change_lines(segments)}
                booking.segments.all().delete()
                BookingSegment.objects.bulk_create(BookingSegment.build(segments, booking=booking))
                booking.return_date = derived_fields(segments)["return_date"]
        booking.changes = changes or None
        booking.changes_accepted = False

    return transition(booking_id, Status.AVAILABILITY_CONFIRMED, actor, apply=apply)


def mark_unavailable(booking_id, actor, message="", offers=(), new_offers=()):
    """Marks the booking unavailable. With at least one offer, also suggests them to the customer.

    The suggestions go into a new request for the booking's customer (route, date and class from the booked
    offer, trip type and return date from the booking), answered with one response holding the message and offers, and linked as booking.alternatives.
    The request's own emails are not sent; the unavailable email tells the customer instead.
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
            trip_type=booking.trip_type,
            return_date=booking.return_date,
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
