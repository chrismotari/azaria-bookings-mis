"""Support chat rules, shared by every desk: starting a chat, writing to it, reading, closing."""

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import connection, transaction
from django.utils import timezone
from django_tenants.utils import get_public_schema_name

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


def _notify(conversation, message):
    """Queues the email to the desk or to the requester on commit, for the desk the chat belongs to."""
    from . import tasks

    to_desk = not message.from_staff
    if connection.schema_name == get_public_schema_name():
        task = tasks.notify_platform_desk if to_desk else tasks.notify_platform_requester
        transaction.on_commit(lambda: task.delay(str(conversation.pk), str(message.pk)))
    else:
        queue(tasks.notify_desk_new_message if to_desk else tasks.notify_requester_reply, str(conversation.pk), str(message.pk))


def start_chat(*, email, subject, body, attachment=None, user=None, agency=None):
    """A new chat with the current schema's desk; a signed-in user's chat is theirs to follow, a guest's is a single
    message. agency: on the platform desk, the agency an agency admin writes from."""
    with transaction.atomic():
        conversation = Conversation.objects.create(
            subject=subject.strip(),
            email=email,
            name=user.full_name if user else "",
            requester=user.pk if user else None,
            agency=agency,
            last_message_at=timezone.now(),
            staff_unread=True,
        )
        message = _add(
            conversation, body=body, attachment=attachment, from_staff=False, author_name=conversation.name
        )
        _notify(conversation, message)
    return conversation


def write(conversation, *, body, attachment=None, from_staff, author_name):
    """A message on an open chat; the other side gets it unread and by email."""
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
        _notify(conversation, message)
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
