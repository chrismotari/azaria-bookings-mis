"""Support chat, agency desk (step 31)."""

from datetime import timedelta

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AppSettings
from core.tests.helpers import OTHER_DOMAIN, html_part
from support import tasks
from support.models import Conversation, Message

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n%test\n"


def pdf(name="details.pdf", content=PDF, content_type="application/pdf"):
    return SimpleUploadedFile(name, content, content_type=content_type)


@pytest.fixture(autouse=True)
def desk_email():
    AppSettings.objects.update(admin_notification_email="desk@agency.test")


def start(client, **data):
    body = {"email": "guest@example.com", "subject": "Baggage", "body": "How many kilos?", **data}
    return client.post("/api/support/chats", body, format="multipart")


# Starting chats


def test_a_guest_starts_a_chat_and_cannot_read_it(api, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = start(api, attachment=pdf())
    assert response.status_code == 201 and response.data == {"email": "guest@example.com"}
    chat = Conversation.objects.get()
    assert chat.is_guest and chat.status == "open" and chat.staff_unread
    [message] = chat.messages.all()
    assert message.attachment_name == "details.pdf" and message.attachment.name.startswith("support/test/")
    # Email 13 to the desk, with the attachment and a link to the chat.
    [email] = mail.outbox
    assert email.to == ["desk@agency.test"] and email.subject == "New chat: Baggage"
    assert "replies reach them by email only" in email.body and f"/admin/chats/{chat.pk}" in email.body
    assert email.attachments[0][0] == "details.pdf"
    html_part(email)
    # Nothing to read back for a guest.
    assert api.get("/api/support/chats").status_code == 401
    assert api.get(f"/api/support/chats/{chat.pk}").status_code == 401


def test_guest_chats_are_throttled_per_ip(api):
    for _ in range(10):
        assert start(api).status_code == 201
    assert start(api).status_code == 429


def test_signed_in_requesters_are_not_throttled(customer_api):
    for _ in range(11):
        assert start(customer_api).status_code == 201


@pytest.mark.parametrize(
    "attachment, error",
    [
        (pdf("x.exe", b"MZ", "application/octet-stream"), "Upload a PDF, PNG or JPEG file."),
        (pdf("x.pdf", b"not a pdf"), "The file's content does not match its type."),
        (pdf("x.pdf", PDF + b"0" * (5 * 1024 * 1024)), "The file is larger than 5 MB."),
    ],
)
def test_attachments_are_checked(api, attachment, error):
    response = start(api, attachment=attachment)
    assert response.status_code == 400 and response.data["attachment"] == [error]


def test_the_form_fields_are_required_and_limited(api):
    response = start(api, email="nope", subject=" ", body=" ")
    assert response.status_code == 400 and {"email", "subject", "body"} <= set(response.data)
    assert start(api, subject="s" * 151).status_code == 400
    assert start(api, body="b" * 5001).status_code == 400


def test_the_desk_cannot_start_a_chat_with_itself(admin_api):
    assert start(admin_api).status_code == 403


# Signed-in requesters


def test_a_customer_follows_their_chat(customer_api, customer, admin_api, django_capture_on_commit_callbacks):
    response = start(customer_api, email="cara.other@example.com")
    assert response.status_code == 201
    chat_id = response.data["id"]
    assert response.data["email"] == "cara.other@example.com" and len(response.data["messages"]) == 1
    assert Conversation.objects.get().name == customer.full_name

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        reply = admin_api.post(
            f"/api/admin/chats/{chat_id}/messages", {"body": "20 kg", "attachment": pdf("rules.pdf")}, format="multipart"
        )
    assert reply.status_code == 201
    # Email 14 to the chat's email, with a link to the chat in Support.
    [email] = mail.outbox
    assert email.to == ["cara.other@example.com"] and email.subject == "Re: Baggage"
    assert "20 kg" in email.body and f"/account/support/{chat_id}" in email.body
    assert email.attachments[0][0] == "rules.pdf"

    assert customer_api.get("/api/support/unread").data == {"count": 1}
    listed = customer_api.get("/api/support/chats", {"status": "open"}).data["results"]
    assert [row["unread"] for row in listed] == [True]
    detail = customer_api.get(f"/api/support/chats/{chat_id}").data
    assert [m["body"] for m in detail["messages"]] == ["How many kilos?", "20 kg"]
    assert detail["messages"][1]["from_staff"] and detail["messages"][1]["has_attachment"]
    assert customer_api.get("/api/support/unread").data == {"count": 0}

    # The customer answers on the same chat (its subject and email stay as they were).
    response = customer_api.post(
        f"/api/support/chats/{chat_id}/messages", {"body": "Thanks", "subject": "Other", "email": "x@y.z"}
    )
    assert response.status_code == 201
    chat = Conversation.objects.get()
    assert (chat.subject, chat.email, chat.staff_unread) == ("Baggage", "cara.other@example.com", True)


def test_requesters_see_only_their_own_chats(customer_api, other_customer_api):
    chat_id = start(customer_api).data["id"]
    assert other_customer_api.get("/api/support/chats").data["results"] == []
    assert other_customer_api.get(f"/api/support/chats/{chat_id}").status_code == 404
    assert other_customer_api.post(f"/api/support/chats/{chat_id}/messages", {"body": "hi"}).status_code == 404


def test_attachments_open_for_the_desk_and_the_requester_only(customer_api, other_customer_api, admin_api, api):
    start(customer_api, attachment=pdf())
    message = Message.objects.get()
    url = f"/api/support/attachments/{message.pk}"
    for client in [customer_api, admin_api]:
        response = client.get(url)
        assert response.status_code == 200 and b"".join(response.streaming_content) == PDF
        assert response["Content-Type"] == "application/pdf"
    assert other_customer_api.get(url).status_code == 404
    assert api.get(url).status_code == 401
    # A guest's attachment is for the desk only.
    start(APIClient(), attachment=pdf())
    guest_message = Message.objects.get(conversation__requester=None)
    assert admin_api.get(f"/api/support/attachments/{guest_message.pk}").status_code == 200


# The desk


def test_the_desk_lists_reads_and_closes(customer_api, admin_api, admin_user):
    older = start(customer_api, subject="Older").data["id"]
    newer = start(APIClient(), subject="Newer")
    Conversation.objects.filter(pk=older).update(staff_unread=False)
    rows = admin_api.get("/api/admin/chats").data["results"]
    # Unread first.
    assert [(row["subject"], row["unread"], row["is_guest"]) for row in rows] == [
        ("Newer", True, True),
        ("Older", False, False),
    ]
    assert admin_api.get("/api/admin/chats/unread").data == {"count": 1}
    guest_id = rows[0]["id"]
    assert admin_api.get(f"/api/admin/chats/{guest_id}").data["name"] == ""
    assert admin_api.get("/api/admin/chats/unread").data == {"count": 0}

    closed = admin_api.post(f"/api/admin/chats/{older}/close").data
    assert closed["status"] == "closed" and closed["closed_by_name"] == admin_user.full_name
    assert [row["subject"] for row in admin_api.get("/api/admin/chats").data["results"]] == ["Newer"]
    assert [row["subject"] for row in admin_api.get("/api/admin/chats", {"status": "closed"}).data["results"]] == [
        "Older"
    ]
    # Closed: it leaves the requester's open list, and nobody can write to it.
    assert customer_api.get("/api/support/chats", {"status": "open"}).data["results"] == []
    assert len(customer_api.get("/api/support/chats").data["results"]) == 1
    assert customer_api.post(f"/api/support/chats/{older}/messages", {"body": "hi"}).status_code == 409
    assert admin_api.post(f"/api/admin/chats/{older}/messages", {"body": "hi"}).status_code == 409


def test_the_desk_is_for_the_agencys_admins(customer_api, api):
    for client, code in [(customer_api, 403), (api, 401)]:
        assert client.get("/api/admin/chats").status_code == code
        assert client.get("/api/admin/chats/unread").status_code == code


def test_no_reply_email_once_closed(customer_api, admin_api):
    chat = Conversation.objects.get(pk=start(customer_api).data["id"])
    message = Message.objects.create(conversation=chat, from_staff=True, author_name="A", body="late")
    Conversation.objects.filter(pk=chat.pk).update(status="closed")
    mail.outbox.clear()
    tasks.notify_requester_reply.delay("test", str(chat.pk), str(message.pk))
    assert mail.outbox == []


# Auto-close and isolation


def test_chats_close_48_hours_after_their_last_message(customer_api):
    idle = Conversation.objects.get(pk=start(customer_api, subject="Idle").data["id"])
    active = Conversation.objects.get(pk=start(customer_api, subject="Active").data["id"])
    now = timezone.now()
    Conversation.objects.filter(pk=idle.pk).update(last_message_at=now - timedelta(hours=48, minutes=1))
    Conversation.objects.filter(pk=active.pk).update(
        last_message_at=now - timedelta(hours=47), created_at=now - timedelta(days=5)
    )
    assert tasks.close_idle_chats.delay().get() == 1
    idle.refresh_from_db()
    active.refresh_from_db()
    assert (idle.status, idle.closed_by) == ("closed", None) and active.status == "open"


def test_another_agency_does_not_see_these_chats(customer_api):
    start(customer_api)
    from accounts.models import User
    from django_tenants.utils import schema_context

    with schema_context("other"):
        admin = User.objects.create_user(email="boss@other.test", password="Str0ng-pass!", full_name="O", role="admin")
        assert Conversation.objects.count() == 0
    client = APIClient(HTTP_HOST=OTHER_DOMAIN)
    client.force_authenticate(admin)
    assert client.get("/api/admin/chats").data["results"] == []
