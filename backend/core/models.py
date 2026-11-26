import uuid

from django.db import models


class AppSettings(models.Model):
    """Single row, created by a data migration."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

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
        return cls.objects.get()


class MailServer(models.Model):
    """The agency's own SMTP server for its emails; at most one row, none = the platform's server."""

    class Security(models.TextChoices):
        STARTTLS = "starttls", "STARTTLS"
        SSL = "ssl", "SSL"
        NONE = "none", "None"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    host = models.CharField(max_length=255)
    port = models.PositiveIntegerField(default=587)
    security = models.CharField(max_length=10, choices=Security.choices, default=Security.STARTTLS)
    username = models.CharField(max_length=255, blank=True)
    # Encrypted with INTEGRATIONS_KEY; never sent to clients.
    password = models.TextField(blank=True)
    from_email = models.EmailField()
    from_name = models.CharField(max_length=80, blank=True)
    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_failure = models.CharField(max_length=500, blank=True)

    def __str__(self):
        return self.host

    @classmethod
    def current(cls):
        return cls.objects.first()

    def set_password(self, value):
        from integrations.models import fernet

        self.password = fernet().encrypt(value.encode()).decode() if value else ""

    def get_password(self):
        from integrations.models import fernet

        return fernet().decrypt(self.password.encode()).decode() if self.password else ""
