"""Support chat emails and the hourly auto-close, for each agency's desk and the platform's."""

import logging
import mimetypes

from celery import shared_task
from django_tenants.utils import get_public_schema_name, schema_context

from core.emails import EMAIL_TASK_OPTIONS, send_email
from core.models import AppSettings
from core.tenancy import for_each_tenant, tenant_task

from . import services
from .models import Conversation, Message

logger = logging.getLogger(__name__)


def _load(conversation_id, message_id):
    message = (
        Message.objects.select_related("conversation").filter(pk=message_id, conversation_id=conversation_id).first()
    )
    return (message.conversation, message) if message else (None, None)


def _attachments(message):
    if not message.attachment:
        return []
    with message.attachment.open("rb") as file:
        content = file.read()
    mimetype = mimetypes.guess_type(message.attachment_name)[0] or "application/octet-stream"
    return [(message.attachment_name, content, mimetype)]


def _context(conversation, message):
    return {
        "conversation": conversation,
        "message": message,
        "is_guest": conversation.is_guest,
        "agency_name": conversation.agency.name if conversation.agency_id else "",
    }


def _is_first(conversation, message):
    return conversation.messages.order_by("created_at", "pk").first() == message


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_desk_new_message(conversation_id, message_id):
    """A new chat or message, to the agency's notification email."""
    conversation, message = _load(conversation_id, message_id)
    if conversation is None:
        return
    first = _is_first(conversation, message)
    send_email(
        "support_new_message",
        f"{'New chat' if first else 'New message'}: {conversation.subject}",
        AppSettings.get().admin_notification_email,
        {**_context(conversation, message), "first": first, "desk_path": f"/admin/chats/{conversation.pk}"},
        _attachments(message),
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def notify_requester_reply(conversation_id, message_id):
    """The desk's reply, to whoever wrote in. Only while the chat is open."""
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


# The platform's desk (public schema)


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_platform_desk(conversation_id, message_id):
    """A new chat or message on the platform's desk, to PlatformSettings.support_email (skipped while it is blank)."""
    from tenants.models import PlatformSettings

    with schema_context(get_public_schema_name()):
        conversation, message = _load(conversation_id, message_id)
        to = PlatformSettings.get().support_email
        if conversation is None or not to:
            return
        first = _is_first(conversation, message)
        send_email(
            "support_new_message",
            f"{'New chat' if first else 'New message'}: {conversation.subject}",
            to,
            {**_context(conversation, message), "first": first, "desk_path": f"/chats/{conversation.pk}"},
            _attachments(message),
        )


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_platform_requester(conversation_id, message_id):
    """The system owner's reply, to whoever wrote in. An agency admin's link opens their own Support
    page on the agency's site. Only while the chat is open."""
    with schema_context(get_public_schema_name()):
        conversation, message = _load(conversation_id, message_id)
        if conversation is None or conversation.status != Conversation.Status.OPEN:
            return
        context = {**_context(conversation, message), "chat_path": f"/admin/support/{conversation.pk}"}
        attachments = _attachments(message)
        agency = conversation.agency
    # Links point at the agency's site for its admins, at the root host for guests.
    with schema_context(agency.schema_name if agency else get_public_schema_name()):
        send_email("support_reply", f"Re: {conversation.subject}", conversation.email, context, attachments)


@shared_task
def close_idle_chats():
    """Hourly: closes chats 48 hours after their last message, on the platform's desk and in every active agency."""
    with schema_context(get_public_schema_name()):
        closed = services.close_idle_chats()
    return closed + for_each_tenant(services.close_idle_chats, "close_idle_chats")
