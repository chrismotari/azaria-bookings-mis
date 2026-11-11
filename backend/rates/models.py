import uuid

from django.db import models
from django.utils import timezone


class ExchangeRate(models.Model):
    """How many units of a currency one US dollar buys on a day. USD itself is always 1 and has no rows."""

    class Source(models.TextChoices):
        FEED = "feed", "Feed"
        MANUAL = "manual", "Manual"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # ISO 4217, upper case.
    currency = models.CharField(max_length=3)
    units_per_usd = models.DecimalField(max_digits=20, decimal_places=8)
    date = models.DateField()
    source = models.CharField(max_length=10, choices=Source.choices)
    fetched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["currency", "-date"]
        constraints = [models.UniqueConstraint(fields=["currency", "date"], name="one_rate_per_currency_per_day")]

    def __str__(self):
        return f"{self.currency} {self.units_per_usd} ({self.date})"
