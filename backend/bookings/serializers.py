from datetime import date

from django.utils import timezone
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserSerializer
from airlines.models import Airline
from airlines.serializers import AirlineSerializer
from catalog.itinerary import airlines_in, itinerary_errors
from catalog.models import Offer, Trip
from catalog.serializers import OfferSerializer, SegmentInputSerializer, itinerary_data
from core.files import check_upload
from core.models import AppSettings
from customer_requests.models import Query
from reviews.serializers import ReviewFields

from .models import BoardingPass, Booking, BookingEvent, Traveller
from .services import ADMIN_EDITS_PASSENGERS, CUSTOMER_EDITS_PASSENGERS


class BookingEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingEvent
        fields = ["id", "from_status", "to_status", "created_at"]
        read_only_fields = fields


class BoardingPassSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardingPass
        fields = ["id", "original_name", "uploaded_at"]
        read_only_fields = fields


class BoardingPassUploadSerializer(serializers.Serializer):
    file = serializers.FileField(max_length=255)

    def validate_file(self, file):
        return check_upload(file)


class TravellerSerializer(serializers.ModelSerializer):
    """The shared traveller form: only full_name is required."""

    checked_bags = serializers.IntegerField(min_value=0, max_value=Traveller.MAX_CHECKED_BAGS, default=0)
    checked_bag_kg = serializers.IntegerField(min_value=1, max_value=100, required=False, allow_null=True)
    cabin_bag_kg = serializers.IntegerField(min_value=1, max_value=100, required=False, allow_null=True)

    class Meta:
        model = Traveller
        fields = [
            "id",
            "full_name",
            "gender",
            "date_of_birth",
            "nationality",
            "document_type",
            "document_number",
            "document_expiry",
            "email",
            "phone",
            "checked_bags",
            "checked_bag_kg",
            "cabin_bag_kg",
            "special_requests",
        ]
        read_only_fields = ["id"]

    def validate_full_name(self, value):
        value = " ".join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError("Enter the full name as on the travel document.")
        return value

    def validate_nationality(self, value):
        value = value.strip().upper()
        if value and not (len(value) == 2 and value.isascii() and value.isalpha()):
            raise serializers.ValidationError("Choose a country.")
        return value

    def validate_document_number(self, value):
        return value.strip().upper()

    def current(self, attrs, name):
        return attrs.get(name, getattr(self.instance, name) if self.instance else None)

    def validate(self, attrs):
        number, expiry, kind = (
            self.current(attrs, name) for name in ("document_number", "document_expiry", "document_type")
        )
        if number and not kind:
            raise serializers.ValidationError({"document_type": "Choose the document type."})
        if expiry and not number:
            raise serializers.ValidationError({"document_number": "Enter the document number with its expiry."})
        if number and kind == Traveller.DocumentType.PASSPORT and not expiry:
            raise serializers.ValidationError({"document_expiry": "Enter the passport's expiry date."})
        return attrs


def last_flight_date(segments):
    return max(segment.departure_date for segment in segments)


def passport_error(traveller, last_date):
    """The error for a passport that expires on or before the last flight's date, or None."""
    expiry = traveller.get("document_expiry")
    if traveller.get("document_type") == Traveller.DocumentType.PASSPORT and expiry and expiry <= last_date:
        return {"document_expiry": ["Passport expires before the trip."]}
    return None


class PassengerSerializer(TravellerSerializer):
    """A flight passenger: identity and document are required; context["last_flight_date"] checks the passport."""

    REQUIRED = {
        "gender": "Choose the gender.",
        "date_of_birth": "Enter the date of birth.",
        "nationality": "Choose the nationality.",
        "document_type": "Choose the document type.",
        "document_number": "Enter the document number.",
    }

    def validate_date_of_birth(self, value):
        today = timezone.localdate()
        if value is None:
            return value
        if value > today:
            raise serializers.ValidationError("The date of birth cannot be in the future.")
        try:
            earliest = today.replace(year=today.year - 120)
        except ValueError:
            earliest = date(today.year - 120, 2, 28)
        if value < earliest:
            raise serializers.ValidationError("Enter a date of birth within the last 120 years.")
        return value

    def validate(self, attrs):
        if missing := {name: message for name, message in self.REQUIRED.items() if not self.current(attrs, name)}:
            raise serializers.ValidationError(missing)
        attrs = super().validate(attrs)
        last_date = self.context.get("last_flight_date")
        merged = {name: self.current(attrs, name) for name in ("document_type", "document_expiry")}
        if last_date and (error := passport_error(merged, last_date)):
            raise serializers.ValidationError(error)
        return attrs


class PassengersInputSerializer(serializers.Serializer):
    """Exactly passenger_count complete passengers, with passports valid after the offer's last flight."""

    travellers = PassengerSerializer(many=True)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        travellers, count = attrs["travellers"], attrs["passenger_count"]
        if len(travellers) != count:
            raise serializers.ValidationError(
                {
                    "travellers": [
                        f"Enter the details of {'the passenger' if count == 1 else f'all {count} passengers'}."
                    ]
                }
            )
        offer = Offer.objects.filter(pk=attrs["offer"]).first()
        if offer is not None:
            last_date = last_flight_date(offer.segments.all())
            errors = {
                index: error
                for index, traveller in enumerate(travellers)
                if (error := passport_error(traveller, last_date))
            }
            if errors:
                raise serializers.ValidationError({"travellers": errors})
        return attrs


class BookingCreateSerializer(PassengersInputSerializer, serializers.ModelSerializer):
    """Input for create_booking; the offer's visibility and bookability are checked there, under lock."""

    offer = serializers.UUIDField()
    query = serializers.PrimaryKeyRelatedField(queryset=Query.objects.none(), required=False, allow_null=True)

    class Meta:
        model = Booking
        fields = ["offer", "passenger_count", "notes", "query", "travellers"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only the customer's own queries can be linked.
        self.fields["query"].queryset = Query.objects.filter(user=self.context["request"].user)


class BookingSerializer(serializers.ModelSerializer):
    """The trip fields and itinerary are the booking's own, copied from the offer when it was booked."""

    offer = OfferSerializer(read_only=True)
    # The booking's own ticketing airline.
    airline = AirlineSerializer(read_only=True)
    total_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "offer",
            "airline",
            "query",
            "passenger_count",
            "notes",
            "unit_price",
            "total_price",
            *Trip.FIELDS,
            "status",
            "payment_deadline",
            "changes",
            "changes_accepted",
            # The request holding options suggested when the booking was marked unavailable.
            "alternatives",
            "created_at",
        ]
        read_only_fields = fields

    def to_representation(self, booking):
        return {**super().to_representation(booking), **itinerary_data(booking.segments.all(), self.context)}


class CustomerBookingSerializer(ReviewFields, BookingSerializer):
    review_kind = "flight"

    class Meta(BookingSerializer.Meta):
        fields = [*BookingSerializer.Meta.fields, "can_review", "review"]
        read_only_fields = fields


class BookingDetailSerializer(CustomerBookingSerializer):
    events = BookingEventSerializer(many=True, read_only=True)
    payment_instructions = serializers.SerializerMethodField()
    travellers = TravellerSerializer(many=True, read_only=True)
    can_edit_travellers = serializers.SerializerMethodField()

    class Meta(CustomerBookingSerializer.Meta):
        fields = [
            *CustomerBookingSerializer.Meta.fields,
            "events",
            "payment_instructions",
            "travellers",
            "can_edit_travellers",
        ]
        read_only_fields = fields

    def get_can_edit_travellers(self, booking):
        return booking.status in CUSTOMER_EDITS_PASSENGERS

    def get_payment_instructions(self, booking):
        """Shown to the customer only while payment is due."""
        if booking.status != Booking.Status.AVAILABILITY_CONFIRMED:
            return None
        return AppSettings.get().payment_instructions

    def to_representation(self, booking):
        data = super().to_representation(booking)
        # The customer sees the passes only once they have been sent.
        if booking.status == Booking.Status.COMPLETED:
            data["boarding_passes"] = BoardingPassSerializer(booking.boarding_passes.all(), many=True).data
        return data


class AdminBookingSerializer(BookingSerializer):
    """Also where the booking's fare came from: source, integration ({id, name} or null) and fare_key."""

    user = UserSerializer(read_only=True)

    class Meta(BookingSerializer.Meta):
        fields = [*BookingSerializer.Meta.fields, "user", "source", "integration", "fare_key"]
        read_only_fields = fields

    def to_representation(self, booking):
        data = super().to_representation(booking)
        integration = booking.integration
        data["integration"] = {"id": str(integration.pk), "name": integration.name} if integration else None
        return data


class AdminBookingDetailSerializer(AdminBookingSerializer):
    events = BookingEventSerializer(many=True, read_only=True)
    boarding_passes = BoardingPassSerializer(many=True, read_only=True)
    travellers = TravellerSerializer(many=True, read_only=True)
    can_edit_travellers = serializers.SerializerMethodField()

    class Meta(AdminBookingSerializer.Meta):
        fields = [*AdminBookingSerializer.Meta.fields, "events", "boarding_passes", "travellers", "can_edit_travellers"]
        read_only_fields = fields

    def get_can_edit_travellers(self, booking):
        return booking.status in ADMIN_EDITS_PASSENGERS


class ConfirmAvailabilitySerializer(serializers.Serializer):
    """Optional changes made on confirming; context["booking"] is the booking being confirmed."""

    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    # The ticketing airline, e.g. when the flights change to another airline's.
    airline = serializers.PrimaryKeyRelatedField(queryset=Airline.objects.all(), required=False)
    segments = SegmentInputSerializer(many=True, required=False)

    def validate_unit_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than 0.")
        return value

    def validate_airline(self, airline):
        # The booking may keep an airline deactivated later; choosing another needs it active.
        if not airline.is_active and airline.pk != self.context["booking"].airline_id:
            raise serializers.ValidationError("This airline is no longer active.")
        return airline

    def validate_segments(self, segments):
        """The booking keeps its trip type and route; its flights and dates may change."""
        booking = self.context["booking"]
        existing = [s.as_data() for s in booking.segments.all()]
        route = (booking.offer.origin, booking.offer.destination)
        if messages := itinerary_errors(booking.trip_type, segments, airlines_in(existing), route):
            raise serializers.ValidationError(messages)
        return segments


class AdminBookingCreateSerializer(PassengersInputSerializer, serializers.ModelSerializer):
    """The admin booking for a customer: an active customer and any bookable offer (checked under lock)."""

    user = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.Role.CUSTOMER, is_active=True),
        error_messages={"does_not_exist": "Choose an active customer."},
    )
    offer = serializers.UUIDField()

    class Meta:
        model = Booking
        fields = ["user", "offer", "passenger_count", "notes", "travellers"]
