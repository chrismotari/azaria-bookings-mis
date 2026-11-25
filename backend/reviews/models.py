import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Avg, Count, OuterRef, Subquery
from django.db.models.functions import Round

MAX_TEXT = 2000


class Review(models.Model):
    """One per booking: a flight booking (rating the agency's service), a tour booking or a hotel booking."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Kind(models.TextChoices):
        FLIGHT = "flight", "Flight"
        TOUR = "tour", "Tour"
        HOTEL = "hotel", "Hotel"

    booking = models.OneToOneField(
        "bookings.Booking", on_delete=models.CASCADE, null=True, blank=True, related_name="review"
    )
    tour_booking = models.OneToOneField(
        "tours.TourBooking", on_delete=models.CASCADE, null=True, blank=True, related_name="review"
    )
    hotel_booking = models.OneToOneField(
        "hotels.HotelBooking", on_delete=models.CASCADE, null=True, blank=True, related_name="review"
    )
    kind = models.CharField(max_length=10, choices=Kind.choices)
    tour = models.ForeignKey("tours.Tour", on_delete=models.CASCADE, null=True, blank=True, related_name="reviews")
    hotel = models.ForeignKey("hotels.Hotel", on_delete=models.CASCADE, null=True, blank=True, related_name="reviews")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reviews")
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    comment = models.TextField(max_length=MAX_TEXT, blank=True)
    is_hidden = models.BooleanField(default=False)
    hidden_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    hidden_at = models.DateTimeField(null=True, blank=True)
    reply = models.TextField(max_length=MAX_TEXT, blank=True)
    replied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    replied_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "pk"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(booking__isnull=False, tour_booking__isnull=True, hotel_booking__isnull=True)
                | models.Q(booking__isnull=True, tour_booking__isnull=False, hotel_booking__isnull=True)
                | models.Q(booking__isnull=True, tour_booking__isnull=True, hotel_booking__isnull=False),
                name="review_has_one_booking",
            ),
        ]

    def __str__(self):
        return f"{self.rating}★ {self.get_kind_display()} review"

    @property
    def reviewer_name(self):
        """The first name and the last name's initial, e.g. "Wanjiru K."."""
        names = self.user.full_name.split()
        if not names:
            return ""
        return names[0] if len(names) == 1 else f"{names[0]} {names[-1][0].upper()}."


def rating(reviews):
    """{average (one decimal), count} over the reviews, hidden ones included; None when there are none."""
    figures = reviews.aggregate(average=Round(Avg("rating"), 1), count=Count("pk"))
    if not figures["count"]:
        return None
    return {"average": float(figures["average"]), "count": figures["count"]}


def with_rating(queryset, field):
    """Annotates rating_average and rating_count from the reviews whose field (tour or hotel) is the row."""
    reviews = Review.objects.filter(**{field: OuterRef("pk")}).order_by().values(field)
    return queryset.annotate(
        rating_average=Subquery(reviews.annotate(value=Round(Avg("rating"), 1)).values("value")),
        rating_count=Subquery(reviews.annotate(value=Count("pk")).values("value")),
    )


def annotated_rating(item):
    """The rating of a tour or hotel annotated by with_rating, as the API returns it."""
    if not getattr(item, "rating_count", None):
        return None
    return {"average": float(item.rating_average), "count": item.rating_count}
