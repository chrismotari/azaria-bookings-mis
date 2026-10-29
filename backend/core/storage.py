import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PrivateStorage(FileSystemStorage):
    """Storage outside any served URL; files are only reachable through
    authenticated download views. Stored names are random UUIDs."""

    def __init__(self):
        super().__init__(location=settings.PRIVATE_MEDIA_ROOT)

    def url(self, name):
        raise ValueError("Private files have no URL.")

    def get_available_name(self, name, max_length=None):
        directory, original = os.path.split(name)
        extension = os.path.splitext(original)[1].lower()
        return super().get_available_name(os.path.join(directory, f"{uuid.uuid4().hex}{extension}"), max_length)


private_storage = PrivateStorage()
