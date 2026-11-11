"""Support chats: someone writes to a desk, the desk replies and closes the chat."""

import uuid

from django.conf import settings
from django.db import connection, models

from core.storage import private_storage


class Conversation(models.Model):
    """A chat with a desk. A guest's chat (no requester) is a single message: replies reach them by email only."""

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.CharField(max_length=150)
    # Where replies go.
    email = models.EmailField()
    # The requester's name; blank for guests.
    name = models.CharField(max_length=150, blank=True)
    # The signed-in user who started it (an id, not a key: on the platform desk it is a user of an agency's schema).
    requester = models.UUIDField(null=True, blank=True, db_index=True)
    # Platform desk only: the agency an agency admin wrote from (no database constraint: the table also exists in
    # every agency's schema, where this stays empty).
    agency = models.ForeignKey(
        "tenants.Tenant", null=True, blank=True, on_delete=models.PROTECT, db_constraint=False, related_name="+"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    closed_at = models.DateTimeField(null=True, blank=True)
    # Who closed it; null when it closed by itself.
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    last_message_at = models.DateTimeField()
    # Whether the other side's latest message is unseen.
    requester_unread = models.BooleanField(default=False)
    staff_unread = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_message_at"]

    def __str__(self):
        return self.subject

    @property
    def is_guest(self):
        return self.requester is None


def attachment_path(instance, filename):
    # Per desk and conversation; the private storage replaces the file name with a random UUID.
    return f"support/{connection.schema_name}/{instance.conversation_id}/{filename}"


class Message(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    # True for the desk's replies.
    from_staff = models.BooleanField(default=False)
    author_name = models.CharField(max_length=150, blank=True)
    body = models.TextField(max_length=5000)
    attachment = models.FileField(storage=private_storage, upload_to=attachment_path, max_length=255, blank=True)
    attachment_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]
