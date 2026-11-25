import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import connection, models, transaction

from core import files
from core.storage import private_storage, public_storage

MAX_PHOTOS = 12
MAX_AMENITIES = 30
MAX_INCLUSIONS = 10
MAX_ROOMS = 9
MAX_NIGHTS = 30


class Hotel(models.Model):
    """Never deleted."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    destination = models.CharField(max_length=120)
    address = models.CharField(max_length=200)
    # Null: not rated.
    star_rating = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    summary = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    amenities = models.JSONField(default=list, blank=True)
    check_in_time = models.TimeField()
    check_out_time = models.TimeField()
    cancellation_policy = models.TextField(max_length=2000)
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


def hotel_photo_path(instance, filename):
    # The public storage replaces the file name with a random UUID.
    return f"hotels/{connection.schema_name}/{instance.hotel_id}/{filename}"


class HotelPhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="photos")
    image = models.FileField(storage=public_storage, upload_to=hotel_photo_path, max_length=255)
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self):
        return self.image.name

    def delete(self, *args, **kwargs):
        name = self.image.name
        result = super().delete(*args, **kwargs)
        transaction.on_commit(lambda: public_storage.delete(name))
        return result


class RoomType(models.Model):
    """Once booked, only deactivated."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="room_types")
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=300, blank=True)
    max_adults = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(10)])
    max_children = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(6)])
    position = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["position", "pk"]
        constraints = [models.UniqueConstraint(fields=["hotel", "name"], name="unique_hotel_room_type_name")]

    def __str__(self):
        return self.name


class RoomRate(models.Model):
    """One row of the hotel's room table. Once booked, only deactivated."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="rates")
    name = models.CharField(max_length=60)
    inclusions = models.JSONField(default=list, blank=True)
    max_adults = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(10)])
    max_children = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(6)])
    # The same in every season, e.g. breakfast.
    per_adult_per_night = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    position = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["position", "pk"]
        constraints = [models.UniqueConstraint(fields=["room_type", "name"], name="unique_room_rate_name")]

    def __str__(self):
        return self.name


class RatePeriod(models.Model):
    """A season of a rate; a rate's periods never overlap."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rate = models.ForeignKey(RoomRate, on_delete=models.CASCADE, related_name="periods")
    start_date = models.DateField()
    end_date = models.DateField()
    # The room's price, before the per-adult charge.
    price_per_night = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        ordering = ["start_date", "pk"]

    def __str__(self):
        return f"{self.start_date} – {self.end_date}"


class HotelBooking(models.Model):
    """Status changes go through hotels.services only."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        AVAILABILITY_CONFIRMED = "availability_confirmed", "Availability confirmed"
        PAID = "paid", "Paid"
        COMPLETED = "completed", "Completed"
        UNAVAILABLE = "unavailable", "Unavailable"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"
        DECLINED = "declined", "Declined"

    OPEN_STATUSES = [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.PAID]

    hotel = models.ForeignKey(Hotel, on_delete=models.PROTECT, related_name="bookings")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hotel_bookings")
    # The admin who booked for the customer; null when the customer booked.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    check_in = models.DateField()
    check_out = models.DateField()
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.REQUESTED)
    # The rooms' sum, copied at booking; the new total once changes are accepted.
    total = models.DecimalField(max_digits=12, decimal_places=2)
    # {"total": {"old", "new"}, "note"} when the admin confirmed at another total; null otherwise.
    changes = models.JSONField(null=True, blank=True)
    changes_accepted = models.BooleanField(default=False)
    payment_deadline = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    review_requested_at = models.DateTimeField(null=True, blank=True)
    unavailable_message = models.TextField(max_length=2000, blank=True)
    hotel_confirmation = models.CharField(max_length=40, blank=True)
    special_requests = models.TextField(max_length=1000, blank=True)
    notes = models.TextField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Hotel booking {self.pk} ({self.status})"

    @property
    def nights(self):
        return (self.check_out - self.check_in).days

    @property
    def changes_awaiting_acceptance(self):
        return bool(self.changes) and not self.changes_accepted


class HotelBookingRoom(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(HotelBooking, on_delete=models.CASCADE, related_name="rooms")
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT, related_name="booked_rooms")
    rate = models.ForeignKey(RoomRate, on_delete=models.PROTECT, related_name="booked_rooms")
    # Copied at booking.
    room_name = models.CharField(max_length=80)
    rate_name = models.CharField(max_length=60)
    per_adult_per_night = models.DecimalField(max_digits=10, decimal_places=2)
    # This room's stay price for its adults.
    price = models.DecimalField(max_digits=12, decimal_places=2)
    adults = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(10)])
    children = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(6)])

    class Meta:
        ordering = ["room_type__position", "rate__position", "pk"]

    def __str__(self):
        return f"{self.room_name}, {self.rate_name}"

    @property
    def guest_limit(self):
        return self.adults + self.children


def hotel_voucher_path(instance, filename):
    # Per tenant; the private storage replaces the file name with a random UUID.
    return f"hotel_vouchers/{connection.schema_name}/{instance.booking_id}/{filename}"


class HotelVoucher(models.Model):
    """Uploaded and deleted only while the booking is paid; served only by the authenticated download view."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    MAX_PER_BOOKING = 10
    MAX_SIZE = files.MAX_SIZE

    booking = models.ForeignKey(HotelBooking, on_delete=models.CASCADE, related_name="vouchers")
    file = models.FileField(storage=private_storage, upload_to=hotel_voucher_path, max_length=255)
    original_name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at", "pk"]

    def __str__(self):
        return self.original_name


class HotelBookingEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(HotelBooking, on_delete=models.CASCADE, related_name="events")
    # Null on creation.
    from_status = models.CharField(max_length=30, choices=HotelBooking.Status.choices, null=True, blank=True)
    to_status = models.CharField(max_length=30, choices=HotelBooking.Status.choices)
    # Null when the system acted.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def __str__(self):
        return f"{self.from_status or 'new'} → {self.to_status}"
