from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from catalog.models import Offering
from customer_requests.models import Query


class Booking(models.Model):
    """Status changes go through bookings.services only."""

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        AVAILABILITY_CONFIRMED = "availability_confirmed", "Availability confirmed"
        PAID = "paid", "Paid"
        COMPLETED = "completed", "Completed"
        UNAVAILABLE = "unavailable", "Unavailable"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"

    # A customer may hold only one booking in these statuses per offering.
    ACTIVE_STATUSES = [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.PAID]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookings")
    offering = models.ForeignKey(Offering, on_delete=models.PROTECT, related_name="bookings")
    query = models.ForeignKey(Query, on_delete=models.SET_NULL, null=True, blank=True, related_name="bookings")
    passenger_count = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(9)])
    notes = models.TextField(blank=True)
    # Per person, copied from the offering at creation.
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.REQUESTED)
    payment_deadline = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Booking {self.pk} ({self.status})"

    @property
    def total_price(self):
        return self.unit_price * self.passenger_count


class BookingEvent(models.Model):
    """One row per status change, including creation; the booking's timeline."""

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="events")
    # Blank on creation.
    from_status = models.CharField(max_length=30, choices=Booking.Status.choices, blank=True)
    to_status = models.CharField(max_length=30, choices=Booking.Status.choices)
    # Null when the system acted.
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def __str__(self):
        return f"{self.from_status or 'new'} → {self.to_status}"
