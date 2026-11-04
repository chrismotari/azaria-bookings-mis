import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class RandomNameMixin:
    """Stored names are random UUIDs plus the original (lowercased) extension."""

    def get_available_name(self, name, max_length=None):
        directory, original = os.path.split(name)
        extension = os.path.splitext(original)[1].lower()
        return super().get_available_name(os.path.join(directory, f"{uuid.uuid4().hex}{extension}"), max_length)


class PrivateStorage(RandomNameMixin, FileSystemStorage):
    """Storage outside any served URL; files are only reachable through authenticated download views."""

    def __init__(self):
        super().__init__(location=settings.PRIVATE_MEDIA_ROOT)

    def url(self, name):
        raise ValueError("Private files have no URL.")


class PublicStorage(RandomNameMixin, FileSystemStorage):
    """Public files (airline logos), served under MEDIA_URL: by Django in development, by the proxy in production."""

    def __init__(self):
        super().__init__(location=settings.PUBLIC_MEDIA_ROOT, base_url=settings.MEDIA_URL)


private_storage = PrivateStorage()
public_storage = PublicStorage()
