import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import connection, models, transaction
from django.db.models import DecimalField, Exists, ExpressionWrapper, F, Min, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce, Round
from django.utils import timezone

from core.storage import public_storage

MAX_PHOTOS = 8
MAX_LIST_LINES = 30
MAX_PEOPLE = 40


class TourQuerySet(models.QuerySet):
    def with_figures(self):
        """Annotates booked (people on confirmed bookings), from_price (null without an active option) and
        units_open (an active option with units left)."""
        booked = (
            TourBooking.objects.filter(tour=OuterRef("pk"), status=TourBooking.Status.CONFIRMED)
            .values("tour")
            .annotate(total=Sum("people"))
            .values("total")
        )
        per_person = ExpressionWrapper(
            F("price") / F("people_per_unit"), output_field=DecimalField(max_digits=12, decimal_places=6)
        )
        from_price = (
            TourPriceOption.objects.filter(tour=OuterRef("pk"), is_active=True)
            .values("tour")
            .annotate(lowest=Min(Round(per_person, 2)))
            .values("lowest")
        )
        open_options = (
            TourPriceOption.objects.with_sold()
            .filter(tour=OuterRef("pk"), is_active=True)
            .filter(Q(units_available__isnull=True) | Q(units_available__gt=F("sold")))
        )
        return self.annotate(
            booked=Coalesce(Subquery(booked), 0),
            from_price=Subquery(from_price, output_field=DecimalField(max_digits=10, decimal_places=2)),
            units_open=Exists(open_options),
        )

    def listed(self):
        """Shown to customers: open for booking, fully booked or not."""
        today = timezone.localdate()
        return self.with_figures().filter(
            is_active=True,
            cancelled_at__isnull=True,
            booking_deadline__gte=today,
            start_date__gt=today,
            from_price__isnull=False,
        )

    def bookable(self):
        return self.listed().filter(slots__gt=F("booked"), units_open=True)


class Tour(models.Model):
    """Never deleted; a cancelled tour cannot be edited or reactivated."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=120)
    destination = models.CharField(max_length=120)
    start_date = models.DateField()
    end_date = models.DateField()
    slots = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(500)])
    booking_deadline = models.DateField()
    cancellation_deadline = models.DateField()
    cancellation_policy = models.TextField(max_length=2000)
    summary = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    included = models.JSONField(default=list, blank=True)
    not_included = models.JSONField(default=list, blank=True)
    meeting_point = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = TourQuerySet.as_manager()

    class Meta:
        ordering = ["start_date", "title"]

    def __str__(self):
        return self.title

    @property
    def duration_days(self):
        return (self.end_date - self.start_date).days + 1

    @property
    def slots_left(self):
        return max(self.slots - self.booked, 0)

    def not_bookable_reason(self):
        """None when customers can book; otherwise cancelled, closed or fully_booked. Needs with_figures()."""
        today = timezone.localdate()
        if self.cancelled_at is not None:
            return "cancelled"
        if not self.is_active or self.from_price is None or today > self.booking_deadline or today >= self.start_date:
            return "closed"
        if self.slots_left <= 0 or not self.units_open:
            return "fully_booked"
        return None


class TourPriceOptionQuerySet(models.QuerySet):
    def with_sold(self):
        """Annotates sold (units on confirmed bookings) and booked (on any booking, so it cannot be deleted)."""
        sold = (
            TourBookingLine.objects.filter(option=OuterRef("pk"), booking__status=TourBooking.Status.CONFIRMED)
            .values("option")
            .annotate(total=Sum("quantity"))
            .values("total")
        )
        return self.annotate(
            sold=Coalesce(Subquery(sold), 0), booked=Exists(TourBookingLine.objects.filter(option=OuterRef("pk")))
        )


class TourPriceOption(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tour = models.ForeignKey(Tour, on_delete=models.CASCADE, related_name="options")
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=200, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    people_per_unit = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(20)]
    )
    # Null: limited only by the tour's slots.
    units_available = models.PositiveSmallIntegerField(null=True, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    objects = TourPriceOptionQuerySet.as_manager()

    class Meta:
        ordering = ["position", "pk"]
        constraints = [models.UniqueConstraint(fields=["tour", "name"], name="unique_tour_option_name")]

    def __str__(self):
        return self.name

    @property
    def units_left(self):
        """Null when unlimited. Needs with_sold()."""
        if self.units_available is None:
            return None
        return max(self.units_available - self.sold, 0)


def tour_photo_path(instance, filename):
    # The public storage replaces the file name with a random UUID.
    return f"tours/{connection.schema_name}/{instance.tour_id}/{filename}"


class TourPhoto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tour = models.ForeignKey(Tour, on_delete=models.CASCADE, related_name="photos")
    image = models.FileField(storage=public_storage, upload_to=tour_photo_path, max_length=255)
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


class TourBooking(models.Model):
    """Status changes go through tours.services only."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Status(models.TextChoices):
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"
        COMPLETED = "completed", "Completed"

    class CancelledBy(models.TextChoices):
        CUSTOMER = "customer", "Customer"
        ADMIN = "admin", "Admin"

    tour = models.ForeignKey(Tour, on_delete=models.PROTECT, related_name="bookings")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tour_bookings")
    # The admin who booked for the customer; null when the customer booked.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    people = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(MAX_PEOPLE)])
    group_name = models.CharField(max_length=80, blank=True)
    notes = models.TextField(max_length=1000, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    cancelled_by = models.CharField(max_length=20, choices=CancelledBy.choices, null=True, blank=True)
    cancel_reason = models.TextField(max_length=2000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Tour booking {self.pk} ({self.status})"

    @property
    def total_price(self):
        return sum((line.total_price for line in self.lines.all()), 0)


class TourBookingLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(TourBooking, on_delete=models.CASCADE, related_name="lines")
    option = models.ForeignKey(TourPriceOption, on_delete=models.PROTECT, related_name="lines")
    # Copied from the option at booking.
    option_name = models.CharField(max_length=60)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    people_per_unit = models.PositiveSmallIntegerField()
    quantity = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        ordering = ["option__position", "pk"]
        constraints = [models.UniqueConstraint(fields=["booking", "option"], name="unique_booking_line_option")]

    def __str__(self):
        return f"{self.quantity} × {self.option_name}"

    @property
    def total_price(self):
        return self.unit_price * self.quantity

    @property
    def people(self):
        return self.people_per_unit * self.quantity


class TourBookingEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    booking = models.ForeignKey(TourBooking, on_delete=models.CASCADE, related_name="events")
    # Null on creation.
    from_status = models.CharField(max_length=20, choices=TourBooking.Status.choices, null=True, blank=True)
    to_status = models.CharField(max_length=20, choices=TourBooking.Status.choices)
    # Null when the system acted.
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def __str__(self):
        return f"{self.from_status or 'new'} → {self.to_status}"


class TourNotice(models.Model):
    """Every message the admin sent about the tour."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Kind(models.TextChoices):
        CHANGE = "change", "Change"
        CANCELLATION = "cancellation", "Cancellation"

    tour = models.ForeignKey(Tour, on_delete=models.CASCADE, related_name="notices")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    message = models.TextField(max_length=2000)
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # How many bookings it was emailed to.
    recipients = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} notice for {self.tour}"
