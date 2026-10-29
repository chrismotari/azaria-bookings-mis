from rest_framework import serializers

from accounts.serializers import UserSerializer
from catalog.serializers import OfferingSerializer
from core.models import AppSettings
from customer_requests.models import Query

from .models import Booking, BookingEvent


class BookingEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingEvent
        fields = ["id", "from_status", "to_status", "created_at"]
        read_only_fields = fields


class BookingCreateSerializer(serializers.ModelSerializer):
    """Input for create_booking; the offering's visibility and bookability are checked there, under lock."""

    offering = serializers.IntegerField()
    query = serializers.PrimaryKeyRelatedField(queryset=Query.objects.none(), required=False, allow_null=True)

    class Meta:
        model = Booking
        fields = ["offering", "passenger_count", "notes", "query"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only the customer's own queries can be linked.
        self.fields["query"].queryset = Query.objects.filter(user=self.context["request"].user)


class BookingSerializer(serializers.ModelSerializer):
    offering = OfferingSerializer(read_only=True)
    total_price = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id",
            "offering",
            "query",
            "passenger_count",
            "notes",
            "unit_price",
            "total_price",
            "status",
            "payment_deadline",
            "created_at",
        ]
        read_only_fields = fields


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


class AdminBookingSerializer(BookingSerializer):
    user = UserSerializer(read_only=True)

    class Meta(BookingSerializer.Meta):
        fields = [*BookingSerializer.Meta.fields, "user"]
        read_only_fields = fields


class AdminBookingDetailSerializer(AdminBookingSerializer):
    events = BookingEventSerializer(many=True, read_only=True)

    class Meta(AdminBookingSerializer.Meta):
        fields = [*AdminBookingSerializer.Meta.fields, "events"]
        read_only_fields = fields
