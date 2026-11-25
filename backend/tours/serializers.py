import os

from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserSerializer
from airlines.models import LOGO_SIGNATURES
from bookings.serializers import TravellerSerializer
from core.models import AppSettings
from reviews.models import annotated_rating
from reviews.serializers import ReviewFields
from tenants import richtext

from .models import MAX_LIST_LINES, Tour, TourBooking, TourBookingEvent, TourBookingLine, TourNotice, TourPhoto
from .services import admin_can_cancel, customer_can_cancel

MAX_DESCRIPTION = 10000
MAX_PHOTO_SIZE = 2 * 1024 * 1024


def photo_url(photo, context):
    request = context.get("request")
    return request.build_absolute_uri(photo.image.url) if request else photo.image.url


class TourPhotoSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = TourPhoto
        fields = ["id", "url"]
        read_only_fields = fields

    def get_url(self, photo):
        return photo_url(photo, self.context)


class TourOptionSerializer(serializers.Serializer):
    """Needs options annotated by with_sold()."""

    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    people_per_unit = serializers.IntegerField(read_only=True)
    units_available = serializers.IntegerField(read_only=True)
    units_left = serializers.IntegerField(read_only=True)


class AdminTourOptionSerializer(TourOptionSerializer):
    units_sold = serializers.IntegerField(source="sold", read_only=True)
    booked = serializers.BooleanField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)


TOUR_FIELDS = [
    "title",
    "destination",
    "start_date",
    "end_date",
    "slots",
    "booking_deadline",
    "cancellation_deadline",
    "cancellation_policy",
    "summary",
    "description",
    "included",
    "not_included",
    "meeting_point",
]


class TourSerializer(serializers.ModelSerializer):
    """Needs a tour annotated by with_figures() and its options prefetched with_sold() into all_options."""

    slots_left = serializers.IntegerField(read_only=True)
    duration_days = serializers.IntegerField(read_only=True)
    from_price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    options = serializers.SerializerMethodField()
    photos = TourPhotoSerializer(many=True, read_only=True)
    bookable = serializers.SerializerMethodField()
    not_bookable_reason = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()

    class Meta:
        model = Tour
        fields = [
            "id",
            *TOUR_FIELDS,
            "slots_left",
            "duration_days",
            "from_price",
            "options",
            "photos",
            "bookable",
            "not_bookable_reason",
            "is_featured",
            "rating",
        ]
        read_only_fields = fields

    def get_options(self, tour):
        options = [option for option in tour.all_options if option.is_active]
        return TourOptionSerializer(options, many=True).data

    def get_bookable(self, tour):
        return tour.not_bookable_reason() is None

    def get_not_bookable_reason(self, tour):
        return tour.not_bookable_reason()

    def get_rating(self, tour):
        return annotated_rating(tour)


class AdminTourSerializer(TourSerializer):
    booked = serializers.IntegerField(read_only=True)
    confirmed_bookings = serializers.IntegerField(read_only=True)
    cancelled_by = serializers.CharField(source="cancelled_by.full_name", read_only=True, default=None)

    class Meta(TourSerializer.Meta):
        fields = [
            *TourSerializer.Meta.fields,
            "is_active",
            "booked",
            "confirmed_bookings",
            "cancelled_at",
            "cancelled_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_options(self, tour):
        return AdminTourOptionSerializer(tour.all_options, many=True).data


class TourOptionInputSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False, allow_null=True)
    name = serializers.CharField(max_length=60)
    description = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    people_per_unit = serializers.IntegerField(min_value=1, max_value=20, default=1)
    units_available = serializers.IntegerField(min_value=1, max_value=10000, required=False, allow_null=True)
    is_active = serializers.BooleanField(default=True)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter the option's name.")
        return value

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than 0.")
        return value


class LinesField(serializers.ListField):
    """Short lines of text; blank ones are dropped."""

    child = serializers.CharField(max_length=200, allow_blank=True)

    def to_internal_value(self, data):
        lines = [line.strip() for line in super().to_internal_value(data) if line.strip()]
        if len(lines) > MAX_LIST_LINES:
            raise serializers.ValidationError(f"Keep it to {MAX_LIST_LINES} lines.")
        return lines


class TourInputSerializer(serializers.ModelSerializer):
    """Create (options required) or PATCH (options, when given, replace the list; notice, when the tour has
    confirmed bookings, is emailed to them)."""

    slots = serializers.IntegerField(min_value=1, max_value=500)
    included = LinesField(required=False)
    not_included = LinesField(required=False)
    options = TourOptionInputSerializer(many=True)
    notice = serializers.CharField(max_length=2000, required=False, allow_blank=True, write_only=True)
    is_active = serializers.BooleanField(required=False)
    is_featured = serializers.BooleanField(required=False)

    class Meta:
        model = Tour
        fields = [*TOUR_FIELDS, "is_active", "is_featured", "options", "notice"]

    def validate_description(self, value):
        cleaned = richtext.sanitize(value)
        if len(cleaned) > MAX_DESCRIPTION:
            raise serializers.ValidationError(
                f"Keep the description under {MAX_DESCRIPTION:,} characters of formatted text."
            )
        return cleaned

    def validate_title(self, value):
        return self._required(value, "Enter the tour's title.")

    def validate_destination(self, value):
        return self._required(value, "Enter the destination.")

    def validate_summary(self, value):
        return self._required(value, "Enter a short summary.")

    def validate_cancellation_policy(self, value):
        return self._required(value, "Enter the cancellation policy.")

    def _required(self, value, message):
        if not value.strip():
            raise serializers.ValidationError(message)
        return value.strip()

    def validate_options(self, options):
        # Defaults are not applied to nested fields in a partial update.
        defaults = {"description": "", "people_per_unit": 1, "units_available": None, "is_active": True}
        options = [{**defaults, **option} for option in options]
        names = [option["name"].lower() for option in options]
        if len(set(names)) != len(names):
            raise serializers.ValidationError("Each option needs a different name.")
        if not any(option["is_active"] for option in options):
            raise serializers.ValidationError("Add at least one active price option.")
        return options

    def validate(self, attrs):
        def current(name):
            return attrs.get(name, getattr(self.instance, name, None))

        start = current("start_date")
        errors = {}
        if current("end_date") < start:
            errors["end_date"] = "The tour can't end before it starts."
        if current("booking_deadline") > start:
            errors["booking_deadline"] = "Bookings must close on or before the start date."
        if current("cancellation_deadline") > start:
            errors["cancellation_deadline"] = "Free cancellation must end on or before the start date."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class TourPhotoUploadSerializer(serializers.Serializer):
    image = serializers.FileField(max_length=255)

    def validate_image(self, image):
        """PNG, JPEG or WebP up to 2 MB, its content matching the type (the airline logos' check)."""
        extension = os.path.splitext(image.name)[1].lower()
        if extension not in LOGO_SIGNATURES:
            raise serializers.ValidationError("Upload a PNG, JPEG or WebP image.")
        if image.size > MAX_PHOTO_SIZE:
            raise serializers.ValidationError("The photo is larger than 2 MB.")
        head = image.read(12)
        image.seek(0)
        if not head.startswith(LOGO_SIGNATURES[extension]) or (extension == ".webp" and head[8:12] != b"WEBP"):
            raise serializers.ValidationError("The file's content does not match its type.")
        return image


class TourNoticeSerializer(serializers.ModelSerializer):
    sent_by = serializers.CharField(source="sent_by.full_name", read_only=True, default=None)

    class Meta:
        model = TourNotice
        fields = ["id", "kind", "message", "sent_by", "recipients", "created_at"]
        read_only_fields = fields


# Bookings


class TourBriefSerializer(serializers.ModelSerializer):
    """The tour as a booking shows it."""

    duration_days = serializers.IntegerField(read_only=True)
    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Tour
        fields = [
            "id",
            "title",
            "destination",
            "start_date",
            "end_date",
            "duration_days",
            "meeting_point",
            "cancellation_policy",
            "cancellation_deadline",
            "cancelled_at",
            "cover_url",
        ]
        read_only_fields = fields

    def get_cover_url(self, tour):
        photos = list(tour.photos.all())
        return photo_url(photos[0], self.context) if photos else None


class TourBookingLineSerializer(serializers.ModelSerializer):
    people = serializers.IntegerField(read_only=True)
    total_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    travellers = TravellerSerializer(many=True, read_only=True)

    class Meta:
        model = TourBookingLine
        fields = [
            "id",
            "option",
            "option_name",
            "unit_price",
            "people_per_unit",
            "quantity",
            "people",
            "total_price",
            "travellers",
        ]
        read_only_fields = fields


class TourBookingEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = TourBookingEvent
        fields = ["id", "from_status", "to_status", "created_at"]
        read_only_fields = fields


class TourBookingSerializer(ReviewFields, serializers.ModelSerializer):
    tour = TourBriefSerializer(read_only=True)
    lines = TourBookingLineSerializer(many=True, read_only=True)
    total_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    travellers_added = serializers.SerializerMethodField()
    events = TourBookingEventSerializer(many=True, read_only=True)
    can_cancel = serializers.SerializerMethodField()
    can_edit_travellers = serializers.SerializerMethodField()
    payment_instructions = serializers.SerializerMethodField()

    class Meta:
        model = TourBooking
        fields = [
            "id",
            "tour",
            "lines",
            "people",
            "travellers_added",
            "group_name",
            "notes",
            "total_price",
            "status",
            "cancelled_by",
            "cancel_reason",
            "events",
            "can_cancel",
            "can_edit_travellers",
            "payment_instructions",
            "created_at",
            "can_review",
            "review",
        ]
        read_only_fields = fields

    review_kind = "tour"

    def get_travellers_added(self, booking):
        return sum(len(line.travellers.all()) for line in booking.lines.all())

    def get_can_cancel(self, booking):
        return customer_can_cancel(booking)

    def get_can_edit_travellers(self, booking):
        return booking.status == TourBooking.Status.CONFIRMED

    def get_payment_instructions(self, booking):
        if booking.status != TourBooking.Status.CONFIRMED:
            return None
        return AppSettings.get().payment_instructions


class AdminTourBookingSerializer(TourBookingSerializer):
    user = UserSerializer(read_only=True)
    created_by = serializers.CharField(source="created_by.full_name", read_only=True, default=None)

    can_review = None
    review = None

    class Meta(TourBookingSerializer.Meta):
        fields = [*TourBookingSerializer.Meta.fields[:-2], "user", "created_by"]
        read_only_fields = fields

    def get_can_cancel(self, booking):
        return admin_can_cancel(booking)


class TourBookingLineInputSerializer(serializers.Serializer):
    option = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=40)
    travellers = TravellerSerializer(many=True, required=False, default=list)


class TourBookingCreateSerializer(serializers.Serializer):
    """Input for book_tour; the tour's bookability, slots and units are checked there, under lock."""

    tour = serializers.UUIDField()
    lines = TourBookingLineInputSerializer(many=True)
    group_name = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    # Saved to the booker's account when it has none.
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")

    def validate_lines(self, lines):
        if not lines:
            raise serializers.ValidationError("Choose at least one option.")
        options = [line["option"] for line in lines]
        if len(set(options)) != len(options):
            raise serializers.ValidationError("Each option can be chosen once.")
        return lines


class AdminTourBookingCreateSerializer(TourBookingCreateSerializer):
    user = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.Role.CUSTOMER, is_active=True),
        error_messages={"does_not_exist": "Choose an active customer."},
    )


class AdminCancelSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class CancelTourSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)

    def validate_message(self, value):
        if not value.strip():
            raise serializers.ValidationError("Tell the customers why the tour is cancelled.")
        return value.strip()


class TravellerAddSerializer(TravellerSerializer):
    line = serializers.UUIDField(write_only=True)

    class Meta(TravellerSerializer.Meta):
        fields = [*TravellerSerializer.Meta.fields, "line"]
