from django.utils import timezone
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserSerializer
from bookings.serializers import TravellerSerializer
from core.files import check_upload
from core.models import AppSettings
from reviews.models import annotated_rating
from reviews.serializers import ReviewFields
from tenants import richtext
from tours.serializers import TourPhotoUploadSerializer, photo_url

from . import pricing
from .models import (
    MAX_AMENITIES,
    MAX_INCLUSIONS,
    MAX_NIGHTS,
    MAX_ROOMS,
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
from .services import ADMIN_EDITS_GUESTS, CUSTOMER_EDITS_GUESTS, customer_can_cancel

MAX_DESCRIPTION = 10000

HOTEL_FIELDS = [
    "name",
    "destination",
    "address",
    "star_rating",
    "summary",
    "description",
    "amenities",
    "check_in_time",
    "check_out_time",
    "cancellation_policy",
]


class HotelPhotoSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = HotelPhoto
        fields = ["id", "url"]
        read_only_fields = fields

    def get_url(self, photo):
        return photo_url(photo, self.context)


class HotelPhotoUploadSerializer(TourPhotoUploadSerializer):
    pass


def _stay(context):
    """The stay and guests asked for in the serializer context: (check_in, check_out, adults, children)."""
    return context.get("check_in"), context.get("check_out"), context.get("adults"), context.get("children")


class OfferedRateSerializer(serializers.Serializer):
    """A rate as the room table shows it; with dates, its prices for the stay or available false."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    inclusions = serializers.ListField(read_only=True)
    max_adults = serializers.IntegerField(read_only=True)
    max_children = serializers.IntegerField(read_only=True)
    per_adult_per_night = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    def to_representation(self, rate):
        data = super().to_representation(rate)
        check_in, check_out, adults, _ = _stay(self.context)
        data.update(available=None, nights=None, room_price=None, stay_price=None)
        if check_in and check_out:
            price = pricing.room_price(rate, check_in, check_out)
            data["available"] = price is not None
            if price is not None:
                data["nights"] = pricing.nights(check_in, check_out)
                data["room_price"] = str(price)
                data["stay_price"] = str(
                    pricing.stay_price(rate, check_in, check_out, pricing.adults_priced(rate, adults))
                )
        return data


class OfferedRoomTypeSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    max_adults = serializers.IntegerField(read_only=True)
    max_children = serializers.IntegerField(read_only=True)


class HotelSerializer(serializers.ModelSerializer):
    """Needs a hotel from pricing.public_hotels(); the context may hold the stay and guests."""

    from_price = serializers.SerializerMethodField()
    photos = HotelPhotoSerializer(many=True, read_only=True)
    room_types = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()

    class Meta:
        model = Hotel
        fields = ["id", *HOTEL_FIELDS, "is_featured", "from_price", "photos", "room_types", "rating"]
        read_only_fields = fields

    def get_rating(self, hotel):
        return annotated_rating(hotel)

    def get_from_price(self, hotel):
        price = getattr(hotel, "listed_price", None)
        if price is None:
            price = pricing.from_price(hotel, *_stay(self.context))
        return None if price is None else str(price)

    def get_room_types(self, hotel):
        current = {rate.pk for rate in pricing.current_rates(hotel)}
        room_types = []
        for room_type in hotel.offered_types:
            rates = [rate for rate in room_type.offered_rates if rate.pk in current]
            if rates:
                room_types.append(
                    {
                        **OfferedRoomTypeSerializer(room_type).data,
                        "rates": OfferedRateSerializer(rates, many=True, context=self.context).data,
                    }
                )
        return room_types


class StaySerializer(serializers.Serializer):
    """The public hotels' stay and guest parameters."""

    check_in = serializers.DateField(required=False)
    check_out = serializers.DateField(required=False)
    adults = serializers.IntegerField(min_value=1, max_value=10, required=False)
    children = serializers.IntegerField(min_value=0, max_value=6, required=False)

    def validate(self, attrs):
        check_in, check_out = attrs.get("check_in"), attrs.get("check_out")
        if bool(check_in) != bool(check_out):
            raise serializers.ValidationError({"check_out": ["Choose both the check-in and check-out dates."]})
        if check_in:
            _check_stay(check_in, check_out)
        return attrs


def _check_stay(check_in, check_out):
    if check_in < timezone.localdate():
        raise serializers.ValidationError({"check_in": ["Check-in cannot be in the past."]})
    if not 1 <= (check_out - check_in).days <= MAX_NIGHTS:
        raise serializers.ValidationError({"check_out": [f"A stay is from 1 to {MAX_NIGHTS} nights."]})


# Admin


class AdminPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = RatePeriod
        fields = ["id", "start_date", "end_date", "price_per_night"]
        read_only_fields = ["id"]

    def validate_price_per_night(self, value):
        if value <= 0:
            raise serializers.ValidationError("The price per night must be greater than 0.")
        return value

    def validate(self, attrs):
        if attrs["end_date"] < attrs["start_date"]:
            raise serializers.ValidationError({"end_date": ["The period can't end before it starts."]})
        return attrs


class ShortLinesField(serializers.ListField):
    """Short lines of text; blank ones are dropped."""

    def __init__(self, max_lines, max_length, **kwargs):
        self.max_lines = max_lines
        super().__init__(child=serializers.CharField(max_length=max_length, allow_blank=True), **kwargs)

    def to_internal_value(self, data):
        lines = [line.strip() for line in super().to_internal_value(data) if line.strip()]
        if len(lines) > self.max_lines:
            raise serializers.ValidationError(f"Keep it to {self.max_lines} lines.")
        return lines


def _name(value, message):
    value = value.strip()
    if not value:
        raise serializers.ValidationError(message)
    return value


def _unique_names(items, message):
    names = [item["name"].lower() for item in items]
    if len(set(names)) != len(names):
        raise serializers.ValidationError(message)


class AdminRateSerializer(serializers.ModelSerializer):
    """Input and output of a rate with its periods; output needs booked annotated."""

    id = serializers.UUIDField(required=False, allow_null=True)
    inclusions = ShortLinesField(MAX_INCLUSIONS, 80, required=False, default=list)
    max_adults = serializers.IntegerField(min_value=1, max_value=10)
    max_children = serializers.IntegerField(min_value=0, max_value=6, default=0)
    per_adult_per_night = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, default=0)
    is_active = serializers.BooleanField(default=True)
    periods = AdminPeriodSerializer(many=True)
    booked = serializers.SerializerMethodField()

    class Meta:
        model = RoomRate
        fields = [
            "id",
            "name",
            "inclusions",
            "max_adults",
            "max_children",
            "per_adult_per_night",
            "is_active",
            "periods",
            "booked",
        ]

    def get_booked(self, rate):
        return rate.pk in self.context.get("booked_rates", set())

    def validate_name(self, value):
        return _name(value, "Enter the rate's name.")

    def validate_periods(self, periods):
        ordered = sorted(periods, key=lambda period: period["start_date"])
        for before, after in zip(ordered, ordered[1:], strict=False):
            if after["start_date"] <= before["end_date"]:
                raise serializers.ValidationError(
                    f"Periods overlap: {before['start_date']} – {before['end_date']} and "
                    f"{after['start_date']} – {after['end_date']}."
                )
        return ordered


class AdminRoomTypeSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False, allow_null=True)
    description = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    max_adults = serializers.IntegerField(min_value=1, max_value=10)
    max_children = serializers.IntegerField(min_value=0, max_value=6, default=0)
    is_active = serializers.BooleanField(default=True)
    rates = AdminRateSerializer(many=True)
    booked = serializers.SerializerMethodField()

    class Meta:
        model = RoomType
        fields = ["id", "name", "description", "max_adults", "max_children", "is_active", "rates", "booked"]

    def get_booked(self, room_type):
        return room_type.pk in self.context.get("booked_types", set())

    def validate_name(self, value):
        return _name(value, "Enter the room type's name.")

    def validate(self, attrs):
        _unique_names(attrs["rates"], f"{attrs['name']}: each rate needs a different name.")
        for rate in attrs["rates"]:
            if rate["max_adults"] > attrs["max_adults"] or rate["max_children"] > attrs["max_children"]:
                raise serializers.ValidationError(
                    {
                        "rates": [
                            f"{rate['name']} sleeps more than {attrs['name']} holds "
                            f"({attrs['max_adults']} adults, {attrs['max_children']} children)."
                        ]
                    }
                )
        return attrs


class AdminHotelSerializer(serializers.ModelSerializer):
    """Output: needs a hotel from views.admin_hotels(); context booked_types and booked_rates."""

    from_price = serializers.SerializerMethodField()
    photos = HotelPhotoSerializer(many=True, read_only=True)
    room_types = AdminRoomTypeSerializer(many=True, read_only=True)
    rating = serializers.SerializerMethodField()

    class Meta:
        model = Hotel
        fields = [
            "id",
            *HOTEL_FIELDS,
            "is_active",
            "is_featured",
            "from_price",
            "photos",
            "room_types",
            "rating",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_from_price(self, hotel):
        price = pricing.from_price(hotel)
        return None if price is None else str(price)

    def get_rating(self, hotel):
        return annotated_rating(hotel)


class HotelInputSerializer(serializers.ModelSerializer):
    """Create, or PATCH (room_types, when given, replace the list)."""

    star_rating = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True)
    amenities = ShortLinesField(MAX_AMENITIES, 100, required=False)
    is_active = serializers.BooleanField(required=False)
    is_featured = serializers.BooleanField(required=False)
    room_types = AdminRoomTypeSerializer(many=True, required=False)

    class Meta:
        model = Hotel
        fields = [*HOTEL_FIELDS, "is_active", "is_featured", "room_types"]

    def validate_name(self, value):
        return _name(value, "Enter the hotel's name.")

    def validate_destination(self, value):
        return _name(value, "Enter the destination.")

    def validate_address(self, value):
        return _name(value, "Enter the address.")

    def validate_summary(self, value):
        return _name(value, "Enter a short summary.")

    def validate_cancellation_policy(self, value):
        return _name(value, "Enter the cancellation policy.")

    def validate_description(self, value):
        cleaned = richtext.sanitize(value)
        if len(cleaned) > MAX_DESCRIPTION:
            raise serializers.ValidationError(
                f"Keep the description under {MAX_DESCRIPTION:,} characters of formatted text."
            )
        return cleaned

    def validate_room_types(self, room_types):
        _unique_names(room_types, "Each room type needs a different name.")
        return room_types


# Bookings


class HotelBriefSerializer(serializers.ModelSerializer):
    """The hotel as a booking shows it."""

    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Hotel
        fields = [
            "id",
            "name",
            "destination",
            "address",
            "star_rating",
            "check_in_time",
            "check_out_time",
            "cancellation_policy",
            "cover_url",
        ]
        read_only_fields = fields

    def get_cover_url(self, hotel):
        photos = list(hotel.photos.all())
        return photo_url(photos[0], self.context) if photos else None


class HotelBookingRoomSerializer(serializers.ModelSerializer):
    guests = TravellerSerializer(source="travellers", many=True, read_only=True)

    class Meta:
        model = HotelBookingRoom
        fields = [
            "id",
            "room_type",
            "rate",
            "room_name",
            "rate_name",
            "per_adult_per_night",
            "price",
            "adults",
            "children",
            "guests",
        ]
        read_only_fields = fields


class HotelBookingEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = HotelBookingEvent
        fields = ["id", "from_status", "to_status", "created_at"]
        read_only_fields = fields


class HotelVoucherSerializer(serializers.ModelSerializer):
    class Meta:
        model = HotelVoucher
        fields = ["id", "original_name", "uploaded_at"]
        read_only_fields = fields


class HotelBookingSerializer(ReviewFields, serializers.ModelSerializer):
    hotel = HotelBriefSerializer(read_only=True)
    rooms = HotelBookingRoomSerializer(many=True, read_only=True)
    nights = serializers.IntegerField(read_only=True)
    events = HotelBookingEventSerializer(many=True, read_only=True)
    vouchers = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    can_edit_guests = serializers.SerializerMethodField()
    payment_instructions = serializers.SerializerMethodField()

    class Meta:
        model = HotelBooking
        fields = [
            "id",
            "hotel",
            "check_in",
            "check_out",
            "nights",
            "rooms",
            "total",
            "status",
            "changes",
            "changes_accepted",
            "payment_deadline",
            "unavailable_message",
            "hotel_confirmation",
            "special_requests",
            "notes",
            "events",
            "vouchers",
            "can_cancel",
            "can_edit_guests",
            "payment_instructions",
            "created_at",
            "can_review",
            "review",
        ]
        read_only_fields = fields

    review_kind = "hotel"

    def get_vouchers(self, booking):
        """The customer sees the vouchers once they have been sent."""
        if booking.status != HotelBooking.Status.COMPLETED:
            return []
        return HotelVoucherSerializer(booking.vouchers.all(), many=True).data

    def get_can_cancel(self, booking):
        return customer_can_cancel(booking)

    def get_can_edit_guests(self, booking):
        return booking.status in CUSTOMER_EDITS_GUESTS

    def get_payment_instructions(self, booking):
        if booking.status != HotelBooking.Status.AVAILABILITY_CONFIRMED:
            return None
        return AppSettings.get().payment_instructions


class AdminHotelBookingSerializer(HotelBookingSerializer):
    user = UserSerializer(read_only=True)
    created_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    can_review = None
    review = None

    class Meta(HotelBookingSerializer.Meta):
        fields = [*HotelBookingSerializer.Meta.fields[:-2], "user", "created_by"]
        read_only_fields = fields

    def get_vouchers(self, booking):
        return HotelVoucherSerializer(booking.vouchers.all(), many=True).data

    def get_can_cancel(self, booking):
        return False

    def get_can_edit_guests(self, booking):
        return booking.status in ADMIN_EDITS_GUESTS


class HotelRoomInputSerializer(serializers.Serializer):
    room_type = serializers.UUIDField()
    rate = serializers.UUIDField()
    adults = serializers.IntegerField(min_value=1, max_value=10)
    children = serializers.IntegerField(min_value=0, max_value=6, default=0)
    guests = TravellerSerializer(many=True)

    def validate(self, attrs):
        guests, limit = attrs["guests"], attrs["adults"] + attrs["children"]
        if not guests:
            raise serializers.ValidationError({"guests": ["Enter the room's lead guest."]})
        if len(guests) > limit:
            raise serializers.ValidationError({"guests": [f"This room holds at most {limit} guests."]})
        return attrs


class HotelBookingCreateSerializer(serializers.Serializer):
    """Input for create_booking; the rooms' rates and the dates are checked there, under lock."""

    hotel = serializers.UUIDField()
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    rooms = HotelRoomInputSerializer(many=True)
    special_requests = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    # Saved to the booker's account when it has none.
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")

    def validate_rooms(self, rooms):
        if not 1 <= len(rooms) <= MAX_ROOMS:
            raise serializers.ValidationError(f"Choose from 1 to {MAX_ROOMS} rooms.")
        return rooms

    def validate(self, attrs):
        _check_stay(attrs["check_in"], attrs["check_out"])
        return attrs


class AdminHotelBookingCreateSerializer(HotelBookingCreateSerializer):
    user = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.Role.CUSTOMER, is_active=True),
        error_messages={"does_not_exist": "Choose an active customer."},
    )


class ConfirmAvailabilitySerializer(serializers.Serializer):
    new_total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

    def validate_new_total(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("The total must be greater than 0.")
        return value

    def validate(self, attrs):
        attrs["note"] = attrs["note"].strip()
        if attrs["note"] and attrs.get("new_total") is None:
            raise serializers.ValidationError({"new_total": ["Enter the new total the note explains."]})
        return attrs


class MarkUnavailableSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class CompleteSerializer(serializers.Serializer):
    hotel_confirmation = serializers.CharField(max_length=40)

    def validate_hotel_confirmation(self, value):
        return _name(value, "Enter the hotel's confirmation number.")


class VoucherUploadSerializer(serializers.Serializer):
    file = serializers.FileField(max_length=255)

    def validate_file(self, file):
        return check_upload(file)


def stay_context(params):
    """Validated stay and guest parameters, as the serializer context the hotels' prices use."""
    serializer = StaySerializer(data=params)
    serializer.is_valid(raise_exception=True)
    return dict(serializer.validated_data)
