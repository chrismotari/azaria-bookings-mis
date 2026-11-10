"""Support chat emails 13 and 14 and the hourly auto-close (step 31: each agency's desk)."""

import logging
import mimetypes

from celery import shared_task

from core.emails import EMAIL_TASK_OPTIONS, send_email
from core.models import AppSettings
from core.tenancy import for_each_tenant, tenant_task

from . import services
from .models import Conversation, Message

logger = logging.getLogger(__name__)


def _load(conversation_id, message_id):
    message = Message.objects.select_related("conversation").filter(pk=message_id, conversation_id=conversation_id).first()
    return (message.conversation, message) if message else (None, None)


def _attachments(message):
    if not message.attachment:
        return []
    with message.attachment.open("rb") as file:
        content = file.read()
    mimetype = mimetypes.guess_type(message.attachment_name)[0] or "application/octet-stream"
    return [(message.attachment_name, content, mimetype)]


def _context(conversation, message):
    return {"conversation": conversation, "message": message, "is_guest": conversation.is_guest}


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_desk_new_message(conversation_id, message_id):
    """13. A new chat or message, to the agency's notification email."""
    conversation, message = _load(conversation_id, message_id)
    if conversation is None:
        return
    first = conversation.messages.order_by("created_at", "pk").first() == message
    send_email(
        "support_new_message",
        f"{'New chat' if first else 'New message'}: {conversation.subject}",
        AppSettings.get().admin_notification_email,
        {**_context(conversation, message), "first": first, "desk_path": f"/admin/chats/{conversation.pk}"},
        _attachments(message),
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_requester_reply(conversation_id, message_id):
    """14. The desk's reply, to whoever wrote in. Only while the chat is open."""
    conversation, message = _load(conversation_id, message_id)
    if conversation is None or conversation.status != Conversation.Status.OPEN:
        return
    send_email(
        "support_reply",
        f"Re: {conversation.subject}",
        conversation.email,
        {**_context(conversation, message), "chat_path": f"/account/support/{conversation.pk}"},
        _attachments(message),
    )


@shared_task
def close_idle_chats():
    """Hourly: closes chats 48 hours after their last message, in every active agency."""
    return for_each_tenant(services.close_idle_chats, "close_idle_chats")
