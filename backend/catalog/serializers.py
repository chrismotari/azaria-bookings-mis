from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from airlines.models import Airline
from airlines.serializers import AirlineSerializer
from airports.models import Airport

from .itinerary import airlines_in, by_direction, connections, derived_fields, itinerary_errors
from .models import Offer, Segment, Trip


class AirportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Airport
        fields = ["id", "code", "name", "city", "country", "country_code"]


class AirportCodeField(serializers.SlugRelatedField):
    """An airport by IATA code, in any case."""

    def to_internal_value(self, data):
        return super().to_internal_value(data.strip().upper() if isinstance(data, str) else data)


class SegmentSerializer(serializers.Serializer):
    """Read-only representation of an OfferSegment or BookingSegment."""

    airline = AirlineSerializer(read_only=True)
    flight_number = serializers.CharField(read_only=True)
    operating_airline = AirlineSerializer(read_only=True)
    origin = AirportSerializer(read_only=True)
    destination = AirportSerializer(read_only=True)
    departure_date = serializers.DateField(read_only=True)
    departure_time = serializers.TimeField(format="%H:%M", read_only=True)
    arrival_date = serializers.DateField(read_only=True)
    arrival_time = serializers.TimeField(format="%H:%M", read_only=True)


class SegmentInputSerializer(serializers.Serializer):
    direction = serializers.ChoiceField(choices=Segment.Direction.choices)
    airline = serializers.PrimaryKeyRelatedField(queryset=Airline.objects.all())
    flight_number = serializers.RegexField(
        r"^\d{1,4}[A-Za-z]?$", error_messages={"invalid": "1 to 4 digits and an optional letter, e.g. 100 or 2A."}
    )
    operating_airline = serializers.PrimaryKeyRelatedField(
        queryset=Airline.objects.all(), required=False, allow_null=True, default=None
    )
    origin = AirportCodeField(slug_field="code", queryset=Airport.objects.all())
    destination = AirportCodeField(slug_field="code", queryset=Airport.objects.all())
    departure_date = serializers.DateField()
    departure_time = serializers.TimeField()
    arrival_date = serializers.DateField()
    arrival_time = serializers.TimeField()

    def validate_flight_number(self, value):
        return value.upper()

    def validate(self, attrs):
        # The marketing carrier operating its own flight is not a codeshare.
        if attrs["operating_airline"] == attrs["airline"]:
            attrs["operating_airline"] = None
        return attrs


def itinerary_data(segments, context=None):
    """{"itinerary": {outbound, return}} for an offer or booking; segments: the instance's ordered segment rows.

    Each direction holds its segments, connections and stop_count; return is null without return flights.
    """
    segments = list(segments)
    flights = by_direction([s.as_data() for s in segments])
    data = {}
    for direction in Segment.Direction.values:
        rows = [s for s in segments if s.direction == direction]
        if direction == Segment.Direction.RETURN and not rows:
            data[direction] = None
            continue
        data[direction] = {
            "segments": SegmentSerializer(rows, many=True, context=context).data,
            "connections": [
                {**connection, "airport": AirportSerializer(connection["airport"]).data}
                for connection in connections(flights[direction])
            ],
            "stop_count": max(len(rows) - 1, 0),
        }
    return {"itinerary": data}


def baggage_errors(attrs, instance=None):
    """A checked bag weight needs at least one checked bag."""

    def current(field):
        return attrs.get(field, getattr(instance, field, None))

    if not current("checked_bags") and current("checked_bag_kg") is not None:
        return {"checked_bag_kg": "Leave the weight empty when no checked bag is included."}
    return {}


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
            *Trip.FIELDS,
            "ticket_class",
            "price",
            "airline",
            "valid_until",
            "is_bookable",
            # Never the net amount, rate or fare type.
            "source",
            "price_checked_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        return {**super().to_representation(instance), **itinerary_data(instance.segments.all(), self.context)}


class AdminOfferSerializer(serializers.ModelSerializer):
    """The ticketing airline is written by id and read as a nested object.

    segments: one ordered list for both directions; an edit that includes them replaces them all. origin,
    destination, departure_date and return_date are derived from them.
    """

    is_bookable = serializers.BooleanField(read_only=True)
    segments = SegmentInputSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = Offer
        fields = [
            "id",
            "origin",
            "destination",
            "departure_date",
            *Trip.FIELDS,
            "ticket_class",
            "price",
            "airline",
            "valid_until",
            "is_public",
            "is_active",
            "is_bookable",
            "created_at",
            "segments",
            "source",
            *Offer.GDS_FIELDS,
            "missing_since",
        ]
        read_only_fields = [
            "id",
            "origin",
            "destination",
            "departure_date",
            "return_date",
            "is_bookable",
            "created_at",
            "source",
            *Offer.GDS_FIELDS,
            "missing_since",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["origin"] = AirportSerializer(instance.origin).data
        data["destination"] = AirportSerializer(instance.destination).data
        data["airline"] = AirlineSerializer(instance.airline, context=self.context).data
        data["integration"] = (
            {"id": str(instance.integration.pk), "name": instance.integration.name} if instance.integration else None
        )
        return {**data, **itinerary_data(instance.segments.all(), self.context)}

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

        existing = [s.as_data() for s in self.instance.segments.all()] if self.instance is not None else []
        segments = attrs.get("segments", existing)
        trip_type = current("trip_type") or Trip.TripType.ONE_WAY

        errors = baggage_errors(attrs, self.instance)
        # Inactive airlines the offer already flies may stay.
        if messages := itinerary_errors(trip_type, segments, airlines_in(existing)):
            errors["segments"] = messages
            raise serializers.ValidationError(errors)
        attrs.update(derived_fields(segments))
        if current("valid_until") > attrs["departure_date"]:
            errors["valid_until"] = "Valid until must be on or before the departure date."
        if self.instance is None and attrs["valid_until"] < timezone.localdate():
            errors["valid_until"] = "Valid until cannot be in the past."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        segments = validated_data.pop("segments")
        offer = super().create(validated_data)
        offer.set_segments(segments)
        return offer

    @transaction.atomic
    def update(self, instance, validated_data):
        segments = validated_data.pop("segments", None)
        if instance.source == Offer.Source.GDS and validated_data.get("price", instance.price) != instance.price:
            # Refreshes in review mode then leave the admin's price alone.
            validated_data["price_edited"] = True
        offer = super().update(instance, validated_data)
        if segments is not None:
            offer.set_segments(segments)
        return offer
