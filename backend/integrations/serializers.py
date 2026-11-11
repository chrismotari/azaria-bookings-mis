from django.utils import timezone
from rest_framework import serializers

from airlines.models import Airline
from airlines.serializers import AirlineSerializer
from airports.models import Airport
from catalog.models import Trip
from catalog.serializers import AirportCodeField, AirportSerializer, itinerary_data

from . import services
from .models import Fare, Integration, Route, SearchRun
from .providers import PROVIDERS


class IntegrationSerializer(serializers.ModelSerializer):
    """credentials: the provider's credential fields, e.g. {"access_token": "…"}; written only, never returned."""

    credentials = serializers.DictField(child=serializers.CharField(trim_whitespace=True), write_only=True)

    class Meta:
        model = Integration
        fields = [
            "id",
            "provider",
            "name",
            "mode",
            "credentials",
            "is_active",
            "last_tested_at",
            "last_test_ok",
            "last_test_message",
            "created_at",
        ]
        read_only_fields = ["id", "last_tested_at", "last_test_ok", "last_test_message", "created_at"]

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter a name.")
        return value.strip()

    def validate_provider(self, value):
        if self.instance is not None and value != self.instance.provider:
            raise serializers.ValidationError("The provider of an integration cannot change.")
        return value

    def validate(self, attrs):
        provider = attrs.get("provider", getattr(self.instance, "provider", None))
        if "credentials" in attrs:
            fields = PROVIDERS[provider].credential_fields
            missing = [field for field in fields if not attrs["credentials"].get(field)]
            if missing:
                raise serializers.ValidationError({"credentials": f"Enter the {missing[0].replace('_', ' ')}."})
            attrs["credentials"] = {field: attrs["credentials"][field] for field in fields}
        elif self.instance is None:
            raise serializers.ValidationError({"credentials": "Enter the credentials."})
        return attrs

    def save_credentials(self, integration, credentials):
        integration.set_credentials(credentials)
        # A new token has not been tested yet.
        integration.last_tested_at = integration.last_test_ok = None
        integration.last_test_message = ""

    def create(self, validated_data):
        credentials = validated_data.pop("credentials")
        integration = Integration(**validated_data)
        self.save_credentials(integration, credentials)
        integration.save()
        return integration

    def update(self, instance, validated_data):
        credentials = validated_data.pop("credentials", None)
        if credentials is not None:
            self.save_credentials(instance, credentials)
        return super().update(instance, validated_data)


class RunSerializer(serializers.ModelSerializer):
    started_by = serializers.SerializerMethodField()

    class Meta:
        model = SearchRun
        fields = [
            "id",
            "route",
            "trigger",
            "date_from",
            "date_to",
            "status",
            "searches_made",
            "fares_found",
            "errors",
            "started_by",
            "created_at",
            "finished_at",
        ]
        read_only_fields = fields

    def get_started_by(self, run):
        return run.started_by.full_name if run.started_by else None


class IntegrationNameSerializer(serializers.ModelSerializer):
    class Meta:
        model = Integration
        fields = ["id", "name", "provider", "is_active"]
        read_only_fields = fields


class RouteSerializer(serializers.ModelSerializer):
    """Airports by IATA code, airlines and integrations by id; read back as nested objects."""

    origin = AirportCodeField(slug_field="code", queryset=Airport.objects.all())
    destination = AirportCodeField(slug_field="code", queryset=Airport.objects.all())
    airlines = serializers.PrimaryKeyRelatedField(queryset=Airline.objects.all(), many=True, required=False)
    integrations = serializers.PrimaryKeyRelatedField(queryset=Integration.objects.all(), many=True, required=False)
    weekdays = serializers.ListField(child=serializers.IntegerField(min_value=0, max_value=6), required=False)
    stay_nights = serializers.IntegerField(min_value=1, max_value=60, required=False, allow_null=True)
    max_connections = serializers.IntegerField(min_value=0, max_value=4, required=False, allow_null=True)
    max_per_date = serializers.IntegerField(min_value=1, max_value=5, required=False)
    markup_percent = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0, required=False)
    markup_fixed = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False)
    schedule_weekday = serializers.IntegerField(min_value=0, max_value=6, required=False, allow_null=True)
    days_ahead_from = serializers.IntegerField(min_value=0, max_value=32767, default=1, allow_null=True)
    days_ahead_to = serializers.IntegerField(min_value=0, max_value=32767, default=30, allow_null=True)
    last_run = serializers.SerializerMethodField()
    new_fares = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Route
        fields = [
            "id",
            "origin",
            "destination",
            "trip_type",
            "stay_nights",
            "ticket_class",
            "max_connections",
            "airlines",
            "integrations",
            "weekdays",
            "pick_cheapest",
            "pick_cheapest_direct",
            "max_per_date",
            "markup_percent",
            "markup_fixed",
            "schedule",
            "schedule_weekday",
            "window",
            "window_from",
            "window_to",
            "days_ahead_from",
            "days_ahead_to",
            "auto_publish",
            "is_active",
            "created_at",
            "last_run",
            "new_fares",
        ]
        read_only_fields = ["id", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["origin"] = AirportSerializer(instance.origin).data
        data["destination"] = AirportSerializer(instance.destination).data
        data["airlines"] = AirlineSerializer(instance.airlines.all(), many=True, context=self.context).data
        data["integrations"] = IntegrationNameSerializer(instance.integrations.all(), many=True).data
        return data

    def get_last_run(self, route):
        run = route.runs.order_by("-created_at").first()
        return RunSerializer(run).data if run else None

    def validate_weekdays(self, value):
        return sorted(set(value))

    def validate(self, attrs):
        def current(field, default=None):
            return attrs.get(field, getattr(self.instance, field, default))

        errors = {}
        if current("origin") == current("destination"):
            errors["destination"] = "From and To must differ."
        if current("trip_type", Trip.TripType.ONE_WAY) == Trip.TripType.RETURN:
            if current("stay_nights") is None:
                errors["stay_nights"] = "Enter the nights between departure and return (1 to 60)."
        else:
            attrs["stay_nights"] = None
        if not current("pick_cheapest", True) and not current("pick_cheapest_direct", False):
            errors["pick_cheapest"] = "Choose at least one pick rule."
        if current("schedule", Route.Schedule.MANUAL) == Route.Schedule.WEEKLY:
            if current("schedule_weekday") is None:
                errors["schedule_weekday"] = "Choose the day the weekly search runs."
        else:
            attrs["schedule_weekday"] = None
        errors.update(self.window_errors(attrs, current))
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def window_errors(self, attrs, current):
        """Checks the window and clears the other kind's fields."""
        limit = services.MAX_SEARCH_DAYS
        if current("window", Route.Window.ROLLING) == Route.Window.FIXED:
            attrs["days_ahead_from"] = attrs["days_ahead_to"] = None
            window_from, window_to = current("window_from"), current("window_to")
            if window_from is None:
                return {"window_from": "Choose the first departure date."}
            if window_to is None:
                return {"window_to": "Choose the last departure date."}
            if window_to < window_from:
                return {"window_to": "The last departure date must be on or after the first."}
            if (window_to - window_from).days + 1 > limit:
                return {"window_to": f"Search at most {limit} days at a time."}
            if "window_to" in attrs and window_to < timezone.localdate():
                return {"window_to": "The last departure date cannot be in the past."}
            return {}
        attrs["window_from"] = attrs["window_to"] = None
        days_from, days_to = current("days_ahead_from"), current("days_ahead_to")
        if days_from is None:
            return {"days_ahead_from": "Enter how many days ahead the window starts."}
        if days_to is None:
            return {"days_ahead_to": "Enter how many days ahead the window ends."}
        if days_to < days_from:
            return {"days_ahead_to": "The window must end on or after its start."}
        if days_to - days_from > limit:
            return {"days_ahead_to": f"The window can span at most {limit} days."}
        return {}


class FareSerializer(serializers.ModelSerializer):
    """A fare with its itinerary in the shape offers return. Needs context["segments"]: {fare id: segment dicts}."""

    integration = IntegrationNameSerializer(read_only=True)
    airline = AirlineSerializer(read_only=True)
    departure_date = serializers.SerializerMethodField()
    return_date = serializers.SerializerMethodField()

    class Meta:
        model = Fare
        fields = [
            "id",
            "route",
            "run",
            "integration",
            "trip_type",
            "ticket_class",
            "airline",
            "departure_date",
            "return_date",
            "net_amount",
            "net_currency",
            "net_usd",
            "rate",
            "rate_date",
            "no_rate",
            "selling_price",
            "checked_bags",
            "checked_bag_kg",
            "cabin_bag_kg",
            "refund_policy",
            "change_policy",
            "fare_type",
            "seats_left",
            "provider_ref",
            "fare_key",
            "expires_at",
            "picked",
            "status",
            "offer",
            "created_at",
        ]
        read_only_fields = fields

    def _segments(self, fare):
        return self.context["segments"][fare.pk]

    def get_departure_date(self, fare):
        return self._segments(fare)[0]["departure_date"]

    def get_return_date(self, fare):
        return next((s["departure_date"] for s in self._segments(fare) if s["direction"] == "return"), None)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        return {**data, **itinerary_data(services.segment_rows(self._segments(instance)), self.context)}


def fares_data(fares, context):
    fares = list(fares)
    return FareSerializer(fares, many=True, context={**context, "segments": services.resolve_itineraries(fares)}).data


class PublishSerializer(serializers.Serializer):
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    valid_until = serializers.DateField()
    is_public = serializers.BooleanField(default=True)

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than 0.")
        return value
