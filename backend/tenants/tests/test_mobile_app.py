"""The shared mobile app: the agency endpoint, link verification files, app-address links and the welcome email."""

import pytest
from django.core import mail
from django_tenants.utils import schema_context
from rest_framework.test import APIClient

from accounts import tasks
from accounts.models import User
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, html_part
from tenants.models import Tenant

pytestmark = pytest.mark.django_db

ROOT = "localhost"
AASA = "/.well-known/apple-app-site-association"
ASSETLINKS = "/.well-known/assetlinks.json"
REGISTER = {"email": "nia@example.com", "password": "Tr1cky-horse-77", "full_name": "Nia N", "phone": "+254711"}


@pytest.fixture
def app_settings(settings):
    settings.IOS_APP_ID = "ABCDE12345.com.azariabookings.app"
    settings.ANDROID_PACKAGE = "com.azariabookings.app"
    settings.ANDROID_CERT_FINGERPRINTS = ["14:6D:E9", "AA:BB:CC"]
    return settings


@pytest.fixture
def no_app_settings(settings):
    settings.IOS_APP_ID = ""
    settings.ANDROID_PACKAGE = ""
    settings.ANDROID_CERT_FINGERPRINTS = []
    return settings


# GET /api/agency


@pytest.mark.parametrize("host", ["testserver", "test.localhost"])
def test_agency_returns_code_name_and_app_address(host):
    response = APIClient(HTTP_HOST=host).get("/api/agency")
    assert response.status_code == 200
    assert response.json() == {"code": "test", "name": "Test Agency", "app_address": "test.localhost"}


def test_agency_code_keeps_hyphens_of_the_address():
    from tenants import services

    services.create_agency(
        slug="sky-high", name="Sky High", admin_email="a@sky.test", admin_password="Str0ng-pass!", admin_name="A"
    )
    response = APIClient(HTTP_HOST="sky-high.localhost").get("/api/agency")
    assert response.json() == {"code": "sky-high", "name": "Sky High", "app_address": "sky-high.localhost"}


def test_agency_ignores_a_bad_token():
    response = APIClient(HTTP_HOST=OTHER_DOMAIN, HTTP_AUTHORIZATION="Bearer nonsense").get("/api/agency")
    assert response.status_code == 200
    assert response.json()["code"] == "other"


def test_agency_of_a_suspended_agency_is_tenant_suspended():
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(is_active=False)
    response = APIClient(HTTP_HOST=OTHER_DOMAIN).get("/api/agency")
    assert response.status_code == 403
    assert response.json()["code"] == "tenant_suspended"


@pytest.mark.parametrize("host", [ROOT, "nobody.localhost"])
def test_agency_on_the_root_host_or_an_unknown_one_is_no_tenant(host):
    response = APIClient(HTTP_HOST=host).get("/api/agency")
    assert response.status_code == 404
    assert response.json()["code"] == "no_tenant"


# Verification files


@pytest.mark.parametrize("host", ["testserver", OTHER_DOMAIN, ROOT])
def test_verification_files_with_settings(app_settings, host):
    client = APIClient(HTTP_HOST=host)
    aasa = client.get(AASA)
    assert aasa.status_code == 200
    assert aasa["Content-Type"] == "application/json"
    assert aasa.json() == {
        "applinks": {"details": [{"appIDs": ["ABCDE12345.com.azariabookings.app"], "components": [{"/": "*"}]}]}
    }
    links = client.get(ASSETLINKS)
    assert links.status_code == 200
    assert links["Content-Type"] == "application/json"
    assert links.json() == [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": "com.azariabookings.app",
                "sha256_cert_fingerprints": ["14:6D:E9", "AA:BB:CC"],
            },
        }
    ]


@pytest.mark.parametrize("host", ["testserver", ROOT])
def test_verification_files_without_settings_are_404(no_app_settings, host):
    client = APIClient(HTTP_HOST=host)
    assert client.get(AASA).status_code == 404
    assert client.get(ASSETLINKS).status_code == 404


def test_assetlinks_needs_both_the_package_and_a_fingerprint(app_settings):
    app_settings.ANDROID_CERT_FINGERPRINTS = []
    assert APIClient().get(ASSETLINKS).status_code == 404


# Email links


def test_email_links_use_the_app_address_even_with_a_custom_primary_domain(
    api, customer, django_capture_on_commit_callbacks
):
    # The test agency's primary domain is testserver, a custom one.
    with django_capture_on_commit_callbacks(execute=True):
        api.post("/api/auth/password-reset", {"email": customer.email}, format="json")
    [email] = mail.outbox
    assert "http://test.localhost:8081/reset-password?uid=" in email.body
    assert "testserver" not in email.body
    assert "testserver" not in html_part(email)


def test_another_agencys_links_use_its_own_app_address(django_capture_on_commit_callbacks):
    with schema_context(OTHER_SCHEMA):
        user = User.objects.create_user(email="o@example.com", password="Str0ng-pass!", full_name="O")
    tasks.send_password_reset_email(OTHER_SCHEMA, user.pk)
    [email] = mail.outbox
    assert "http://other.localhost:8081/reset-password?uid=" in email.body


# Welcome email


def test_registering_sends_the_welcome_email(api, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        assert api.post("/api/auth/register", REGISTER, format="json").status_code == 201
    [email] = mail.outbox
    assert email.to == ["nia@example.com"]
    assert email.subject == "Welcome to Test Agency"
    assert "Welcome to Test Agency" in email.body
    assert "http://test.localhost:8081\n" in email.body
    assert "http://test.localhost:8081/app" in email.body
    assert "agency code: test" in email.body
    html = html_part(email)
    assert 'href="http://test.localhost:8081/app"' in html
    assert "<strong>test</strong>" in html


def test_no_welcome_email_when_registration_fails(api, customer, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post("/api/auth/register", {**REGISTER, "email": customer.email}, format="json")
    assert response.status_code == 400
    assert mail.outbox == []


def test_no_welcome_email_for_an_inactive_user(customer):
    customer.is_active = False
    customer.save()
    tasks.send_welcome_email(TEST_SCHEMA, customer.pk)
    assert mail.outbox == []


def test_admin_created_customers_get_the_set_password_email_with_the_app_lines(
    admin_api, django_capture_on_commit_callbacks
):
    body = {"email": "made@example.com", "full_name": "Made By Admin", "phone": ""}
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.post("/api/admin/users", body, format="json").status_code == 201
    [email] = mail.outbox
    assert "account is ready" in email.subject
    assert "Welcome to" not in email.subject
    assert "http://test.localhost:8081/app" in email.body
    assert "agency code: test" in email.body
    assert 'href="http://test.localhost:8081/app"' in html_part(email)
