import os

from rest_framework import serializers

from accounts.serializers import UserSerializer
from catalog.serializers import OfferSerializer
from core.models import AppSettings
from customer_requests.models import Query

from .models import BoardingPass, Booking, BookingEvent

# How each allowed content type's files begin.
FILE_SIGNATURES = {
    "application/pdf": b"%PDF-",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}


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
        extension = os.path.splitext(file.name)[1].lower()
        content_type = BoardingPass.CONTENT_TYPES.get(extension)
        if content_type is None or file.content_type != content_type:
            raise serializers.ValidationError("Upload a PDF, PNG or JPEG file.")
        signature = FILE_SIGNATURES[content_type]
        head = file.read(len(signature))
        file.seek(0)
        if head != signature:
            raise serializers.ValidationError("The file's content does not match its type.")
        if file.size > BoardingPass.MAX_SIZE:
            raise serializers.ValidationError("The file is larger than 5 MB.")
        return file


class BookingCreateSerializer(serializers.ModelSerializer):
    """Input for create_booking; the offer's visibility and bookability are checked there, under lock."""

    offer = serializers.IntegerField()
    query = serializers.PrimaryKeyRelatedField(queryset=Query.objects.none(), required=False, allow_null=True)

    class Meta:
        model = Booking
        fields = ["offer", "passenger_count", "notes", "query"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Only the customer's own queries can be linked.
        self.fields["query"].queryset = Query.objects.filter(user=self.context["request"].user)


class BookingSerializer(serializers.ModelSerializer):
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
