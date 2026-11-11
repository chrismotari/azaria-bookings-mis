from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from airlines.serializers import AirlineSerializer
from airports.models import Airport

from .models import Offer, Stop


class AirportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Airport
        fields = ["id", "code", "name", "city", "country", "country_code"]


class StopSerializer(serializers.Serializer):
    """Read-only representation of an OfferStop or BookingStop."""

    airport = AirportSerializer(read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)
    kind = serializers.CharField(read_only=True)


class AirportCodeField(serializers.SlugRelatedField):
    """An airport by IATA code, in any case."""

    def to_internal_value(self, data):
        return super().to_internal_value(data.strip().upper() if isinstance(data, str) else data)


class StopInputSerializer(serializers.Serializer):
    airport = AirportCodeField(slug_field="code", queryset=Airport.objects.all())
    duration_minutes = serializers.IntegerField(min_value=1)


def stops_data(stops):
    """stops and stop_count for an API representation; stops: the instance's ordered stop list."""
    stops = list(stops)
    return {"stops": StopSerializer(stops, many=True).data, "stop_count": len(stops)}


def stop_errors(origin, destination, stops):
    """Messages for a stop list that breaks the rules; stops: ordered dicts with an airport."""
    if len(stops) > Stop.MAX_PER_FLIGHT:
        return [f"A flight can have at most {Stop.MAX_PER_FLIGHT} stops."]
    errors = []
    for number, stop in enumerate(stops, start=1):
        airport = stop["airport"]
        if airport == origin:
            errors.append(f"Stop {number}: the airport must differ from the origin.")
        elif airport == destination:
            errors.append(f"Stop {number}: the airport must differ from the destination.")
        elif number > 1 and airport == stops[number - 2]["airport"]:
            errors.append(f"Stop {number}: the airport must differ from the stop before it.")
    return errors


class OfferSerializer(serializers.ModelSerializer):
    """Read-only representation used by browse and detail."""

    origin = AirportSerializer(read_only=True)
    destination = AirportSerializer(read_only=True)
    airline = AirlineSerializer(read_only=True)
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
            "airline",
            "valid_until",
            "is_bookable",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        return {**super().to_representation(instance), **stops_data(instance.stops.all())}


class AdminOfferSerializer(serializers.ModelSerializer):
    """Airports and the airline are written by id and read as nested objects.

    Stops are written by IATA code, in flight order; an edit that includes stops replaces them all.
    """

    is_bookable = serializers.BooleanField(read_only=True)
    stops = StopInputSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = Offer
        fields = [
            "id",
            "origin",
            "destination",
            "departure_date",
            "ticket_class",
            "price",
            "airline",
            "valid_until",
            "is_public",
            "is_active",
            "is_bookable",
            "created_at",
            "stops",
        ]
        read_only_fields = ["id", "is_bookable", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["origin"] = AirportSerializer(instance.origin).data
        data["destination"] = AirportSerializer(instance.destination).data
        data["airline"] = AirlineSerializer(instance.airline, context=self.context).data
        return {**data, **stops_data(instance.stops.all())}

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than 0.")
        return value

    def validate_airline(self, airline):
        # Existing offers keep an airline deactivated later; choosing one needs it active.
        unchanged = self.instance is not None and self.instance.airline_id == airline.pk
        if not airline.is_active and not unchanged:
            raise serializers.ValidationError("This airline is no longer active.")
        return airline

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
        if "stops" in attrs:
            stops = attrs["stops"]
        elif self.instance is not None:
            stops = [{"airport": stop.airport} for stop in self.instance.stops.select_related("airport")]
        else:
            stops = []
        if messages := stop_errors(current("origin"), current("destination"), stops):
            errors["stops"] = messages
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        stops = validated_data.pop("stops", [])
        offer = super().create(validated_data)
        offer.set_stops(stops)
        return offer

    @transaction.atomic
    def update(self, instance, validated_data):
        stops = validated_data.pop("stops", None)
        offer = super().update(instance, validated_data)
        if stops is not None:
            offer.set_stops(stops)
        return offer
