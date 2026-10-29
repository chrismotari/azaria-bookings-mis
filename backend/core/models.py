from django.db import models


class AppSettings(models.Model):
    """Single row (pk=1) created by a data migration."""

    payment_instructions = models.TextField(blank=True)
    payment_hold_hours = models.PositiveIntegerField(default=24)
    reminder_hours_before = models.PositiveIntegerField(default=4)
    admin_notification_email = models.EmailField()

    class Meta:
        verbose_name = "app settings"
        verbose_name_plural = "app settings"

    def __str__(self):
        return "App settings"

    @classmethod
    def get(cls):
        return cls.objects.get(pk=1)
