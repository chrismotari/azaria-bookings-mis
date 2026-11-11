"""Schema-per-tenant isolation, the platform host, suspension, scheduled jobs and creating agencies."""

from datetime import timedelta

import pytest
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.exceptions import ValidationError
from django.db import connection
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django_tenants.utils import schema_context, schema_exists
from rest_framework.test import APIClient

from accounts.models import User
from bookings import tasks
from bookings.models import Booking
from catalog.models import Offer
from core.models import AppSettings
from core.tenancy import for_each_tenant
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA
from tenants import services
from tenants.models import Domain, Tenant

pytestmark = pytest.mark.django_db

PASSWORD = "Str0ng-pass!"
ROOT = "localhost"


@pytest.fixture
def other_api():
    return APIClient(HTTP_HOST=OTHER_DOMAIN)


def suspend(schema_name):
    Tenant.objects.filter(schema_name=schema_name).update(is_active=False)


def login(client, email):
    response = client.post("/api/auth/login", {"email": email, "password": PASSWORD}, format="json")
    assert response.status_code == 200, response.data
    return response.data


# Isolation


def test_offers_and_bookings_are_invisible_to_another_agency(api, other_api, make_offer, customer):
    offer = make_offer()
    Booking.objects.create(user=customer, offer=offer, passenger_count=1, unit_price=offer.price)
    assert api.get("/api/offers").data["count"] == 1
    assert other_api.get("/api/offers").data["count"] == 0
    assert other_api.get(f"/api/offers/{offer.id}").status_code == 404
    with schema_context(OTHER_SCHEMA):
        assert not Offer.objects.exists()
        assert not Booking.objects.exists()


def test_the_same_email_can_register_at_two_agencies(api, other_api):
    body = {"email": "twice@example.com", "password": PASSWORD, "full_name": "Twice", "phone": "+254700000009"}
    assert api.post("/api/auth/register", body, format="json").status_code == 201
    assert other_api.post("/api/auth/register", body, format="json").status_code == 201
    assert User.objects.filter(email="twice@example.com").count() == 1
    with schema_context(OTHER_SCHEMA):
        assert User.objects.filter(email="twice@example.com").count() == 1


def test_airports_are_shared(api, other_api, airports):
    for client in (api, other_api):
        assert [a["code"] for a in client.get("/api/airports", {"search": "NBO"}).data] == ["NBO"]


def test_a_token_from_one_agency_is_refused_at_another(api, other_api, customer):
    tokens = login(api, customer.email)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert api.get("/api/auth/me").status_code == 200

    other_api.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert other_api.get("/api/auth/me").status_code == 401
    other_api.credentials()
    assert other_api.post("/api/auth/refresh", {"refresh": tokens["refresh"]}, format="json").status_code == 401
    assert api.post("/api/auth/refresh", {"refresh": tokens["refresh"]}, format="json").status_code == 200


def test_a_reset_link_from_one_agency_fails_at_another(api, other_api, customer):
    body = {
        "uid": urlsafe_base64_encode(force_bytes(customer.pk)),
        "token": default_token_generator.make_token(customer),
        "new_password": "Brand-new-pass-42",
    }
    assert other_api.post("/api/auth/password-reset-confirm", body, format="json").status_code == 400
    assert api.post("/api/auth/password-reset-confirm", body, format="json").status_code == 200


def test_email_links_use_the_agencys_app_address(other_api, django_capture_on_commit_callbacks):
    with schema_context(OTHER_SCHEMA):
        User.objects.create_user(email="o@example.com", password=PASSWORD, full_name="O")
    with django_capture_on_commit_callbacks(execute=True):
        other_api.post("/api/auth/password-reset", {"email": "o@example.com"}, format="json")
    [email] = mail.outbox
    assert f"http://{OTHER_DOMAIN}:8081/reset-password?uid=" in email.body


# The platform host and unknown hosts


def test_root_host_serves_the_platform_admin_and_no_api():
    client = APIClient(HTTP_HOST=ROOT)
    response = client.get("/api/offers")
    assert response.status_code == 404
    assert response.json() == {"detail": "There is no agency at this address.", "code": "no_tenant"}
    assert client.get("/django-admin/").status_code == 302


def test_unknown_host_is_no_tenant():
    response = APIClient(HTTP_HOST="nobody.localhost").get("/api/offers")
    assert response.status_code == 404
    assert response.json()["code"] == "no_tenant"


def test_platform_admin_lists_tenants_and_tenant_hosts_do_not(client):
    with schema_context("public"):
        owner = User.objects.create_superuser(email="owner@platform.test", password=PASSWORD, full_name="Owner")
        client.force_login(owner)
    response = client.get("/django-admin/tenants/tenant/", HTTP_HOST=ROOT)
    assert response.status_code == 200
    assert b"Other Agency" in response.content and b"app_admin" not in response.content
    # The owner's session belongs to the platform: on a tenant host they are signed out.
    assert client.get("/django-admin/").status_code == 302

    # There /django-admin/ is that tenant's support site, without tenants or airports, even for its superusers.
    support = User.objects.create_superuser(email="support@test.test", password=PASSWORD, full_name="Support")
    client.force_login(support)
    assert client.get("/django-admin/").status_code == 200
    assert client.get("/django-admin/bookings/booking/").status_code == 200
    assert client.get("/django-admin/tenants/tenant/").status_code == 404
    assert client.get("/django-admin/airports/airport/").status_code == 404


# Suspension


def test_a_suspended_agency_refuses_the_api(other_api, api):
    suspend(OTHER_SCHEMA)
    response = other_api.get("/api/offers")
    assert response.status_code == 403
    assert response.json() == {"detail": "This agency is not available at the moment.", "code": "tenant_suspended"}
    assert api.get("/api/offers").status_code == 200


def test_a_suspended_agencys_emails_and_scheduled_jobs_are_skipped(make_offer):
    with schema_context(OTHER_SCHEMA):
        customer = User.objects.create_user(email="o@example.com", password=PASSWORD, full_name="O")
        offer = make_offer()
        booking = Booking.objects.create(
            user=customer,
            offer=offer,
            passenger_count=1,
            unit_price=offer.price,
            status=Booking.Status.AVAILABILITY_CONFIRMED,
            payment_deadline=timezone.now() - timedelta(minutes=1),
        )
    suspend(OTHER_SCHEMA)
    assert tasks.expire_unpaid_bookings() == 0
    assert tasks.notify_customer_booking_expired(OTHER_SCHEMA, booking.id) is None
    assert mail.outbox == []
    with schema_context(OTHER_SCHEMA):
        booking.refresh_from_db()
    assert booking.status == Booking.Status.AVAILABILITY_CONFIRMED


# Scheduled jobs


def test_scheduled_jobs_run_in_every_active_agency(make_offer, customer):
    def overdue_booking():
        user = User.objects.filter(email=customer.email).first() or User.objects.create_user(
            email=customer.email, password=PASSWORD, full_name="C"
        )
        offer = make_offer()
        return Booking.objects.create(
            user=user,
            offer=offer,
            passenger_count=1,
            unit_price=offer.price,
            status=Booking.Status.AVAILABILITY_CONFIRMED,
            payment_deadline=timezone.now() - timedelta(minutes=1),
        )

    here = overdue_booking()
    with schema_context(OTHER_SCHEMA):
        there = overdue_booking()
    assert tasks.expire_unpaid_bookings() == 2
    here.refresh_from_db()
    with schema_context(OTHER_SCHEMA):
        there.refresh_from_db()
    assert here.status == there.status == Booking.Status.EXPIRED


def test_an_error_in_one_agency_does_not_stop_the_others(caplog):
    seen = []

    def job():
        seen.append(connection.schema_name)
        if connection.schema_name == OTHER_SCHEMA:
            raise RuntimeError("boom")
        return 1

    assert for_each_tenant(job, "job") == 1
    assert sorted(seen) == sorted([TEST_SCHEMA, OTHER_SCHEMA])
    assert "job failed for tenant other" in caplog.text


# Creating agencies


def test_create_agency_creates_schema_domain_settings_and_admin():
    tenant = services.create_agency(
        slug="acme-travel",
        name="Acme Travel",
        admin_email="Boss@Acme.test",
        admin_password=PASSWORD,
        admin_name="Ada Boss",
    )
    assert tenant.schema_name == "acme_travel"
    assert schema_exists("acme_travel")
    assert tenant.primary_domain == "acme-travel.localhost"
    with schema_context("acme_travel"):
        assert AppSettings.get().admin_notification_email == "boss@acme.test"
        admin = User.objects.get()
        assert (admin.email, admin.role, admin.full_name) == ("boss@acme.test", User.Role.ADMIN, "Ada Boss")
        assert admin.check_password(PASSWORD)
    # Reachable at its domain right away.
    client = APIClient(HTTP_HOST="acme-travel.localhost")
    assert login(client, "boss@acme.test")["user"]["role"] == "admin"


@pytest.mark.parametrize(
    "slug", ["ab", "1acme", "Acme", "acme_travel", "a" * 31, "public", "www", "app-admin", "other", "pg-catalog", "information-schema"]
)
def test_create_agency_rejects_bad_reserved_or_taken_addresses(slug):
    with pytest.raises(ValidationError):
        services.create_agency(
            slug=slug, name="X", admin_email="x@example.com", admin_password=PASSWORD, admin_name="X"
        )
    assert not Tenant.objects.filter(name="X").exists()


def test_create_agency_rejects_a_weak_admin_password():
    with pytest.raises(ValidationError) as exc:
        services.create_agency(
            slug="weak", name="Weak", admin_email="w@example.com", admin_password="123", admin_name="W"
        )
    assert "admin_password" in exc.value.message_dict
    assert not schema_exists("weak")


def test_create_agency_leaves_nothing_behind_on_failure(monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("cannot create the admin")

    monkeypatch.setattr(User.objects, "create_user", fail)
    with pytest.raises(RuntimeError):
        services.create_agency(
            slug="broken", name="Broken", admin_email="b@example.com", admin_password=PASSWORD, admin_name="B"
        )
    assert not Tenant.objects.filter(schema_name="broken").exists()
    assert not Domain.objects.filter(domain="broken.localhost").exists()
    assert not schema_exists("broken")
