import json
import uuid

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from airlines.models import Airline
from airports.models import Airport
from catalog.models import Offer, Trip


def fernet():
    return Fernet(settings.INTEGRATIONS_KEY)


class Integration(models.Model):
    """A connection to a fare provider. Disabled (is_active false), never deleted."""

    class Provider(models.TextChoices):
        DUFFEL = "duffel", "Duffel"

    class Mode(models.TextChoices):
        TEST = "test", "Test"
        LIVE = "live", "Live"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=20, choices=Provider.choices)
    name = models.CharField(max_length=100)
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.TEST)
    # The provider's credential fields as JSON, encrypted with INTEGRATIONS_KEY; never sent to clients.
    credentials = models.TextField()
    is_active = models.BooleanField(default=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_ok = models.BooleanField(null=True, blank=True)
    last_test_message = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def set_credentials(self, values):
        self.credentials = fernet().encrypt(json.dumps(values).encode()).decode()

    def get_credentials(self):
        return json.loads(fernet().decrypt(self.credentials.encode()))


class Route(models.Model):
    """A route the agency searches for fares, with how to pick among them and the markup to sell them at."""

    class Schedule(models.TextChoices):
        MANUAL = "manual", "Manual"
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"

    class Window(models.TextChoices):
        FIXED = "fixed", "Fixed dates"
        ROLLING = "rolling", "Days ahead"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    origin = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    destination = models.ForeignKey(Airport, on_delete=models.PROTECT, related_name="+")
    trip_type = models.CharField(max_length=10, choices=Trip.TripType.choices, default=Trip.TripType.ONE_WAY)
    # Return trips only: the return flight leaves this many nights after the departure.
    stay_nights = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(60)]
    )
    ticket_class = models.CharField(max_length=20, choices=Offer.TicketClass.choices, default=Offer.TicketClass.ECONOMY)
    # Per direction; null for any.
    max_connections = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(4)])
    # Ticketing airlines to keep; none for any.
    airlines = models.ManyToManyField(Airline, blank=True, related_name="+")
    # None for every active integration.
    integrations = models.ManyToManyField(Integration, blank=True, related_name="routes")
    # Departure weekdays to search, 0 = Monday; empty for every day.
    weekdays = models.JSONField(default=list, blank=True)
    schedule = models.CharField(max_length=10, choices=Schedule.choices, default=Schedule.MANUAL)
    # Weekly schedules only: the day the search runs, 0 = Monday.
    schedule_weekday = models.PositiveSmallIntegerField(null=True, blank=True, validators=[MaxValueValidator(6)])
    # The departure dates a run searches: from window_from to window_to (fixed), or from days_ahead_from to
    # days_ahead_to days after the day it runs (rolling); the other pair is null.
    window = models.CharField(max_length=10, choices=Window.choices, default=Window.ROLLING)
    window_from = models.DateField(null=True, blank=True)
    window_to = models.DateField(null=True, blank=True)
    days_ahead_from = models.PositiveSmallIntegerField(null=True, blank=True, default=1)
    days_ahead_to = models.PositiveSmallIntegerField(null=True, blank=True, default=30)
    # Publish picked fares at once, and let every run reprice or deactivate the route's offers.
    auto_publish = models.BooleanField(default=False)
    # Per departure date: the cheapest fares and/or the cheapest direct one, at most max_per_date of them.
    pick_cheapest = models.BooleanField(default=True)
    pick_cheapest_direct = models.BooleanField(default=False)
    max_per_date = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(5)])
    # Selling price = net in USD × (1 + percent / 100) + fixed, rounded to the cent.
    markup_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    markup_fixed = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(0)])
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["origin__code", "destination__code", "created_at"]

    def __str__(self):
        arrow = "⇄" if self.trip_type == Trip.TripType.RETURN else "→"
        return f"{self.origin.code} {arrow} {self.destination.code}"


class SearchRun(models.Model):
    """One search of a route over a range of departure dates: a search per date per integration."""

    class Trigger(models.TextChoices):
        MANUAL = "manual", "Manual"
        SCHEDULED = "scheduled", "Scheduled"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        # A scheduled run that could not start; the reason is in errors.
        SKIPPED = "skipped", "Skipped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="runs")
    trigger = models.CharField(max_length=10, choices=Trigger.choices, default=Trigger.MANUAL)
    date_from = models.DateField()
    date_to = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    # The planned count while queued, so it already counts against the allowance; then the searches made.
    searches_made = models.PositiveIntegerField(default=0)
    fares_found = models.PositiveIntegerField(default=0)
    # Short messages: provider errors and skipped results.
    errors = models.JSONField(default=list, blank=True)
    started_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.route} {self.date_from} – {self.date_to} ({self.status})"


class Fare(models.Model):
    """A valid result of a run, kept 30 days for comparison (published ones longer)."""

    class FareType(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Private"
        UNKNOWN = "unknown", "Unknown"

    class Status(models.TextChoices):
        NEW = "new", "New"
        PUBLISHED = "published", "Published"
        DISMISSED = "dismissed", "Dismissed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(SearchRun, on_delete=models.CASCADE, related_name="fares")
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="fares")
    integration = models.ForeignKey(Integration, on_delete=models.PROTECT, related_name="fares")
    # Segments in the shape offers take them (airline ids, airport codes, ISO dates, "HH:MM"), in flight order.
    itinerary = models.JSONField()
    trip_type = models.CharField(max_length=10, choices=Trip.TripType.choices)
    ticket_class = models.CharField(max_length=20, choices=Offer.TicketClass.choices)
    # The ticketing airline.
    airline = models.ForeignKey(Airline, on_delete=models.PROTECT, related_name="+")
    # As the provider priced it, for one adult.
    net_amount = models.DecimalField(max_digits=14, decimal_places=3)
    net_currency = models.CharField(max_length=3)
    # Converted at the run's date; all null, with no_rate set, when the currency had no rate.
    net_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    rate = models.DecimalField(max_digits=20, decimal_places=8, null=True, blank=True)
    rate_date = models.DateField(null=True, blank=True)
    no_rate = models.BooleanField(default=False)
    # USD: net_usd plus the route's markup.
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    checked_bags = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(Trip.MAX_CHECKED_BAGS)])
    checked_bag_kg = models.PositiveSmallIntegerField(null=True, blank=True)
    cabin_bag_kg = models.PositiveSmallIntegerField(null=True, blank=True)
    refund_policy = models.CharField(max_length=20, choices=Trip.Policy.choices)
    change_policy = models.CharField(max_length=20, choices=Trip.Policy.choices)
    fare_type = models.CharField(max_length=10, choices=FareType.choices, default=FareType.UNKNOWN)
    seats_left = models.PositiveSmallIntegerField(null=True, blank=True)
    provider_ref = models.CharField(max_length=200)
    # The same flights in the same cabin, whichever provider or run found them.
    fare_key = models.CharField(max_length=500)
    expires_at = models.DateTimeField(null=True, blank=True)
    # Chosen by the route's pick rule.
    picked = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.NEW)
    offer = models.ForeignKey(Offer, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["route", "fare_key"])]

    def __str__(self):
        return f"{self.fare_key} {self.net_amount} {self.net_currency}"

    @property
    def departure_date(self):
        return self.itinerary[0]["departure_date"]
