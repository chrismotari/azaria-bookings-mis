from rest_framework import serializers

from . import USD
from .models import ExchangeRate


class ExchangeRateSerializer(serializers.ModelSerializer):
    stale = serializers.BooleanField(read_only=True)

    class Meta:
        model = ExchangeRate
        fields = ["id", "currency", "units_per_usd", "date", "source", "fetched_at", "stale"]
        read_only_fields = fields


class ManualRateSerializer(serializers.Serializer):
    """A rate the owner enters for today."""

    currency = serializers.RegexField(
        r"^[A-Za-z]{3}$", error_messages={"invalid": "Enter a 3-letter ISO currency code."}
    )
    units_per_usd = serializers.DecimalField(max_digits=20, decimal_places=8)

    def validate_currency(self, value):
        value = value.upper()
        if value == USD:
            raise serializers.ValidationError("USD is always 1.")
        return value

    def validate_units_per_usd(self, value):
        if value <= 0:
            raise serializers.ValidationError("Enter a rate greater than 0.")
        return value
