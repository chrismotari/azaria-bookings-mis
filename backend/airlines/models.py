import os
import uuid

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, transaction

from core.storage import public_storage

MAX_LOGO_SIZE = 200 * 1024
# Allowed extension -> how files of that type begin (WebP: "RIFF", four size bytes, then "WEBP").
LOGO_SIGNATURES = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".webp": (b"RIFF",),
}


def validate_logo(file):
    """PNG, JPEG or WebP (no SVG: logos are public files), at most 200 KB, content matching the type."""
    if getattr(file, "_committed", False):
        # Already stored and checked when it was uploaded.
        return
    extension = os.path.splitext(file.name)[1].lower()
    if extension not in LOGO_SIGNATURES:
        raise ValidationError("Upload a PNG, JPEG or WebP image.")
    if file.size > MAX_LOGO_SIZE:
        raise ValidationError("The logo is larger than 200 KB.")
    head = file.read(12)
    file.seek(0)
    valid = head.startswith(LOGO_SIGNATURES[extension]) and (extension != ".webp" or head[8:12] == b"WEBP")
    if not valid:
        raise ValidationError("The file's content does not match its type.")


class Airline(models.Model):
    """An airline every agency can choose for its offers. Curated by the system owner; never deleted."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    iata_code = models.CharField(
        "IATA code",
        max_length=2,
        unique=True,
        validators=[RegexValidator(r"^[A-Z0-9]{2}$", "Two capital letters or digits, e.g. KQ.")],
    )
    icao_code = models.CharField(
        "ICAO code",
        max_length=3,
        blank=True,
        validators=[RegexValidator(r"^[A-Z]{3}$", "Three capital letters, e.g. KQA.")],
    )
    name = models.CharField(max_length=150)
    country = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField("active", default=True)
    logo = models.FileField(
        storage=public_storage, upload_to="airline_logos/", blank=True, max_length=255, validators=[validate_logo]
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        previous = None
        if not self._state.adding:
            previous = Airline.objects.filter(pk=self.pk).values_list("logo", flat=True).first()
        super().save(*args, **kwargs)
        if previous and previous != self.logo.name:
            # The replaced or removed logo goes once the change is saved for good.
            transaction.on_commit(lambda: public_storage.delete(previous))
