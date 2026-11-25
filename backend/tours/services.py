"""Every tour booking change, and every change to a tour, goes through this module (atomic, the tour locked)."""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from bookings.models import Traveller
from core.exceptions import Conflict
from core.tenancy import queue

from . import tasks
from .models import (
    MAX_PEOPLE,
    MAX_PHOTOS,
    Tour,
    TourBooking,
    TourBookingEvent,
    TourBookingLine,
    TourNotice,
    TourPhoto,
    TourPriceOption,
)

Status = TourBooking.Status

NOT_BOOKABLE = {
    "cancelled": "This tour has been cancelled.",
    "closed": "Bookings for this tour are closed.",
    "fully_booked": "This tour is fully booked.",
}


def _lock_tour(tour_id):
    """The tour locked for update, then read again with its figures."""
    Tour.objects.select_for_update().get(pk=tour_id)
    return Tour.objects.with_figures().get(pk=tour_id)


def _editable(tour):
    if tour.cancelled_at is not None:
        raise Conflict("A cancelled tour cannot be changed.")


def _confirmed(tour):
    return tour.bookings.filter(status=Status.CONFIRMED)


def _slots(count):
    return f"{count} slot{'' if count == 1 else 's'}"


# Tours


def save_tour(tour_id, fields, options, admin, notice=""):
    """Creates (tour_id None) or changes a tour. options: the whole list (each with an optional id), replacing the
    old one, or None to keep it. A notice is emailed to every confirmed booking when there are any."""
    with transaction.atomic():
        if tour_id is None:
            tour = Tour()
            booked = 0
        else:
            tour = _lock_tour(tour_id)
            _editable(tour)
            booked = tour.booked
        if fields.get("slots") is not None and fields["slots"] < booked:
            raise ValidationError({"slots": [f"{booked} people are already booked: slots cannot be fewer."]})
        for name, value in fields.items():
            setattr(tour, name, value)
        tour.save()
        if options is not None:
            _replace_options(tour, options)
        if not tour.options.filter(is_active=True).exists():
            raise ValidationError({"options": ["Add at least one active price option."]})
        if notice and tour_id is not None:
            bookings = list(_confirmed(tour).values_list("pk", flat=True))
            if bookings:
                sent = TourNotice.objects.create(
                    tour=tour, kind=TourNotice.Kind.CHANGE, message=notice, sent_by=admin, recipients=len(bookings)
                )
                for booking_id in bookings:
                    queue(tasks.notify_customer_tour_changed, booking_id, sent.pk)
    return tour


def _replace_options(tour, options):
    existing = {option.pk: option for option in tour.options.with_sold()}
    kept = {item["id"] for item in options if item.get("id")}
    unknown = kept - set(existing)
    if unknown:
        raise ValidationError({"options": ["An option belongs to another tour or no longer exists."]})
    removed = [option for pk, option in existing.items() if pk not in kept]
    booked = [option.name for option in removed if option.booked]
    if booked:
        raise ValidationError(
            {"options": [f"{name} has been booked: deactivate it instead of removing it." for name in booked]}
        )
    TourPriceOption.objects.filter(pk__in=[option.pk for option in removed]).delete()
    errors = []
    for item in options:
        option = existing.get(item.get("id"))
        limit = item.get("units_available")
        if option is not None and limit is not None and limit < option.sold:
            errors.append(f"{option.sold} {option.name} already booked: units cannot be fewer.")
    if errors:
        raise ValidationError({"options": errors})
    # Free the names first, so options can swap names without breaking the unique constraint.
    for pk in kept:
        TourPriceOption.objects.filter(pk=pk).update(name=pk.hex)
    for position, item in enumerate(options):
        values = {key: value for key, value in item.items() if key != "id"}
        option = existing.get(item.get("id")) or TourPriceOption(tour=tour)
        for name, value in values.items():
            setattr(option, name, value)
        option.position = position
        option.save()


def cancel_tour(tour_id, admin, message):
    """Cancels the tour and every confirmed booking on it, records the notice and emails each booking."""
    with transaction.atomic():
        tour = _lock_tour(tour_id)
        _editable(tour)
        tour.cancelled_at = timezone.now()
        tour.cancelled_by = admin
        tour.is_active = False
        tour.save(update_fields=["cancelled_at", "cancelled_by", "is_active", "updated_at"])
        bookings = list(_confirmed(tour).select_for_update())
        for booking in bookings:
            _move(booking, Status.CANCELLED, admin, cancelled_by=TourBooking.CancelledBy.ADMIN, cancel_reason=message)
            queue(tasks.notify_customer_tour_cancelled, booking.pk)
        TourNotice.objects.create(
            tour=tour, kind=TourNotice.Kind.CANCELLATION, message=message, sent_by=admin, recipients=len(bookings)
        )
    return tour


# Photos


def add_photo(tour_id, image):
    """image has already passed the type, size and content checks."""
    with transaction.atomic():
        tour = _lock_tour(tour_id)
        _editable(tour)
        count = tour.photos.count()
        if count >= MAX_PHOTOS:
            raise ValidationError({"image": [f"A tour can have at most {MAX_PHOTOS} photos."]})
        return TourPhoto.objects.create(tour=tour, image=image, position=count)


def _renumber(photos):
    for position, photo in enumerate(photos):
        if photo.position != position:
            photo.position = position
            photo.save(update_fields=["position"])


def move_photo(photo, position):
    with transaction.atomic():
        _editable(_lock_tour(photo.tour_id))
        photos = [other for other in photo.tour.photos.all() if other.pk != photo.pk]
        photos.insert(min(max(position, 0), len(photos)), photo)
        _renumber(photos)


def delete_photo(photo):
    with transaction.atomic():
        _editable(_lock_tour(photo.tour_id))
        tour = photo.tour
        photo.delete()
        _renumber(list(tour.photos.all()))


# Bookings


def _move(booking, to_status, actor, **changes):
    from_status = booking.status
    booking.status = to_status
    for name, value in changes.items():
        setattr(booking, name, value)
    booking.save()
    TourBookingEvent.objects.create(booking=booking, from_status=from_status, to_status=to_status, actor=actor)


def book_tour(tour_id, user, data, admin=None):
    """data: lines (option, quantity, travellers), group_name, notes and phone, validated by the serializer.

    admin: set when the admin books for the customer. The tour then needs only to be active, not cancelled and not
    started; the admins get no "new booking" email.
    """
    with transaction.atomic():
        if not Tour.objects.filter(pk=tour_id).exists():
            raise ValidationError({"tour": ["This tour is not available to book."]})
        tour = _lock_tour(tour_id)
        if admin is None:
            reason = tour.not_bookable_reason()
            if reason:
                raise Conflict(NOT_BOOKABLE[reason])
        elif tour.cancelled_at is not None:
            raise Conflict(NOT_BOOKABLE["cancelled"])
        elif not tour.is_active:
            raise Conflict("This tour is inactive.")
        elif timezone.localdate() >= tour.start_date:
            raise Conflict("This tour has already started.")

        options = {option.pk: option for option in tour.options.with_sold().filter(is_active=True)}
        lines = []
        for item in data["lines"]:
            option = options.get(item["option"])
            if option is None:
                raise ValidationError({"lines": ["Choose from the tour's options."]})
            lines.append((option, item))
        people = sum(option.people_per_unit * item["quantity"] for option, item in lines)
        if people > MAX_PEOPLE:
            raise ValidationError({"lines": [f"A booking holds at most {MAX_PEOPLE} people."]})
        for option, item in lines:
            if len(item.get("travellers", [])) > option.people_per_unit * item["quantity"]:
                raise ValidationError(
                    {"lines": [f"{option.name} holds at most {option.people_per_unit * item['quantity']} travellers."]}
                )
        if people > tour.slots_left:
            raise Conflict(f"Only {_slots(tour.slots_left)} left.")
        for option, item in lines:
            if option.units_left is not None and item["quantity"] > option.units_left:
                raise Conflict(
                    f"Only {option.units_left} {option.name} left." if option.units_left else f"No {option.name} left."
                )

        phone = data.get("phone", "").strip()
        if not user.phone:
            if not phone:
                raise ValidationError({"phone": ["Add a phone number so the agency can reach you."]})
            user.phone = phone
            user.save(update_fields=["phone"])

        booking = TourBooking.objects.create(
            tour=tour,
            user=user,
            created_by=admin,
            people=people,
            group_name=data.get("group_name", ""),
            notes=data.get("notes", ""),
        )
        for option, item in lines:
            line = TourBookingLine.objects.create(
                booking=booking,
                option=option,
                option_name=option.name,
                unit_price=option.price,
                people_per_unit=option.people_per_unit,
                quantity=item["quantity"],
            )
            Traveller.objects.bulk_create(
                [Traveller(tour_line=line, **traveller) for traveller in item.get("travellers", [])]
            )
        TourBookingEvent.objects.create(booking=booking, to_status=Status.CONFIRMED, actor=admin or user)
        queue(tasks.notify_customer_tour_booked, booking.pk)
        if admin is None:
            queue(tasks.notify_admin_new_tour_booking, booking.pk)
    return booking


def _lock_booking(booking_id):
    # The tour first, as booking and cancelling a tour do, so locks are always taken in the same order.
    tour_id = TourBooking.objects.values_list("tour_id", flat=True).get(pk=booking_id)
    Tour.objects.select_for_update().get(pk=tour_id)
    return TourBooking.objects.select_for_update().select_related("tour").get(pk=booking_id)


def customer_can_cancel(booking):
    return booking.status == Status.CONFIRMED and timezone.localdate() <= booking.tour.cancellation_deadline


def admin_can_cancel(booking):
    return booking.status == Status.CONFIRMED and timezone.localdate() <= booking.tour.end_date


def cancel_by_customer(booking_id, user):
    with transaction.atomic():
        booking = _lock_booking(booking_id)
        if booking.user_id != user.pk:
            raise Conflict("You are not allowed to cancel this booking.")
        if booking.status != Status.CONFIRMED:
            raise Conflict("Only a confirmed booking can be cancelled.")
        if not customer_can_cancel(booking):
            raise Conflict("The free cancellation period for this tour has ended.")
        _move(booking, Status.CANCELLED, user, cancelled_by=TourBooking.CancelledBy.CUSTOMER)
        queue(tasks.notify_admin_tour_booking_cancelled, booking.pk)
    return booking


def cancel_by_admin(booking_id, admin, message=""):
    """The customer is emailed only when there is a message."""
    with transaction.atomic():
        booking = _lock_booking(booking_id)
        if booking.status != Status.CONFIRMED:
            raise Conflict("Only a confirmed booking can be cancelled.")
        if not admin_can_cancel(booking):
            raise Conflict("This tour has ended.")
        _move(booking, Status.CANCELLED, admin, cancelled_by=TourBooking.CancelledBy.ADMIN, cancel_reason=message)
        if message:
            queue(tasks.notify_customer_tour_booking_cancelled, booking.pk)
    return booking


def complete_finished():
    """Confirmed bookings whose tour ended before today become completed."""
    completed = 0
    ids = TourBooking.objects.filter(status=Status.CONFIRMED, tour__end_date__lt=timezone.localdate())
    for booking_id in list(ids.values_list("pk", flat=True)):
        with transaction.atomic():
            booking = TourBooking.objects.select_for_update().filter(pk=booking_id, status=Status.CONFIRMED).first()
            if booking is None:
                continue
            _move(booking, Status.COMPLETED, None)
        completed += 1
    return completed


# Travellers


def _lock_confirmed(booking_id):
    booking = TourBooking.objects.select_for_update().get(pk=booking_id)
    if booking.status != Status.CONFIRMED:
        raise Conflict("Travellers can only be changed while the booking is confirmed.")
    return booking


def add_traveller(booking_id, line_id, data):
    with transaction.atomic():
        booking = _lock_confirmed(booking_id)
        line = booking.lines.filter(pk=line_id).first()
        if line is None:
            raise ValidationError({"line": ["Choose one of the booking's options."]})
        if line.travellers.count() >= line.people:
            raise ValidationError({"line": [f"{line.option_name} holds at most {line.people} travellers."]})
        return Traveller.objects.create(tour_line=line, **data)


def change_traveller(traveller, data):
    with transaction.atomic():
        _lock_confirmed(traveller.tour_line.booking_id)
        for name, value in data.items():
            setattr(traveller, name, value)
        traveller.save()
        return traveller


def remove_traveller(traveller):
    with transaction.atomic():
        _lock_confirmed(traveller.tour_line.booking_id)
        traveller.delete()
