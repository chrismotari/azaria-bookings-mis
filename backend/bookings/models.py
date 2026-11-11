import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import connection, models

from catalog.models import Offer, Segment, Trip
from core import files
from core.storage import private_storage
from customer_requests.models import Query


class Booking(Trip):
    """Status changes go through bookings.services only.

    Its trip type, return date, baggage, fare conditions and segments are copied from the offer at creation, so
    later offer edits leave it unchanged.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        AVAILABILITY_CONFIRMED = "availability_confirmed", "Availability confirmed"
        PAID = "paid", "Paid"
        COMPLETED = "completed", "Completed"
        UNAVAILABLE = "unavailable", "Unavailable"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"
        # The customer declined the changes made when availability was confirmed.
        DECLINED = "declined", "Declined"

    # A customer may hold only one booking in these statuses per offer.
    ACTIVE_STATUSES = [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.PAID]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookings")
    offer = models.ForeignKey(Offer, on_delete=models.PROTECT, related_name="bookings")
    query = models.ForeignKey(Query, on_delete=models.SET_NULL, null=True, blank=True, related_name="bookings")
    passenger_count = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(9)])
    notes = models.TextField(blank=True)
    # Per person, copied from the offer at creation.
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    # Copied from the offer at creation, so the fare can be searched again; integration and fare_key are null for
    # manual offers.
    source = models.CharField(max_length=10, choices=Offer.Source.choices, default=Offer.Source.MANUAL)
    integration = models.ForeignKey(
        "integrations.Integration", on_delete=models.PROTECT, null=True, blank=True, related_name="bookings"
    )
    fare_key = models.CharField(max_length=500, null=True, blank=True)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.REQUESTED)
    payment_deadline = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    # What the admin changed when confirming availability: {"unit_price": {"old", "new"}, "segments": {"old", "new"}}
    # with only the changed keys; null when nothing changed.
    changes = models.JSONField(null=True, blank=True)
    changes_accepted = models.BooleanField(default=False)
    # The request created with suggested options when the booking was marked unavailable.
    alternatives = models.ForeignKey(Query, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Booking {self.pk} ({self.status})"

    @property
    def changes_awaiting_acceptance(self):
        return bool(self.changes) and not self.changes_accepted

    @property
    def total_price(self):
        return self.unit_price * self.passenger_count


class BookingSegment(Segment):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="segments")

    class Meta(Segment.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["booking", "direction", "position"], name="unique_booking_segment_position"
            ),
        ]


class BookingEvent(models.Model):
    """One row per status change, including creation; the booking's timeline."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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


def boarding_pass_path(instance, filename):
    # Per tenant; the private storage replaces the file name with a random UUID.
    return f"boarding_passes/{connection.schema_name}/{instance.booking_id}/{filename}"


class BoardingPass(models.Model):
    """Uploaded and deleted only while the booking is paid; served only by the authenticated download view."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    MAX_PER_BOOKING = 10
    # The upload rules shared with chat attachments (core.files).
    MAX_SIZE = files.MAX_SIZE
    CONTENT_TYPES = files.CONTENT_TYPES

    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="boarding_passes")
    file = models.FileField(storage=private_storage, upload_to=boarding_pass_path, max_length=255)
    original_name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at", "pk"]

    def __str__(self):
        return self.original_name
