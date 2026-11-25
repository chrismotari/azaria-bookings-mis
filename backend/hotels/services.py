"""Every hotel booking change, including creation, and every change to a hotel's rooms and photos."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from bookings.models import Traveller
from core.exceptions import Conflict
from core.models import AppSettings
from core.tenancy import queue

from . import tasks
from .models import (
    MAX_PHOTOS,
    Hotel,
    HotelBooking,
    HotelBookingEvent,
    HotelBookingRoom,
    HotelPhoto,
    HotelVoucher,
    RatePeriod,
    RoomRate,
    RoomType,
)
from .pricing import room_price, stay_price, with_offered_rates

Status = HotelBooking.Status

ADMIN, CUSTOMER, SYSTEM = "admin", "customer", "system"

TRANSITIONS = {
    (Status.REQUESTED, Status.AVAILABILITY_CONFIRMED): ADMIN,
    (Status.REQUESTED, Status.UNAVAILABLE): ADMIN,
    (Status.REQUESTED, Status.CANCELLED): CUSTOMER,
    (Status.REQUESTED, Status.EXPIRED): SYSTEM,
    (Status.AVAILABILITY_CONFIRMED, Status.PAID): ADMIN,
    (Status.AVAILABILITY_CONFIRMED, Status.UNAVAILABLE): ADMIN,
    (Status.AVAILABILITY_CONFIRMED, Status.CANCELLED): CUSTOMER,
    (Status.AVAILABILITY_CONFIRMED, Status.EXPIRED): SYSTEM,
    (Status.AVAILABILITY_CONFIRMED, Status.DECLINED): CUSTOMER,
    (Status.PAID, Status.COMPLETED): ADMIN,
}

CUSTOMER_EDITS_GUESTS = [Status.REQUESTED]
ADMIN_EDITS_GUESTS = HotelBooking.OPEN_STATUSES

EMAILS = {
    Status.AVAILABILITY_CONFIRMED: tasks.notify_customer_hotel_availability_confirmed,
    Status.UNAVAILABLE: tasks.notify_customer_hotel_unavailable,
    Status.PAID: tasks.notify_customer_hotel_payment_received,
    Status.EXPIRED: tasks.notify_customer_hotel_booking_expired,
    Status.COMPLETED: tasks.notify_customer_hotel_voucher,
}


class InvalidTransition(Conflict):
    """A status change the state machine does not allow; the API returns it as 409."""


# Hotels


def save_hotel(hotel_id, fields, room_types):
    """Creates (hotel_id None) or changes a hotel. room_types: the whole list (each with its rates and their
    periods), replacing the old one, or None to keep it."""
    with transaction.atomic():
        hotel = Hotel() if hotel_id is None else Hotel.objects.select_for_update().get(pk=hotel_id)
        for name, value in fields.items():
            setattr(hotel, name, value)
        hotel.save()
        if room_types is not None:
            _replace_room_types(hotel, room_types)
    return hotel


def _booked(model, pks):
    return set(model.objects.filter(pk__in=pks, booked_rooms__isnull=False).values_list("pk", flat=True))


def _replace_room_types(hotel, room_types):
    existing_types = {room_type.pk: room_type for room_type in hotel.room_types.all()}
    existing_rates = {rate.pk: rate for rate in RoomRate.objects.filter(room_type__hotel=hotel)}
    kept_types = {item["id"] for item in room_types if item.get("id")}
    kept_rates = {rate["id"]: item.get("id") for item in room_types for rate in item["rates"] if rate.get("id")}
    if kept_types - set(existing_types) or set(kept_rates) - set(existing_rates):
        raise ValidationError({"room_types": ["A room type or rate belongs to another hotel or no longer exists."]})
    if any(existing_rates[rate].room_type_id != room_type for rate, room_type in kept_rates.items()):
        raise ValidationError({"room_types": ["A rate cannot move to another room type."]})

    removed_types = set(existing_types) - kept_types
    removed_rates = set(existing_rates) - set(kept_rates)
    errors = [
        f"{existing_types[pk].name} has been booked: deactivate it instead of removing it."
        for pk in _booked(RoomType, removed_types)
    ] + [
        f"{existing_rates[pk].name} has been booked: deactivate it instead of removing it."
        for pk in _booked(RoomRate, removed_rates)
    ]
    if errors:
        raise ValidationError({"room_types": errors})
    RoomRate.objects.filter(pk__in=removed_rates).delete()
    RoomType.objects.filter(pk__in=removed_types).delete()

    # Free the names first, so items can swap names without breaking the unique constraints.
    for pk in kept_types:
        RoomType.objects.filter(pk=pk).update(name=pk.hex)
    for pk in kept_rates:
        RoomRate.objects.filter(pk=pk).update(name=pk.hex)
    for position, item in enumerate(room_types):
        room_type = existing_types.get(item.get("id")) or RoomType(hotel=hotel)
        for name, value in item.items():
            if name not in ("id", "rates"):
                setattr(room_type, name, value)
        room_type.position = position
        room_type.save()
        for rate_position, rate_item in enumerate(item["rates"]):
            rate = existing_rates.get(rate_item.get("id")) or RoomRate()
            for name, value in rate_item.items():
                if name not in ("id", "periods"):
                    setattr(rate, name, value)
            rate.room_type = room_type
            rate.position = rate_position
            rate.save()
            rate.periods.all().delete()
            RatePeriod.objects.bulk_create(RatePeriod(rate=rate, **period) for period in rate_item["periods"])


def add_photo(hotel_id, image):
    """image has already passed the type, size and content checks."""
    with transaction.atomic():
        hotel = Hotel.objects.select_for_update().get(pk=hotel_id)
        count = hotel.photos.count()
        if count >= MAX_PHOTOS:
            raise ValidationError({"image": [f"A hotel can have at most {MAX_PHOTOS} photos."]})
        return HotelPhoto.objects.create(hotel=hotel, image=image, position=count)


def _renumber(photos):
    for position, photo in enumerate(photos):
        if photo.position != position:
            photo.position = position
            photo.save(update_fields=["position"])


def move_photo(photo, position):
    with transaction.atomic():
        Hotel.objects.select_for_update().get(pk=photo.hotel_id)
        photos = [other for other in photo.hotel.photos.all() if other.pk != photo.pk]
        photos.insert(min(max(position, 0), len(photos)), photo)
        _renumber(photos)


def delete_photo(photo):
    with transaction.atomic():
        hotel = Hotel.objects.select_for_update().get(pk=photo.hotel_id)
        photo.delete()
        _renumber(list(hotel.photos.all()))


# Bookings


def _role(booking, actor):
    if actor is None:
        return SYSTEM
    if actor.role == actor.Role.ADMIN:
        return ADMIN
    if actor.pk == booking.user_id:
        return CUSTOMER
    return None


def create_booking(user, data, admin=None):
    """data: hotel, check_in, check_out, rooms (room_type, rate, adults, children, guests), special_requests, notes
    and phone, validated by the serializer. admin: set when the admin books for the customer (no admin email)."""
    with transaction.atomic():
        hotel = Hotel.objects.select_for_update().filter(pk=data["hotel"]).first()
        if hotel is None:
            raise ValidationError({"hotel": ["This hotel is not available to book."]})
        if not hotel.is_active:
            raise Conflict("This hotel is no longer taking bookings.")
        hotel = with_offered_rates(Hotel.objects.filter(pk=hotel.pk)).get()
        offered = {rate.pk: (room_type, rate) for room_type in hotel.offered_types for rate in room_type.offered_rates}
        every_rate = RoomRate.objects.filter(room_type__hotel=hotel).select_related("room_type").in_bulk()
        check_in, check_out = data["check_in"], data["check_out"]

        rooms = []
        for index, item in enumerate(data["rooms"]):
            chosen = every_rate.get(item["rate"])
            if chosen is None or chosen.room_type_id != item["room_type"]:
                raise ValidationError({"rooms": {index: {"rate": ["Choose one of the room type's rates."]}}})
            found = offered.get(chosen.pk)
            if found is None or room_price(found[1], check_in, check_out) is None:
                raise Conflict(f"{chosen.room_type.name} is not available for these dates.")
            room_type, rate = found
            if item["adults"] > rate.max_adults or item["children"] > rate.max_children:
                raise ValidationError(
                    {
                        "rooms": {
                            index: {
                                "adults": [
                                    f"{rate.name} sleeps up to {rate.max_adults} adults and {rate.max_children} "
                                    "children."
                                ]
                            }
                        }
                    }
                )
            rooms.append((room_type, rate, item, stay_price(rate, check_in, check_out, item["adults"])))

        phone = data.get("phone", "").strip()
        if not user.phone:
            if not phone:
                raise ValidationError({"phone": ["Add a phone number so the agency can reach you."]})
            user.phone = phone
            user.save(update_fields=["phone"])

        booking = HotelBooking.objects.create(
            hotel=hotel,
            user=user,
            created_by=admin,
            check_in=check_in,
            check_out=check_out,
            total=sum(price for *_, price in rooms),
            special_requests=data.get("special_requests", ""),
            notes=data.get("notes", ""),
        )
        for room_type, rate, item, price in rooms:
            room = HotelBookingRoom.objects.create(
                booking=booking,
                room_type=room_type,
                rate=rate,
                room_name=room_type.name,
                rate_name=rate.name,
                per_adult_per_night=rate.per_adult_per_night,
                price=price,
                adults=item["adults"],
                children=item["children"],
            )
            # One by one, so the lead guest is the first created.
            for guest in item["guests"]:
                Traveller.objects.create(hotel_room=room, **guest)
        HotelBookingEvent.objects.create(booking=booking, to_status=Status.REQUESTED, actor=admin or user)
        if admin is None:
            queue(tasks.notify_admin_new_hotel_booking, booking.pk)
    return booking


def _status_label(status):
    return Status(status).label.lower()


def check_transition(booking, to_status):
    """Refuses (409) a move the state machine never allows from the booking's status, before a body is validated."""
    if (booking.status, to_status) not in TRANSITIONS:
        raise InvalidTransition(
            f"A booking that is {_status_label(booking.status)} cannot be changed to {_status_label(to_status)}."
        )


def transition(booking_id, to_status, actor, apply=None, from_status=None):
    """Moves the booking to to_status for actor (None: the system). apply(booking) makes further changes after the
    checks; from_status refuses the move if the booking has left the status the caller saw."""
    with transaction.atomic():
        booking = HotelBooking.objects.select_for_update().get(pk=booking_id)
        if from_status is not None and booking.status != from_status:
            raise InvalidTransition("The booking changed in the meantime.")
        from_status = booking.status
        check_transition(booking, to_status)
        if _role(booking, actor) != TRANSITIONS[(from_status, to_status)]:
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
                raise InvalidTransition("The customer has not accepted the new total yet.")
            if now > booking.payment_deadline:
                raise InvalidTransition("The payment deadline has passed; the booking will expire.")
        elif to_status == Status.DECLINED and not booking.changes_awaiting_acceptance:
            raise InvalidTransition("There are no changes to decline.")
        elif to_status == Status.COMPLETED and not booking.vouchers.exists():
            raise InvalidTransition("Upload at least one voucher before sending it.")

        if apply is not None:
            apply(booking)
        booking.status = to_status
        booking.save()
        HotelBookingEvent.objects.create(booking=booking, from_status=from_status, to_status=to_status, actor=actor)
        if to_status in EMAILS:
            queue(EMAILS[to_status], booking.pk)
    return booking


def confirm_availability(booking_id, actor, new_total=None, note=""):
    """A new total that differs from the booking's is recorded in changes, with the note, for the customer to
    accept or decline."""

    def apply(booking):
        if new_total is not None and new_total != booking.total:
            booking.changes = {"total": {"old": str(booking.total), "new": str(new_total)}, "note": note}
        else:
            booking.changes = None
        booking.changes_accepted = False

    return transition(booking_id, Status.AVAILABILITY_CONFIRMED, actor, apply=apply)


def mark_unavailable(booking_id, actor, message=""):
    def apply(booking):
        booking.unavailable_message = message

    return transition(booking_id, Status.UNAVAILABLE, actor, apply=apply)


def complete(booking_id, actor, hotel_confirmation):
    """Send voucher: records the hotel's confirmation number and emails every voucher."""

    def apply(booking):
        booking.hotel_confirmation = hotel_confirmation

    return transition(booking_id, Status.COMPLETED, actor, apply=apply)


def accept_changes(booking_id, user):
    """The customer accepts the new total, which becomes the booking's."""
    with transaction.atomic():
        booking = HotelBooking.objects.select_for_update().get(pk=booking_id, user=user)
        if booking.status != Status.AVAILABILITY_CONFIRMED or not booking.changes_awaiting_acceptance:
            raise Conflict("There are no changes waiting for you to accept.")
        booking.changes_accepted = True
        booking.total = booking.changes["total"]["new"]
        booking.save(update_fields=["changes_accepted", "total"])
    return booking


def customer_can_cancel(booking):
    return (booking.status, Status.CANCELLED) in TRANSITIONS


# Vouchers


def _lock_paid_booking(booking_id):
    booking = HotelBooking.objects.select_for_update().get(pk=booking_id)
    if booking.status != Status.PAID:
        raise Conflict("Vouchers can only be changed while the booking is paid.")
    return booking


def add_voucher(booking_id, uploaded_file):
    """uploaded_file has already passed the type and size checks."""
    with transaction.atomic():
        booking = _lock_paid_booking(booking_id)
        if booking.vouchers.count() >= HotelVoucher.MAX_PER_BOOKING:
            raise ValidationError({"file": [f"A booking can have at most {HotelVoucher.MAX_PER_BOOKING} vouchers."]})
        return HotelVoucher.objects.create(booking=booking, file=uploaded_file, original_name=uploaded_file.name)


def delete_voucher(voucher):
    with transaction.atomic():
        _lock_paid_booking(voucher.booking_id)
        storage, name = voucher.file.storage, voucher.file.name
        voucher.delete()
        transaction.on_commit(lambda: storage.delete(name))


# Guests


def can_edit_guests(booking, admin):
    return booking.status in (ADMIN_EDITS_GUESTS if admin else CUSTOMER_EDITS_GUESTS)


def _lock_for_guests(booking_id, admin):
    booking = HotelBooking.objects.select_for_update().get(pk=booking_id)
    if not can_edit_guests(booking, admin):
        if not admin and booking.status in ADMIN_EDITS_GUESTS:
            raise Conflict("Only the agency can change guests once availability is confirmed.")
        raise Conflict(f"Guests cannot be changed on a booking that is {_status_label(booking.status)}.")
    return booking


def is_lead_guest(traveller):
    """Each room's first guest."""
    first = Traveller.objects.filter(hotel_room_id=traveller.hotel_room_id).order_by("created_at", "pk").first()
    return first is not None and first.pk == traveller.pk


def add_guest(booking_id, room_id, data, admin):
    with transaction.atomic():
        booking = _lock_for_guests(booking_id, admin)
        room = booking.rooms.filter(pk=room_id).first()
        if room is None:
            raise ValidationError({"room": ["Choose one of the booking's rooms."]})
        if room.travellers.count() >= room.guest_limit:
            raise ValidationError({"room": [f"This room holds at most {room.guest_limit} guests."]})
        return Traveller.objects.create(hotel_room=room, **data)


def change_guest(traveller, data, admin):
    with transaction.atomic():
        _lock_for_guests(traveller.hotel_room.booking_id, admin)
        for name, value in data.items():
            setattr(traveller, name, value)
        traveller.save()
        return traveller


def remove_guest(traveller, admin):
    with transaction.atomic():
        _lock_for_guests(traveller.hotel_room.booking_id, admin)
        if is_lead_guest(traveller):
            raise Conflict("Each room keeps its lead guest; edit their details instead.")
        traveller.delete()


# Scheduled jobs


def _expire(booking_ids, from_status):
    expired = 0
    for booking_id in booking_ids:
        try:
            transition(booking_id, Status.EXPIRED, actor=None, from_status=from_status)
        except InvalidTransition:
            continue
        expired += 1
    return expired


def expire_unpaid():
    """Availability-confirmed bookings past their payment deadline."""
    ids = HotelBooking.objects.filter(status=Status.AVAILABILITY_CONFIRMED, payment_deadline__lt=timezone.now())
    return _expire(list(ids.values_list("pk", flat=True)), Status.AVAILABILITY_CONFIRMED)


def expire_stale():
    """Bookings still requested on their check-in day."""
    ids = HotelBooking.objects.filter(status=Status.REQUESTED, check_in__lte=timezone.localdate())
    return _expire(list(ids.values_list("pk", flat=True)), Status.REQUESTED)


def _reminder_due(now, hours_before):
    return HotelBooking.objects.filter(
        status=Status.AVAILABILITY_CONFIRMED,
        reminder_sent_at__isnull=True,
        payment_deadline__gt=now,
        payment_deadline__lte=now + timedelta(hours=hours_before),
    )


def send_reminders():
    hours_before = AppSettings.get().reminder_hours_before
    sent = 0
    for booking_id in list(_reminder_due(timezone.now(), hours_before).values_list("pk", flat=True)):
        with transaction.atomic():
            booking = _reminder_due(timezone.now(), hours_before).select_for_update().filter(pk=booking_id).first()
            if booking is None:
                continue
            booking.reminder_sent_at = timezone.now()
            booking.save(update_fields=["reminder_sent_at"])
            queue(tasks.notify_customer_hotel_payment_reminder, booking_id)
        sent += 1
    return sent
