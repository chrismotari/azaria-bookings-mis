"""The platform API on the root host: the system owner's sign-in and agency management."""

import uuid

import pytest
from django.core import mail
from django_tenants.utils import schema_context, schema_exists
from rest_framework.test import APIClient

from accounts.models import User
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA
from tenants import services
from tenants.models import Domain, Tenant

pytestmark = pytest.mark.django_db

PASSWORD = "Str0ng-pass!"
ROOT = "localhost"


def root_client():
    return APIClient(HTTP_HOST=ROOT)


def platform_user(email="owner@platform.test", **extra):
    with schema_context("public"):
        if extra.pop("superuser", True):
            return User.objects.create_superuser(email=email, password=PASSWORD, full_name="Pat Owner", **extra)
        return User.objects.create_user(email=email, password=PASSWORD, full_name="Pat Owner", **extra)


def login(client, email="owner@platform.test", password=PASSWORD):
    return client.post("/api/platform/login", {"email": email, "password": password}, format="json")


@pytest.fixture
def owner():
    return platform_user()


@pytest.fixture
def platform(owner):
    client = root_client()
    response = login(client)
    assert response.status_code == 200, response.data
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return client


def other_tenant():
    return Tenant.objects.get(schema_name=OTHER_SCHEMA)


# Signing in


def test_a_superuser_signs_in_and_reads_me(owner):
    client = root_client()
    response = login(client, "Owner@Platform.test")
    assert response.status_code == 200
    assert response.data["user"] == {"id": str(owner.id), "email": "owner@platform.test", "full_name": "Pat Owner"}
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    assert client.get("/api/platform/me").data["email"] == "owner@platform.test"
    refreshed = client.post("/api/platform/refresh", {"refresh": response.data["refresh"]}, format="json")
    assert refreshed.status_code == 200 and refreshed.data["access"]


@pytest.mark.parametrize("extra", [{"superuser": False}, {"is_active": False}])
def test_non_superusers_and_inactive_accounts_cannot_sign_in(extra):
    platform_user("someone@platform.test", **extra)
    response = login(root_client(), "someone@platform.test")
    assert response.status_code == 401
    assert response.data["detail"] == "No platform account found with the given credentials."


def test_agency_accounts_cannot_sign_in_to_the_platform():
    # Even an agency's own superuser lives in that agency's schema, not the platform's.
    User.objects.create_superuser(email="support@test.test", password=PASSWORD, full_name="Support")
    User.objects.create_user(email="boss@test.test", password=PASSWORD, full_name="Boss", role=User.Role.ADMIN)
    for email in ["support@test.test", "boss@test.test"]:
        assert login(root_client(), email).status_code == 401


def test_platform_tokens_and_agency_tokens_do_not_cross(platform, owner):
    access = platform._credentials["HTTP_AUTHORIZATION"]
    agency = APIClient()
    agency.credentials(HTTP_AUTHORIZATION=access)
    assert agency.get("/api/auth/me").status_code == 401

    User.objects.create_user(email="boss@test.test", password=PASSWORD, full_name="Boss", role=User.Role.ADMIN)
    tokens = APIClient().post("/api/auth/login", {"email": "boss@test.test", "password": PASSWORD}, format="json")
    client = root_client()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens.data['access']}")
    assert client.get("/api/platform/me").status_code == 401
    assert client.get("/api/platform/tenants").status_code == 401
    assert client.post("/api/platform/refresh", {"refresh": tokens.data["refresh"]}, format="json").status_code == 401


def test_the_platform_api_needs_a_platform_owner():
    client = root_client()
    assert client.get("/api/platform/me").status_code == 401
    assert client.get("/api/platform/tenants").status_code == 401
    assert client.patch(f"/api/platform/tenants/{other_tenant().pk}", {"is_active": False}).status_code == 401
    assert other_tenant().is_active


def test_agency_hosts_have_no_platform_api():
    assert APIClient().post("/api/platform/login", {}, format="json").status_code == 404
    assert APIClient(HTTP_HOST=OTHER_DOMAIN).get("/api/platform/tenants").status_code == 404


def test_other_api_paths_on_the_root_host_still_have_no_agency():
    response = root_client().get("/api/offers")
    assert response.status_code == 404 and response.json()["code"] == "no_tenant"


# Listing


def test_the_list_shows_agencies_but_not_the_platform(platform):
    response = platform.get("/api/platform/tenants")
    assert response.status_code == 200
    rows = {row["slug"]: row for row in response.data["results"]}
    assert set(rows) == {TEST_SCHEMA, OTHER_SCHEMA}
    assert rows[OTHER_SCHEMA]["primary_domain"] == OTHER_DOMAIN
    assert rows[OTHER_SCHEMA]["name"] == "Other Agency" and rows[OTHER_SCHEMA]["is_active"] is True


def test_search_matches_name_address_and_domains(platform):
    tenant = services.create_agency(
        slug="acme-travel", name="Acme Travel", admin_email="a@acme.test", admin_password=PASSWORD, admin_name="A"
    )
    Domain.objects.create(domain="acme.10.0.0.5.nip.io", tenant=tenant, is_primary=False)
    for search in ["acme", "ACME TRAVEL", "acme-travel", "nip.io"]:
        results = platform.get("/api/platform/tenants", {"search": search}).data["results"]
        assert [row["slug"] for row in results] == ["acme-travel"], search
    assert platform.get("/api/platform/tenants", {"search": "nothing"}).data["results"] == []


def test_the_active_filter(platform):
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(is_active=False)
    suspended = platform.get("/api/platform/tenants", {"is_active": "false"}).data["results"]
    active = platform.get("/api/platform/tenants", {"is_active": "true"}).data["results"]
    assert [row["slug"] for row in suspended] == [OTHER_SCHEMA]
    assert [row["slug"] for row in active] == [TEST_SCHEMA]


def test_the_platform_row_cannot_be_opened(platform):
    public = Tenant.objects.get(schema_name="public")
    assert platform.get(f"/api/platform/tenants/{public.pk}").status_code == 404
    assert platform.patch(f"/api/platform/tenants/{public.pk}", {"is_active": False}).status_code == 404


# Creating


def test_creating_an_agency(platform):
    response = platform.post(
        "/api/platform/tenants",
        {
            "name": " Acme Travel ",
            "slug": " Acme-Travel ",
            "admin_name": "Ada Boss",
            "admin_email": "Boss@Acme.test",
            "admin_password": PASSWORD,
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    assert response.data["name"] == "Acme Travel"
    assert response.data["slug"] == "acme-travel"
    assert response.data["domains"] == [
        {"id": response.data["domains"][0]["id"], "domain": "acme-travel.localhost", "is_primary": True}
    ]
    assert schema_exists("acme_travel")
    with schema_context("acme_travel"):
        assert User.objects.get().email == "boss@acme.test"
    # The new agency's admin signs in at its address.
    tokens = APIClient(HTTP_HOST="acme-travel.localhost").post(
        "/api/auth/login", {"email": "boss@acme.test", "password": PASSWORD}, format="json"
    )
    assert tokens.status_code == 200


@pytest.mark.parametrize(
    "changes, field",
    [
        ({"slug": "ab"}, "slug"),
        ({"slug": "www"}, "slug"),
        ({"slug": OTHER_SCHEMA}, "slug"),
        ({"name": "  "}, "name"),
        ({"admin_email": "not-an-email"}, "admin_email"),
        ({"admin_password": "123"}, "admin_password"),
        ({"admin_name": " "}, "admin_name"),
    ],
)
def test_creating_an_agency_reports_errors_on_their_fields(platform, changes, field):
    data = {
        "name": "Bad",
        "slug": "bad-one",
        "admin_name": "B",
        "admin_email": "b@bad.test",
        "admin_password": PASSWORD,
        **changes,
    }
    response = platform.post("/api/platform/tenants", data, format="json")
    assert response.status_code == 400
    assert field in response.data, response.data
    assert not Tenant.objects.filter(name="Bad").exists()
    assert not schema_exists("bad_one")


def test_a_failed_creation_leaves_nothing_behind(platform, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("cannot create the admin")

    monkeypatch.setattr(User.objects, "create_user", fail)
    data = {"name": "Broken", "slug": "broken", "admin_name": "B", "admin_email": "b@b.test", "admin_password": PASSWORD}
    with pytest.raises(RuntimeError):
        platform.post("/api/platform/tenants", data, format="json")
    assert not Tenant.objects.filter(schema_name="broken").exists()
    assert not schema_exists("broken")


# Renaming, suspending and reactivating


def test_renaming_an_agency(platform):
    tenant = other_tenant()
    response = platform.patch(f"/api/platform/tenants/{tenant.pk}", {"name": " Otter Travel "}, format="json")
    assert response.status_code == 200
    assert response.data["name"] == "Otter Travel" and response.data["domains"][0]["domain"] == OTHER_DOMAIN
    assert platform.patch(f"/api/platform/tenants/{tenant.pk}", {"name": ""}, format="json").status_code == 400
    assert platform.delete(f"/api/platform/tenants/{tenant.pk}").status_code == 405


def test_suspending_and_reactivating_an_agency(platform):
    tenant = other_tenant()
    agency = APIClient(HTTP_HOST=OTHER_DOMAIN)
    response = platform.patch(f"/api/platform/tenants/{tenant.pk}", {"is_active": False}, format="json")
    assert response.status_code == 200 and response.data["is_active"] is False
    assert agency.get("/api/offers").json()["code"] == "tenant_suspended"

    platform.patch(f"/api/platform/tenants/{tenant.pk}", {"is_active": True}, format="json")
    assert agency.get("/api/offers").status_code == 200


# Domains


def test_adding_and_removing_a_domain(platform):
    tenant = other_tenant()
    url = f"/api/platform/tenants/{tenant.pk}/domains"
    response = platform.post(url, {"domain": " Otter.LOCALHOST. "}, format="json")
    assert response.status_code == 201
    assert response.data["domain"] == "otter.localhost" and response.data["is_primary"] is False
    # The agency answers at its new hostname straight away (a hostname ALLOWED_HOSTS accepts).
    assert APIClient(HTTP_HOST="otter.localhost").get("/api/offers").status_code == 200

    assert platform.delete(f"{url}/{response.data['id']}").status_code == 204
    assert not Domain.objects.filter(domain="otter.localhost").exists()


@pytest.mark.parametrize("domain", ["testserver.localhost", OTHER_DOMAIN, ROOT, "not a host", "-bad-.localhost"])
def test_domains_in_use_or_invalid_are_refused(platform, domain):
    Domain.objects.create(domain="testserver.localhost", tenant=Tenant.objects.get(schema_name=TEST_SCHEMA))
    response = platform.post(f"/api/platform/tenants/{other_tenant().pk}/domains", {"domain": domain}, format="json")
    assert response.status_code == 400
    message = "Enter a valid hostname" if " " in domain or "-bad-" in domain else "This domain is already in use."
    assert response.data["domain"][0].startswith(message), response.data


def test_the_primary_domain_cannot_be_removed(platform):
    tenant = other_tenant()
    primary = tenant.domains.get(is_primary=True)
    response = platform.delete(f"/api/platform/tenants/{tenant.pk}/domains/{primary.pk}")
    assert response.status_code == 409
    assert Domain.objects.filter(pk=primary.pk).exists()


def test_making_a_domain_primary(platform):
    tenant = other_tenant()
    old = tenant.domains.get(is_primary=True)
    new = Domain.objects.create(domain="other.10.0.0.5.nip.io", tenant=tenant, is_primary=False)
    response = platform.post(f"/api/platform/tenants/{tenant.pk}/domains/{new.pk}/make-primary")
    assert response.status_code == 200 and response.data["is_primary"] is True
    assert tenant.primary_domain == "other.10.0.0.5.nip.io"
    old.refresh_from_db()
    assert old.is_primary is False
    # The old primary can be removed now.
    assert platform.delete(f"/api/platform/tenants/{tenant.pk}/domains/{old.pk}").status_code == 204


def test_another_agencys_domain_cannot_be_changed_through_this_one(platform):
    test_tenant = Tenant.objects.get(schema_name=TEST_SCHEMA)
    other_primary = other_tenant().domains.get(is_primary=True)
    url = f"/api/platform/tenants/{test_tenant.pk}/domains/{other_primary.pk}"
    assert platform.delete(url).status_code == 404
    assert platform.post(f"{url}/make-primary").status_code == 404


def test_agency_and_domain_ids_are_uuids(platform):
    row = platform.get("/api/platform/tenants").data["results"][0]
    assert uuid.UUID(str(row["id"]))
    detail = platform.get(f"/api/platform/tenants/{row['id']}").data
    assert uuid.UUID(str(detail["domains"][0]["id"]))
    # Numbers and malformed ids are not found; a malformed invoice filter is an empty list.
    assert platform.get("/api/platform/tenants/1").status_code == 404
    assert platform.get("/api/platform/tenants/not-a-uuid").status_code == 404
    assert platform.get("/api/platform/invoices", {"tenant": "12"}).data["results"] == []


# An agency's admins


def agency_id(schema=TEST_SCHEMA):
    return Tenant.objects.get(schema_name=schema).pk


def test_the_owner_lists_an_agencys_admins_only(admin_user, customer, platform):
    response = platform.get(f"/api/platform/tenants/{agency_id()}/admins")
    assert response.status_code == 200
    assert response.data == [
        {
            "id": str(admin_user.id),
            "email": "owner@example.com",
            "full_name": "Owner",
            "phone": "",
            "is_active": True,
            "last_login": None,
        }
    ]
    # The other agency's admins are its own.
    assert platform.get(f"/api/platform/tenants/{agency_id(OTHER_SCHEMA)}/admins").data == []


def test_suspending_and_restoring_an_admin(admin_user, platform):
    agency = APIClient()
    tokens = agency.post("/api/auth/login", {"email": admin_user.email, "password": PASSWORD}, format="json").data
    url = f"/api/platform/tenants/{agency_id()}/admins/{admin_user.id}"
    # Only is_active changes.
    response = platform.patch(url, {"is_active": False, "full_name": "Renamed", "role": "customer"}, format="json")
    assert response.status_code == 200 and response.data["is_active"] is False
    with schema_context(TEST_SCHEMA):
        admin_user.refresh_from_db()
    assert (admin_user.is_active, admin_user.full_name, admin_user.role) == (False, "Owner", User.Role.ADMIN)
    # Suspended: no sign-in, and the tokens it holds are refused.
    agency.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    assert agency.get("/api/auth/me").status_code == 401
    agency.credentials()
    assert agency.post("/api/auth/refresh", {"refresh": tokens["refresh"]}, format="json").status_code == 401
    assert agency.post("/api/auth/login", {"email": admin_user.email, "password": PASSWORD}, format="json").status_code == 401

    assert platform.patch(url, {"is_active": True}, format="json").data["is_active"] is True
    assert agency.post("/api/auth/login", {"email": admin_user.email, "password": PASSWORD}, format="json").status_code == 200


def test_customers_and_other_agencies_admins_cannot_be_changed_here(customer, platform):
    with schema_context(OTHER_SCHEMA):
        other = User.objects.create_user(email="boss@other.test", full_name="Boss", role=User.Role.ADMIN)
    for tenant, user in [(agency_id(), customer), (agency_id(), other)]:
        base = f"/api/platform/tenants/{tenant}/admins/{user.id}"
        assert platform.patch(base, {"is_active": False}, format="json").status_code == 404
        assert platform.post(f"{base}/password-reset").status_code == 404
    with schema_context(TEST_SCHEMA):
        customer.refresh_from_db()
    assert customer.is_active


def test_sending_an_admin_a_reset_link(admin_user, platform, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = platform.post(f"/api/platform/tenants/{agency_id()}/admins/{admin_user.id}/password-reset")
    assert response.status_code == 200
    assert response.data["detail"] == "A reset link has been sent to owner@example.com."
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["owner@example.com"]
    link = next(line for line in mail.outbox[0].body.splitlines() if "/reset-password?" in line)
    assert link.strip().startswith("http://test.localhost:8081/reset-password?uid=")


def test_no_reset_link_for_a_suspended_admin_or_agency(admin_user, platform, django_capture_on_commit_callbacks):
    url = f"/api/platform/tenants/{agency_id()}/admins/{admin_user.id}/password-reset"
    with schema_context(TEST_SCHEMA):
        User.objects.filter(pk=admin_user.pk).update(is_active=False)
    with django_capture_on_commit_callbacks(execute=True):
        assert platform.post(url).status_code == 409
    with schema_context(TEST_SCHEMA):
        User.objects.filter(pk=admin_user.pk).update(is_active=True)
    Tenant.objects.filter(schema_name=TEST_SCHEMA).update(is_active=False)
    with django_capture_on_commit_callbacks(execute=True):
        assert platform.post(url).status_code == 409
    assert mail.outbox == []


def test_agency_admins_need_the_platform_owner(admin_user):
    client = root_client()
    base = f"/api/platform/tenants/{agency_id()}/admins"
    assert client.get(base).status_code == 401
    assert client.post(f"{base}/{admin_user.id}/password-reset").status_code == 401
