from django.db import models


class Airport(models.Model):
    code = models.CharField(max_length=3, unique=True)
    name = models.CharField(max_length=200)
    city = models.CharField(max_length=200)
    country = models.CharField(max_length=100)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} – {self.city}"
