from rest_framework import serializers

from accounts.serializers import UserSerializer
from catalog.models import Offer
from catalog.serializers import AdminOfferSerializer, AirportSerializer, OfferSerializer

from .models import Query, QueryResponse


class QueryResponseSerializer(serializers.ModelSerializer):
    offers = OfferSerializer(many=True, read_only=True)

    class Meta:
        model = QueryResponse
        fields = ["id", "message", "offers", "created_at"]
        read_only_fields = fields


class QuerySerializer(serializers.ModelSerializer):
    """Airports are written by id and read as nested objects."""

    price_min = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False, allow_null=True)
    price_max = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False, allow_null=True)

    class Meta:
        model = Query
        fields = [
            "id",
            "origin",
            "destination",
            "date_from",
            "date_to",
            "price_min",
            "price_max",
            "ticket_class",
            "max_stopovers",
            "message",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        for field in ("origin", "destination"):
            airport = getattr(instance, field)
            data[field] = AirportSerializer(airport).data if airport else None
        return data

    def validate(self, attrs):
        errors = {}
        if not attrs.get("origin") and not attrs.get("destination"):
            errors["destination"] = "Choose an origin, a destination or both."
        if attrs.get("date_to") and attrs["date_to"] < attrs["date_from"]:
            errors["date_to"] = "The end date must be on or after the start date."
        price_min, price_max = attrs.get("price_min"), attrs.get("price_max")
        if price_min is not None and price_max is not None and price_min > price_max:
            errors["price_max"] = "The maximum price must be at least the minimum price."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class QueryDetailSerializer(QuerySerializer):
    responses = QueryResponseSerializer(many=True, read_only=True)

    class Meta(QuerySerializer.Meta):
        fields = [*QuerySerializer.Meta.fields, "responses"]


class AdminQuerySerializer(QuerySerializer):
    user = UserSerializer(read_only=True)

    class Meta(QuerySerializer.Meta):
        fields = [*QuerySerializer.Meta.fields, "user"]
        read_only_fields = fields


class AdminQueryDetailSerializer(AdminQuerySerializer):
    responses = QueryResponseSerializer(many=True, read_only=True)

    class Meta(AdminQuerySerializer.Meta):
        fields = [*AdminQuerySerializer.Meta.fields, "responses"]
        read_only_fields = fields


class RespondSerializer(serializers.Serializer):
    message = serializers.CharField(allow_blank=True, default="")
    offer_ids = serializers.ListField(child=serializers.IntegerField(), default=list)
    new_offers = serializers.ListField(child=serializers.DictField(), default=list)

    def validate_offer_ids(self, ids):
        ids = list(dict.fromkeys(ids))
        offers = list(Offer.objects.bookable().filter(pk__in=ids))
        missing = sorted(set(ids) - {offer.pk for offer in offers})
        if missing:
            raise serializers.ValidationError(
                f"These offers do not exist or can no longer be booked: {', '.join(map(str, missing))}."
            )
        return offers

    def validate_new_offers(self, items):
        serializers_ = [AdminOfferSerializer(data={**item, "is_public": False}) for item in items]
        valid = [serializer.is_valid() for serializer in serializers_]
        if not all(valid):
            raise serializers.ValidationError([serializer.errors for serializer in serializers_])
        return [serializer.validated_data for serializer in serializers_]

    def validate(self, attrs):
        if not attrs["offer_ids"] and not attrs["new_offers"]:
            raise serializers.ValidationError("Include at least one offer.")
        return attrs
