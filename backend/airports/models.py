import uuid

from django.db import models


class Airport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=3, unique=True)
    name = models.CharField(max_length=200)
    city = models.CharField(max_length=200)
    country = models.CharField(max_length=100)
    # ISO 3166-1 alpha-2, e.g. "KE"; the app shows its flag.
    country_code = models.CharField(max_length=2, blank=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} – {self.city}"
