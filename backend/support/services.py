"""Support chat rules, shared by every desk: starting a chat, writing to it, reading, closing (steps 31 and 32)."""

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from core.tenancy import queue

from .models import Conversation, Message

# A chat closes by itself this long after its last message.
IDLE_LIMIT = timedelta(hours=48)


def _add(conversation, *, body, attachment, from_staff, author_name):
    message = Message(conversation=conversation, from_staff=from_staff, author_name=author_name, body=body)
    if attachment:
        message.attachment_name = attachment.name
        message.attachment.save(attachment.name, attachment, save=False)
    message.save()
    return message


def start_chat(*, email, subject, body, attachment=None, user=None):
    """A new chat with the desk; a signed-in user's chat is theirs to follow, a guest's is a single message."""
    from .tasks import notify_desk_new_message

    with transaction.atomic():
        conversation = Conversation.objects.create(
            subject=subject.strip(),
            email=email,
            name=user.full_name if user else "",
            requester=user.pk if user else None,
            last_message_at=timezone.now(),
            staff_unread=True,
        )
        message = _add(
            conversation, body=body, attachment=attachment, from_staff=False, author_name=conversation.name
        )
        queue(notify_desk_new_message, str(conversation.pk), str(message.pk))
    return conversation


def write(conversation, *, body, attachment=None, from_staff, author_name):
    """A message on an open chat; the other side gets it unread and by email."""
    from .tasks import notify_desk_new_message, notify_requester_reply

    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(pk=conversation.pk)
        if conversation.status != Conversation.Status.OPEN:
            raise ValidationError("This chat is closed. Start a new one to write again.")
        message = _add(conversation, body=body, attachment=attachment, from_staff=from_staff, author_name=author_name)
        conversation.last_message_at = message.created_at
        if from_staff:
            conversation.requester_unread = True
        else:
            conversation.staff_unread = True
        conversation.save(update_fields=["last_message_at", "requester_unread", "staff_unread"])
        task = notify_requester_reply if from_staff else notify_desk_new_message
        queue(task, str(conversation.pk), str(message.pk))
    return message


def mark_read(conversation, *, by_staff):
    field = "staff_unread" if by_staff else "requester_unread"
    if getattr(conversation, field):
        Conversation.objects.filter(pk=conversation.pk).update(**{field: False})
        setattr(conversation, field, False)
    return conversation


def close(conversation, user=None):
    """Closes a chat (user: who closed it; None when it closes by itself). Closing a closed chat changes nothing."""
    with transaction.atomic():
        conversation = Conversation.objects.select_for_update().get(pk=conversation.pk)
        if conversation.status == Conversation.Status.OPEN:
            conversation.status = Conversation.Status.CLOSED
            conversation.closed_at = timezone.now()
            conversation.closed_by = user
            conversation.save(update_fields=["status", "closed_at", "closed_by"])
    return conversation


def close_idle_chats():
    """Closes every open chat whose last message is older than IDLE_LIMIT; returns how many."""
    idle = Conversation.objects.filter(
        status=Conversation.Status.OPEN, last_message_at__lt=timezone.now() - IDLE_LIMIT
    )
    return idle.update(status=Conversation.Status.CLOSED, closed_at=timezone.now(), closed_by=None)
