import uuid

from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

from airlines.models import Airline
from airports.models import Airport


class OfferQuerySet(models.QuerySet):
    def bookable(self):
        today = timezone.localdate()
        return self.filter(is_active=True, valid_until__gte=today, departure_date__gte=today)

    def publicly_visible(self):
        return self.filter(is_active=True, is_public=True)

    def visible_to(self, user):
        """Public active offers, plus those sent to this customer in a query response or booked by them."""
        if not user.is_authenticated:
            return self.publicly_visible()
        sent_to_user = self.filter(query_responses__query__user=user).values("pk")
        booked_by_user = self.filter(bookings__user=user).values("pk")
        return self.filter(
            models.Q(is_active=True, is_public=True) | models.Q(pk__in=sent_to_user) | models.Q(pk__in=booked_by_user)
        )


class Trip(models.Model):
    """Trip type, return date, baggage per passenger and fare conditions: an offer's, and a booking's copy of them."""

    class TripType(models.TextChoices):
        ONE_WAY = "one_way", "One way"
        RETURN = "return", "Return"

    class Policy(models.TextChoices):
        NOT_ALLOWED = "not_allowed", "Not allowed"
        WITH_FEE = "with_fee", "With a fee"
        FREE = "free", "Free"

    MAX_CHECKED_BAGS = 3
    FIELDS = [
        "trip_type",
        "return_date",
        "checked_bags",
        "checked_bag_kg",
        "cabin_bag_kg",
        "refund_policy",
        "change_policy",
    ]

    trip_type = models.CharField(max_length=10, choices=TripType.choices, default=TripType.ONE_WAY)
    # The first return flight's departure date; null for one-way trips.
    return_date = models.DateField(null=True, blank=True)
    checked_bags = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(MAX_CHECKED_BAGS)])
    # Null when the weight is not stated.
    checked_bag_kg = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    cabin_bag_kg = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    refund_policy = models.CharField(max_length=20, choices=Policy.choices, default=Policy.NOT_ALLOWED)
    change_policy = models.CharField(max_length=20, choices=Policy.choices, default=Policy.NOT_ALLOWED)

    class Meta:
        abstract = True


class Offer(Trip):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Source(models.TextChoices):
        MANUAL = "manual", "Entered by hand"
        GDS = "gds", "Published from a fare search"

    # Copied from integrations.Fare when published; null for manual offers.
    GDS_FIELDS = [
        "integration",
        "route",
        "provider_ref",
        "fare_key",
        "net_amount",
        "net_currency",
        "net_usd",
        "rate",
        "rate_date",
        "fare_type",
        "price_checked_at",
    ]

    class TicketClass(models.TextChoices):
        ECONOMY = "economy", "Economy"
        PREMIUM_ECONOMY = "premium_economy", "Premium economy"
        BUSINESS = "business", "Business"
        FIRST = "first", "First"

    # origin, destination, departure_date and return_date are derived from the segments when they are written.
    origin = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    destination = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    departure_date = models.DateField()
    ticket_class = models.CharField(max_length=20, choices=TicketClass.choices)
    # Per person, in settings.CURRENCY; for a return trip, the round trip.
    price = models.DecimalField(max_digits=10, decimal_places=2)
    # The ticketing airline; each segment names its own carrier.
    airline = models.ForeignKey(Airline, on_delete=models.PROTECT, related_name="offers")
    # Inclusive through that day in Nairobi time.
    valid_until = models.DateField()
    # False for offers created for one specific query response.
    is_public = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MANUAL)
    integration = models.ForeignKey(
        "integrations.Integration", on_delete=models.PROTECT, null=True, blank=True, related_name="offers"
    )
    route = models.ForeignKey("integrations.Route", on_delete=models.PROTECT, null=True, blank=True, related_name="offers")
    provider_ref = models.CharField(max_length=200, null=True, blank=True)
    fare_key = models.CharField(max_length=500, null=True, blank=True)
    # The provider's amount for one adult in its own currency, and its USD conversion when published.
    net_amount = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    net_currency = models.CharField(max_length=3, null=True, blank=True)
    net_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    rate = models.DecimalField(max_digits=20, decimal_places=8, null=True, blank=True)
    rate_date = models.DateField(null=True, blank=True)
    fare_type = models.CharField(max_length=10, null=True, blank=True)
    # When the provider last priced it.
    price_checked_at = models.DateTimeField(null=True, blank=True)

    objects = OfferQuerySet.as_manager()

    class Meta:
        ordering = ["departure_date", "price"]

    def __str__(self):
        arrow = "⇄" if self.trip_type == self.TripType.RETURN else "→"
        return f"{self.origin.code} {arrow} {self.destination.code} {self.departure_date} ({self.airline})"

    @property
    def is_bookable(self):
        today = timezone.localdate()
        return self.is_active and self.valid_until >= today and self.departure_date >= today

    def set_segments(self, segments):
        """Replace the segments; segments: validated dicts in flight order (see Segment.FIELDS)."""
        self.segments.all().delete()
        OfferSegment.objects.bulk_create(OfferSegment.build(segments, offer=self))


class Segment(models.Model):
    """One flight of an itinerary. Times are the local times of the airport concerned, with no time zone."""

    class Direction(models.TextChoices):
        OUTBOUND = "outbound", "Outbound"
        RETURN = "return", "Return"

    # At most 4 connections per direction.
    MAX_PER_DIRECTION = 5
    STOPOVER_MINUTES = 24 * 60
    FIELDS = [
        "direction",
        "airline",
        "flight_number",
        "operating_airline",
        "origin",
        "destination",
        "departure_date",
        "departure_time",
        "arrival_date",
        "arrival_time",
    ]

    direction = models.CharField(max_length=10, choices=Direction.choices)
    # From 1 within the direction, in flight order.
    position = models.PositiveSmallIntegerField()
    # The marketing carrier.
    airline = models.ForeignKey(Airline, on_delete=models.PROTECT, related_name="+")
    flight_number = models.CharField(
        max_length=5, validators=[RegexValidator(r"^\d{1,4}[A-Z]?$", "1 to 4 digits and an optional letter.")]
    )
    # Set only for a codeshare.
    operating_airline = models.ForeignKey(Airline, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    origin = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    destination = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    departure_date = models.DateField()
    departure_time = models.TimeField()
    arrival_date = models.DateField()
    arrival_time = models.TimeField()

    class Meta:
        abstract = True
        ordering = ["direction", "position"]

    def __str__(self):
        return f"{self.flight} {self.origin.code} → {self.destination.code} {self.departure_date}"

    @property
    def flight(self):
        return f"{self.airline.iata_code} {self.flight_number}"

    def as_data(self):
        """The segment as a dict of Segment.FIELDS, the shape the API takes."""
        return {field: getattr(self, field) for field in self.FIELDS}

    @classmethod
    def build(cls, segments, **owner):
        """Unsaved rows for segments (dicts of FIELDS in flight order), numbered from 1 within each direction."""
        positions = dict.fromkeys(cls.Direction.values, 0)
        rows = []
        for data in segments:
            positions[data["direction"]] += 1
            rows.append(cls(**owner, position=positions[data["direction"]], **{f: data[f] for f in cls.FIELDS}))
        return rows


class OfferSegment(Segment):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    offer = models.ForeignKey(Offer, on_delete=models.CASCADE, related_name="segments")

    class Meta(Segment.Meta):
        constraints = [
            models.UniqueConstraint(fields=["offer", "direction", "position"], name="unique_offer_segment_position"),
        ]
