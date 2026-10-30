from django.db import models
from django.utils import timezone


class Airport(models.Model):
    code = models.CharField(max_length=3, unique=True)
    name = models.CharField(max_length=200)
    city = models.CharField(max_length=200)
    country = models.CharField(max_length=100)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} – {self.city}"


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
    stopovers = models.PositiveSmallIntegerField(default=0)
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
