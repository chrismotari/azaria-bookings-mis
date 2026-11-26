"""The agency's own mail server: settings by its admins and the owner, and how agency emails are sent."""

import smtplib

import pytest
from django.core import mail
from django.core.mail.backends.locmem import EmailBackend as LocmemBackend
from django_tenants.utils import schema_context

from core import emails
from core.emails import send_email
from core.models import AppSettings, MailServer
from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA
from tenants.models import Tenant
from tenants.tests.test_platform import owner, platform  # noqa: F401

pytestmark = pytest.mark.django_db

SERVER = {
    "host": "smtp.example.com",
    "port": 587,
    "security": "starttls",
    "username": "agent@example.com",
    "password": "app-secret",
    "from_email": "bookings@agency.example",
    "from_name": "",
}


class FakeServer:
    """Stands in for the agency's SMTP server: records the connection, then delivers to the outbox or fails."""

    def __init__(self, error=None):
        self.error = error
        self.connections = []

    def __call__(self, server):
        self.connections.append(
            {
                "host": server.host,
                "port": server.port,
                "username": server.username,
                "password": server.get_password(),
                "security": server.security,
            }
        )
        if self.error:
            error = self.error

            class Failing(LocmemBackend):
                def send_messages(self, messages):
                    raise error

            return Failing()
        return LocmemBackend()


@pytest.fixture
def fake_server(monkeypatch):
    fake = FakeServer()
    monkeypatch.setattr(emails, "agency_connection", fake)
    return fake


def saved(**changes):
    server = MailServer(**{key: value for key, value in {**SERVER, **changes}.items() if key != "password"})
    server.set_password(changes.get("password", SERVER["password"]))
    server.save()
    return server


def send_welcome():
    send_email("mail_test", "Hi", "cara@example.com", {"host": "x"})
    return mail.outbox[-1]


# Settings


def test_get_without_a_server(admin_api):
    data = admin_api.get("/api/admin/mail-server").data
    assert data["in_use"] is False and data["host"] == "" and data["port"] == 587 and data["has_password"] is False


def test_save_encrypts_and_never_returns_the_password(admin_api):
    response = admin_api.put("/api/admin/mail-server", SERVER, format="json")
    assert response.status_code == 200, response.data
    assert "password" not in response.data and response.data["has_password"] and response.data["in_use"]
    server = MailServer.current()
    assert server.password != "app-secret" and server.get_password() == "app-secret"
    assert "app-secret" not in str(admin_api.get("/api/admin/mail-server").data)


def test_a_blank_password_keeps_the_stored_one(admin_api):
    saved()
    response = admin_api.put("/api/admin/mail-server", {**SERVER, "password": "", "port": 465}, format="json")
    assert response.status_code == 200, response.data
    server = MailServer.current()
    assert server.port == 465 and server.get_password() == "app-secret"
    assert MailServer.objects.count() == 1


def test_no_username_clears_the_password(admin_api):
    saved()
    response = admin_api.put("/api/admin/mail-server", {**SERVER, "username": "", "password": ""}, format="json")
    assert response.status_code == 200, response.data
    assert MailServer.current().password == "" and response.data["has_password"] is False


@pytest.mark.parametrize(
    "changes, field",
    [
        ({"host": " "}, "host"),
        ({"port": 0}, "port"),
        ({"port": 70000}, "port"),
        ({"security": "tls"}, "security"),
        ({"from_email": "not an address"}, "from_email"),
        ({"password": ""}, "password"),
        ({"username": ""}, "username"),
    ],
)
def test_validation(admin_api, changes, field):
    response = admin_api.put("/api/admin/mail-server", {**SERVER, **changes}, format="json")
    assert response.status_code == 400 and field in response.data


def test_remove(admin_api):
    saved()
    response = admin_api.delete("/api/admin/mail-server")
    assert response.status_code == 200 and response.data["in_use"] is False
    assert not MailServer.objects.exists()


def test_customers_are_refused(customer_api):
    assert customer_api.get("/api/admin/mail-server").status_code == 403
    assert customer_api.put("/api/admin/mail-server", SERVER, format="json").status_code == 403
    assert customer_api.post("/api/admin/mail-server/test").status_code == 403


# Sending


def test_agency_emails_go_through_the_agencys_server(fake_server):
    saved()
    email = send_welcome()
    assert fake_server.connections == [
        {
            "host": "smtp.example.com",
            "port": 587,
            "username": "agent@example.com",
            "password": "app-secret",
            "security": "starttls",
        }
    ]
    assert email.from_email == "Test Agency <bookings@agency.example>"
    assert MailServer.current().last_success_at is not None


def test_the_from_name_when_given(fake_server):
    saved(from_name="Bookings Desk")
    assert send_welcome().from_email == "Bookings Desk <bookings@agency.example>"


def test_ssl_and_none_security_reach_the_connection():
    for security, tls, ssl in [("ssl", False, True), ("none", False, False), ("starttls", True, False)]:
        backend = emails.agency_connection(MailServer(**{**SERVER, "password": "", "security": security}))
        assert (backend.use_tls, backend.use_ssl, backend.timeout) == (tls, ssl, 15)


def test_without_a_server_the_platforms_server_in_the_agencys_name(settings):
    settings.DEFAULT_FROM_EMAIL = "Dira Manifest <no-reply@diramanifest.com>"
    AppSettings.objects.update(admin_notification_email="desk@agency.example")
    email = send_welcome()
    assert email.from_email == "Test Agency <no-reply@diramanifest.com>"
    assert email.reply_to == ["desk@agency.example"]


def test_platform_emails_keep_the_platforms_server(fake_server, settings):
    saved()
    other = Tenant.objects.get(schema_name=OTHER_SCHEMA)
    with schema_context(OTHER_SCHEMA):
        saved()
    Tenant.objects.filter(pk=other.pk).update(billing_email="billing@other.test")
    send_email("mail_test", "Platform", "billing@other.test", {"host": "x"}, platform=True)
    assert fake_server.connections == []
    assert mail.outbox[-1].from_email == settings.DEFAULT_FROM_EMAIL and mail.outbox[-1].reply_to == []


def test_a_failure_is_recorded_and_raised_without_fallback(monkeypatch):
    saved()
    monkeypatch.setattr(emails, "agency_connection", FakeServer(smtplib.SMTPAuthenticationError(535, b"Bad login")))
    with pytest.raises(smtplib.SMTPAuthenticationError):
        send_welcome()
    assert mail.outbox == []
    server = MailServer.current()
    assert server.last_failure_at is not None and "Bad login" in server.last_failure


def test_a_success_clears_the_failure(fake_server):
    from django.utils import timezone

    saved(last_failure_at=timezone.now(), last_failure="Bad login")
    send_welcome()
    server = MailServer.current()
    assert server.last_failure_at is None and server.last_failure == "" and server.last_success_at


# Test email


def test_the_test_email_goes_to_the_admin_at_once(admin_api, admin_user, fake_server):
    saved()
    response = admin_api.post("/api/admin/mail-server/test")
    assert response.data == {"sent": True, "error": ""}
    assert mail.outbox[-1].to == [admin_user.email] and "smtp.example.com" in mail.outbox[-1].body


def test_the_test_email_returns_and_records_the_error(admin_api, monkeypatch):
    saved()
    monkeypatch.setattr(emails, "agency_connection", FakeServer(ConnectionRefusedError("Connection refused")))
    response = admin_api.post("/api/admin/mail-server/test")
    assert response.data == {"sent": False, "error": "Connection refused"}
    assert MailServer.current().last_failure == "Connection refused"


def test_the_test_email_needs_a_saved_server(admin_api):
    assert admin_api.post("/api/admin/mail-server/test").status_code == 409


# The owner


def test_the_owner_sets_an_agencys_server(platform, owner, fake_server):  # noqa: F811
    other = Tenant.objects.get(schema_name=OTHER_SCHEMA)
    url = f"/api/platform/tenants/{other.pk}/mail-server"
    assert platform.get(url).data["in_use"] is False
    response = platform.put(url, SERVER, format="json")
    assert response.status_code == 200, response.data
    with schema_context(OTHER_SCHEMA):
        assert MailServer.current().get_password() == "app-secret"
    with schema_context(TEST_SCHEMA):
        assert not MailServer.objects.exists()

    response = platform.post(f"{url}/test")
    assert response.data == {"sent": True, "error": ""} and mail.outbox[-1].to == [owner.email]
    assert mail.outbox[-1].from_email == "Other Agency <bookings@agency.example>"

    status = platform.get(f"/api/platform/tenants/{other.pk}").data["mail_server"]
    assert status == {"in_use": True, "last_failure_at": None, "last_failure": ""}

    assert platform.delete(url).data["in_use"] is False
    with schema_context(OTHER_SCHEMA):
        assert not MailServer.objects.exists()


def test_agency_admins_cannot_use_the_owners_endpoints(admin_api):
    other = Tenant.objects.get(schema_name=OTHER_SCHEMA)
    assert admin_api.get(f"/api/platform/tenants/{other.pk}/mail-server", HTTP_HOST="localhost").status_code == 403
