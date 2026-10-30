from django.utils import timezone
from rest_framework import serializers

from .models import Airport, Offer


class AirportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Airport
        fields = ["id", "code", "name", "city", "country"]


class OfferSerializer(serializers.ModelSerializer):
    """Read-only representation used by browse and detail."""

    origin = AirportSerializer(read_only=True)
    destination = AirportSerializer(read_only=True)
    is_bookable = serializers.BooleanField(read_only=True)

    class Meta:
        model = Offer
        fields = [
            "id",
            "origin",
            "destination",
            "departure_date",
            "ticket_class",
            "price",
            "stopovers",
            "airline",
            "valid_until",
            "is_bookable",
        ]
        read_only_fields = fields


class AdminOfferSerializer(serializers.ModelSerializer):
    """Airports are written by id and read as nested objects."""

    is_bookable = serializers.BooleanField(read_only=True)

    class Meta:
        model = Offer
        fields = [
            "id",
            "origin",
            "destination",
            "departure_date",
            "ticket_class",
            "price",
            "stopovers",
            "airline",
            "valid_until",
            "is_public",
            "is_active",
            "is_bookable",
            "created_at",
        ]
        read_only_fields = ["id", "is_bookable", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["origin"] = AirportSerializer(instance.origin).data
        data["destination"] = AirportSerializer(instance.destination).data
        return data

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than 0.")
        return value

    def validate(self, attrs):
        def current(field):
            return attrs.get(field, getattr(self.instance, field, None))

        errors = {}
        if current("origin") == current("destination"):
            errors["destination"] = "Destination must differ from origin."
        if current("valid_until") > current("departure_date"):
            errors["valid_until"] = "Valid until must be on or before the departure date."
        if self.instance is None and attrs["valid_until"] < timezone.localdate():
            errors["valid_until"] = "Valid until cannot be in the past."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs
