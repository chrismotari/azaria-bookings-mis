"""Support chat, the platform's desk (step 32): root-host visitors and agency admins write in, the owner answers."""

from datetime import timedelta

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from django_tenants.utils import schema_context
from rest_framework.test import APIClient

from accounts.models import User
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA
from support import tasks
from support.models import Conversation
from tenants.models import PlatformSettings, Tenant
from tenants.tests.test_platform import owner, platform  # noqa: F401 (fixtures)

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n%test\n"
ROOT = "localhost"


@pytest.fixture(autouse=True)
def support_email():
    PlatformSettings.objects.filter(pk=1).update(support_email="support@platform.test")


def public_chats():
    with schema_context("public"):
        return list(Conversation.objects.select_related("agency").order_by("created_at"))


def agency_admin(host=None, email="boss@test.test", schema=TEST_SCHEMA):
    with schema_context(schema):
        user = User.objects.create_user(email=email, password="Str0ng-pass!", full_name="Ada Boss", role="admin")
    client = APIClient(**({"HTTP_HOST": host} if host else {}))
    client.force_authenticate(user)
    return client, user


def test_a_visitor_writes_to_the_platform_and_the_owner_answers(platform, django_capture_on_commit_callbacks):
    visitor = APIClient(HTTP_HOST=ROOT)
    with django_capture_on_commit_callbacks(execute=True):
        response = visitor.post(
            "/api/platform/support/chats",
            {"email": "lead@agency.test", "subject": "Plan enquiry: Starter (annual)", "body": "Tell me more."},
            format="multipart",
        )
    assert response.status_code == 201 and response.data == {"email": "lead@agency.test"}
    [chat] = public_chats()
    assert chat.is_guest and chat.agency is None
    # Not on any agency's desk.
    with schema_context(TEST_SCHEMA):
        assert Conversation.objects.count() == 0
    [email] = mail.outbox
    assert email.to == ["support@platform.test"] and f"http://localhost:8081/chats/{chat.pk}" in email.body

    rows = platform.get("/api/platform/chats").data["results"]
    assert [(row["subject"], row["agency"], row["unread"]) for row in rows] == [
        ("Plan enquiry: Starter (annual)", None, True)
    ]
    assert platform.get("/api/platform/chats/unread").data == {"count": 1}
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        reply = platform.post(f"/api/platform/chats/{chat.pk}/messages", {"body": "Here are the details."})
    assert reply.status_code == 201
    [email] = mail.outbox
    assert email.to == ["lead@agency.test"] and "message button on our site" in email.body
    assert platform.post(f"/api/platform/chats/{chat.pk}/close").data["status"] == "closed"


def test_the_owner_cannot_write_to_their_own_desk(platform):
    response = platform.post("/api/platform/support/chats", {"email": "a@b.c", "subject": "x", "body": "y"})
    assert response.status_code == 403


def test_the_platform_desk_is_for_the_owner_only():
    customer = APIClient()
    assert APIClient(HTTP_HOST=ROOT).get("/api/platform/chats").status_code == 401
    # Agency hosts have no platform desk.
    assert customer.get("/api/platform/chats").status_code == 404


def test_an_agency_admin_writes_to_the_platform(platform, django_capture_on_commit_callbacks):
    client, admin = agency_admin()
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(
            "/api/support/platform-chats",
            {
                "email": "boss@test.test",
                "subject": "Plan enquiry: Basic (monthly)",
                "body": "We would like to switch.",
                "attachment": SimpleUploadedFile("list.pdf", PDF, content_type="application/pdf"),
            },
            format="multipart",
        )
    assert response.status_code == 201, response.data
    chat_id = response.data["id"]
    [chat] = public_chats()
    assert (chat.agency.schema_name, chat.requester, chat.name) == (TEST_SCHEMA, admin.pk, "Ada Boss")
    with schema_context("public"):
        message = chat.messages.get()
    assert message.attachment.name.startswith("support/public/")
    # On the platform desk, with the agency named (in the desk email too); not on the agency's own desk.
    [email] = mail.outbox
    assert email.to == ["support@platform.test"] and "Agency: Test Agency" in email.body
    assert client.get("/api/admin/chats").data["results"] == []
    [row] = platform.get("/api/platform/chats").data["results"]
    assert row["agency"] == {"id": chat.agency_id, "name": "Test Agency"}

    # The owner replies: the admin gets an email linking to their Support page on their agency's site.
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        platform.post(f"/api/platform/chats/{chat_id}/messages", {"body": "Done from the next invoice."})
    [email] = mail.outbox
    assert email.to == ["boss@test.test"] and f"http://testserver:8081/admin/support/{chat_id}" in email.body

    assert client.get("/api/support/platform-chats/unread").data == {"count": 1}
    listed = client.get("/api/support/platform-chats").data["results"]
    assert [row["subject"] for row in listed] == ["Plan enquiry: Basic (monthly)"]
    detail = client.get(f"/api/support/platform-chats/{chat_id}").data
    assert [m["body"] for m in detail["messages"]] == ["We would like to switch.", "Done from the next invoice."]
    assert client.get("/api/support/platform-chats/unread").data == {"count": 0}
    attachment = client.get(f"/api/support/platform-attachments/{message.pk}")
    assert attachment.status_code == 200 and b"".join(attachment.streaming_content) == PDF
    assert client.post(f"/api/support/platform-chats/{chat_id}/messages", {"body": "Thanks"}).status_code == 201


def test_agency_admins_see_only_their_own_platform_chats(platform):
    test_admin, _ = agency_admin()
    chat_id = test_admin.post(
        "/api/support/platform-chats", {"email": "a@test.test", "subject": "Hi", "body": "Hello"}
    ).data["id"]
    other_admin, _ = agency_admin(OTHER_DOMAIN, "boss@other.test", OTHER_SCHEMA)
    assert other_admin.get("/api/support/platform-chats").data["results"] == []
    assert other_admin.get(f"/api/support/platform-chats/{chat_id}").status_code == 404
    assert other_admin.post(f"/api/support/platform-chats/{chat_id}/messages", {"body": "x"}).status_code == 404
    # Customers cannot use it.
    customer = APIClient()
    with schema_context(TEST_SCHEMA):
        user = User.objects.create_user(email="c@test.test", password="Str0ng-pass!", full_name="C")
    customer.force_authenticate(user)
    assert customer.get("/api/support/platform-chats").status_code == 403


def test_platform_chats_close_after_48_hours_too():
    with schema_context("public"):
        chat = Conversation.objects.create(
            subject="Old", email="a@b.c", last_message_at=timezone.now() - timedelta(hours=49)
        )
    assert tasks.close_idle_chats.delay().get() == 1
    with schema_context("public"):
        chat.refresh_from_db()
        assert chat.status == "closed"


def test_no_desk_email_without_a_support_email():
    PlatformSettings.objects.filter(pk=1).update(support_email="")
    APIClient(HTTP_HOST=ROOT).post("/api/platform/support/chats", {"email": "a@b.c", "subject": "x", "body": "y"})
    assert mail.outbox == []


def test_the_support_email_setting(platform):
    response = platform.patch("/api/platform/settings", {"support_email": "help@azaria.test"}, format="json")
    assert response.data["support_email"] == "help@azaria.test"
    assert Tenant.objects.exists()
