from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserSerializer
from airlines.models import Airline
from airlines.serializers import AirlineSerializer
from catalog.itinerary import airlines_in, itinerary_errors
from catalog.models import Trip
from catalog.serializers import OfferSerializer, SegmentInputSerializer, itinerary_data
from core.files import check_upload
from core.models import AppSettings
from customer_requests.models import Query

from .models import BoardingPass, Booking, BookingEvent, Traveller


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


class BookingCreateSerializer(serializers.ModelSerializer):
    """Input for create_booking; the offer's visibility and bookability are checked there, under lock."""

    offer = serializers.UUIDField()
    query = serializers.PrimaryKeyRelatedField(queryset=Query.objects.none(), required=False, allow_null=True)

    class Meta:
        model = Booking
        fields = ["offer", "passenger_count", "notes", "query"]

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


class BookingDetailSerializer(BookingSerializer):
    events = BookingEventSerializer(many=True, read_only=True)
    payment_instructions = serializers.SerializerMethodField()

    class Meta(BookingSerializer.Meta):
        fields = [*BookingSerializer.Meta.fields, "events", "payment_instructions"]
        read_only_fields = fields

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

    class Meta(AdminBookingSerializer.Meta):
        fields = [*AdminBookingSerializer.Meta.fields, "events", "boarding_passes"]
        read_only_fields = fields


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


class AdminBookingCreateSerializer(serializers.ModelSerializer):
    """The admin booking for a customer: an active customer and any bookable offer (checked under lock)."""

    user = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role=User.Role.CUSTOMER, is_active=True),
        error_messages={"does_not_exist": "Choose an active customer."},
    )
    offer = serializers.UUIDField()

    class Meta:
        model = Booking
        fields = ["user", "offer", "passenger_count", "notes"]


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

    def validate(self, attrs):
        def current(name):
            return attrs.get(name, getattr(self.instance, name) if self.instance else None)

        number, expiry, kind = current("document_number"), current("document_expiry"), current("document_type")
        if number and not kind:
            raise serializers.ValidationError({"document_type": "Choose the document type."})
        if expiry and not number:
            raise serializers.ValidationError({"document_number": "Enter the document number with its expiry."})
        if number and kind == Traveller.DocumentType.PASSPORT and not expiry:
            raise serializers.ValidationError({"document_expiry": "Enter the passport's expiry date."})
        return attrs
