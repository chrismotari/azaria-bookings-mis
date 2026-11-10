from rest_framework import serializers

from accounts.models import User
from accounts.serializers import UserSerializer
from catalog.serializers import OfferSerializer, StopInputSerializer, stop_errors, stops_data
from core.files import check_upload
from core.models import AppSettings
from customer_requests.models import Query

from .models import BoardingPass, Booking, BookingEvent

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
    """stops are the booking's own, copied from the offer when it was booked."""

    offer = OfferSerializer(read_only=True)
    total_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "offer",
            "query",
            "passenger_count",
            "notes",
            "unit_price",
            "total_price",
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
        return {**super().to_representation(booking), **stops_data(booking.stops.all())}


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
    user = UserSerializer(read_only=True)

    class Meta(BookingSerializer.Meta):
        fields = [*BookingSerializer.Meta.fields, "user"]
        read_only_fields = fields


class AdminBookingDetailSerializer(AdminBookingSerializer):
    events = BookingEventSerializer(many=True, read_only=True)
    boarding_passes = BoardingPassSerializer(many=True, read_only=True)

    class Meta(AdminBookingSerializer.Meta):
        fields = [*AdminBookingSerializer.Meta.fields, "events", "boarding_passes"]
        read_only_fields = fields


class ConfirmAvailabilitySerializer(serializers.Serializer):
    """Optional changes made on confirming; context["booking"] is the booking being confirmed."""

    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    stops = StopInputSerializer(many=True, required=False)

    def validate_unit_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than 0.")
        return value

    def validate_stops(self, stops):
        offer = self.context["booking"].offer
        if messages := stop_errors(offer.origin, offer.destination, stops):
            raise serializers.ValidationError(messages)
        return stops


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
