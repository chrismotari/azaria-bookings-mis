import uuid

from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from airports.models import Airport


class OfferQuerySet(models.QuerySet):
    def bookable(self):
        today = timezone.localdate()
        return self.filter(is_active=True, valid_until__gte=today, departure_date__gte=today)

    def publicly_visible(self):
        return self.filter(is_active=True, is_public=True)

    def visible_to(self, user):
        """Public active offers, plus those sent to this customer in a query response."""
        if not user.is_authenticated:
            return self.publicly_visible()
        sent_to_user = self.filter(query_responses__query__user=user).values("pk")
        return self.filter(models.Q(is_active=True, is_public=True) | models.Q(pk__in=sent_to_user))


class Offer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class TicketClass(models.TextChoices):
        ECONOMY = "economy", "Economy"
        PREMIUM_ECONOMY = "premium_economy", "Premium economy"
        BUSINESS = "business", "Business"
        FIRST = "first", "First"

    origin = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    destination = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    departure_date = models.DateField()
    ticket_class = models.CharField(max_length=20, choices=TicketClass.choices)
    # Per person, in settings.CURRENCY.
    price = models.DecimalField(max_digits=10, decimal_places=2)
    airline = models.CharField(max_length=100)
    # Inclusive through that day in Nairobi time.
    valid_until = models.DateField()
    # False for offers created for one specific query response.
    is_public = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = OfferQuerySet.as_manager()

    class Meta:
        ordering = ["departure_date", "price"]

    def __str__(self):
        return f"{self.origin.code} → {self.destination.code} {self.departure_date} ({self.airline})"

    @property
    def is_bookable(self):
        today = timezone.localdate()
        return self.is_active and self.valid_until >= today and self.departure_date >= today

    def set_stops(self, stops):
        """Replace the stop list; stops: ordered dicts of airport and duration_minutes."""
        self.stops.all().delete()
        OfferStop.objects.bulk_create(
            OfferStop(offer=self, position=position, airport=stop["airport"], duration_minutes=stop["duration_minutes"])
            for position, stop in enumerate(stops, start=1)
        )


class Stop(models.Model):
    """A stop between origin and destination. Under 24 hours it is a layover, otherwise a stopover."""

    MAX_PER_FLIGHT = 4
    STOPOVER_MINUTES = 24 * 60

    # From 1, in flight order.
    position = models.PositiveSmallIntegerField()
    airport = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    duration_minutes = models.PositiveIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        abstract = True
        ordering = ["position"]

    def __str__(self):
        return f"{self.airport.code} ({self.kind}, {self.duration_minutes} min)"

    @property
    def kind(self):
        return "stopover" if self.duration_minutes >= self.STOPOVER_MINUTES else "layover"


class OfferStop(Stop):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name="stops")

    class Meta(Stop.Meta):
        constraints = [
            models.UniqueConstraint(fields=["offer", "position"], name="unique_offer_stop_position"),
            models.CheckConstraint(condition=models.Q(duration_minutes__gt=0), name="offer_stop_duration_positive"),
        ]
