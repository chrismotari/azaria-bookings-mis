from django.conf import settings
from django.db import models

from catalog.models import Airport, Offering


class Query(models.Model):
    """A customer's request for options when no listed offering fits."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESPONDED = "responded", "Responded"
        CLOSED = "closed", "Closed"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="queries")
    origin = models.ForeignKey(Airport, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    destination = models.ForeignKey(Airport, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    date_from = models.DateField()
    date_to = models.DateField(null=True, blank=True)
    price_min = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_max = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Blank means any class.
    ticket_class = models.CharField(max_length=20, choices=Offering.TicketClass.choices, blank=True)
    max_stopovers = models.PositiveSmallIntegerField(null=True, blank=True)
    message = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "queries"

    def __str__(self):
        origin = self.origin.code if self.origin else "Any"
        destination = self.destination.code if self.destination else "Any"
        return f"{origin} → {destination} from {self.date_from} ({self.status})"


class QueryResponse(models.Model):
    query = models.ForeignKey(Query, on_delete=models.CASCADE, related_name="responses")
    message = models.TextField(blank=True)
    offerings = models.ManyToManyField(Offering, related_name="query_responses")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Response to query {self.query_id}"
