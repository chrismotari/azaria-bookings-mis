from rest_framework import serializers

from .models import MAX_TEXT, Review
from .services import can_review, has_review


def route_line(booking):
    arrow = "⇄" if booking.trip_type == "return" else "→"
    return f"{booking.offer.origin.code} {arrow} {booking.offer.destination.code}"


def booking_data(review):
    """{kind, id, title}: the tour or hotel name, or the flight's route line."""
    if review.kind == Review.Kind.FLIGHT:
        booking = review.booking
        return {"kind": review.kind, "id": str(booking.pk), "title": route_line(booking)}
    if review.kind == Review.Kind.TOUR:
        return {"kind": review.kind, "id": str(review.tour_booking_id), "title": review.tour.title}
    return {"kind": review.kind, "id": str(review.hotel_booking_id), "title": review.hotel.name}


REVIEW_RELATED = ["user", "tour", "hotel", "booking__offer__origin", "booking__offer__destination"]


class PublicReviewSerializer(serializers.ModelSerializer):
    reviewer_name = serializers.CharField(read_only=True)

    class Meta:
        model = Review
        fields = ["id", "rating", "comment", "reviewer_name", "created_at", "reply", "replied_at"]
        read_only_fields = fields


class OwnReviewSerializer(serializers.ModelSerializer):
    """The author's view: also kind, is_hidden and the booking."""

    reviewer_name = serializers.CharField(read_only=True)
    booking = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id",
            "kind",
            "rating",
            "comment",
            "reviewer_name",
            "is_hidden",
            "reply",
            "replied_at",
            "booking",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_booking(self, review):
        return booking_data(review)


class AdminReviewSerializer(OwnReviewSerializer):
    customer = serializers.SerializerMethodField()
    item = serializers.SerializerMethodField()
    hidden_by = serializers.CharField(source="hidden_by.full_name", read_only=True, default=None)
    replied_by = serializers.CharField(source="replied_by.full_name", read_only=True, default=None)

    class Meta(OwnReviewSerializer.Meta):
        fields = [*OwnReviewSerializer.Meta.fields, "customer", "item", "hidden_by", "hidden_at", "replied_by"]
        read_only_fields = fields

    def get_customer(self, review):
        user = review.user
        return {"id": str(user.pk), "full_name": user.full_name, "email": user.email}

    def get_item(self, review):
        """The tour or hotel reviewed; null for flights."""
        if review.tour_id:
            return {"id": str(review.tour_id), "title": review.tour.title}
        if review.hotel_id:
            return {"id": str(review.hotel_id), "title": review.hotel.name}
        return None


class ReviewCreateSerializer(serializers.Serializer):
    booking = serializers.UUIDField(required=False)
    tour_booking = serializers.UUIDField(required=False)
    hotel_booking = serializers.UUIDField(required=False)
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(max_length=MAX_TEXT, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        given = [field for field in ("booking", "tour_booking", "hotel_booking") if attrs.get(field)]
        if len(given) != 1:
            raise serializers.ValidationError("Choose exactly one booking.")
        attrs["kind"] = {"booking": "flight", "tour_booking": "tour", "hotel_booking": "hotel"}[given[0]]
        attrs["booking_id"] = attrs[given[0]]
        attrs["comment"] = attrs["comment"].strip()
        return attrs


class ReviewChangeSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5, required=False)
    comment = serializers.CharField(max_length=MAX_TEXT, required=False, allow_blank=True)

    def validate_comment(self, value):
        return value.strip()


class ReplySerializer(serializers.Serializer):
    reply = serializers.CharField(max_length=MAX_TEXT, allow_blank=True)


class ReviewFields(serializers.Serializer):
    """can_review and review on a customer's booking; review_kind names its kind."""

    review_kind = None
    can_review = serializers.SerializerMethodField()
    review = serializers.SerializerMethodField()

    def get_can_review(self, booking):
        return can_review(self.review_kind, booking)

    def get_review(self, booking):
        return OwnReviewSerializer(booking.review).data if has_review(booking) else None
