"""Plan tags, rich descriptions and the plans pages."""

from datetime import date

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA
from tenants import richtext
from tenants.models import Plan, PlatformSettings, Subscription, Tenant
from tenants.tests.test_billing import plan
from tenants.tests.test_platform import owner, platform  # noqa: F401 (fixtures)

pytestmark = pytest.mark.django_db


# Sanitizing


def test_allowed_formatting_is_kept():
    html = (
        "<h3>Title</h3><h4>Sub</h4><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s><br>line</p>"
        "<ul><li>one</li></ul><ol><li>two</li></ol>"
    )
    assert richtext.sanitize(html) == html


def test_scripts_styles_events_and_unsafe_links_are_removed():
    dirty = (
        '<p style="color:red" onclick="steal()">Hi<script>steal()</script><style>p{}</style></p>'
        '<a href="javascript:alert(1)">bad</a><a href="https://example.com" onmouseover="x()">good</a>'
        '<a href="mailto:sales@example.com">mail</a><img src="x" onerror="x()"><h1>Big</h1><div>block</div>'
    )
    cleaned = richtext.sanitize(dirty)
    for unwanted in ["script", "style", "onclick", "onmouseover", "javascript:", "<img", "onerror", "<h1", "<div"]:
        assert unwanted not in cleaned, unwanted
    assert '<a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a>' in cleaned
    assert '<a href="mailto:sales@example.com" target="_blank" rel="noopener noreferrer">mail</a>' in cleaned
    assert "Big" in cleaned and "block" in cleaned


def test_an_empty_editor_is_an_empty_description():
    assert richtext.sanitize("<p></p>") == ""
    assert richtext.sanitize("  ") == ""


def test_the_api_sanitizes_and_limits_descriptions(platform):
    response = platform.post(
        "/api/platform/plans",
        {"name": "Basic", "kind": "subscription", "monthly_price": "10", "description": "<p>Hi<script>x</script></p>"},
        format="json",
    )
    assert response.status_code == 201 and response.data["description"] == "<p>Hi</p>"
    long = "<p>" + "a" * 5001 + "</p>"
    response = platform.patch(f"/api/platform/plans/{response.data['id']}", {"description": long}, format="json")
    assert response.status_code == 400 and "description" in response.data


# Tags


def test_one_plan_per_tag_and_the_error_names_the_holder(platform):
    first = plan("Starter", tag=Plan.Tag.RECOMMENDED)
    second = plan("Premium")
    response = platform.patch(f"/api/platform/plans/{second.pk}", {"tag": "recommended"}, format="json")
    assert response.status_code == 400 and response.data["tag"] == ["Already used by Starter."]
    assert platform.patch(f"/api/platform/plans/{second.pk}", {"tag": "advanced"}, format="json").data["tag"] == (
        "advanced"
    )
    # A plan keeps its own tag when edited.
    assert platform.patch(f"/api/platform/plans/{first.pk}", {"name": "Starter+"}, format="json").status_code == 200
    response = platform.post(
        "/api/platform/plans",
        {"name": "New", "kind": "subscription", "monthly_price": "5", "tag": "advanced"},
        format="json",
    )
    assert response.status_code == 400 and response.data["tag"] == ["Already used by Premium."]


def test_support_plans_cannot_be_tagged(platform):
    response = platform.post(
        "/api/platform/plans",
        {"name": "Help", "kind": "support", "monthly_price": "5", "tag": "basic"},
        format="json",
    )
    assert response.status_code == 400 and response.data["tag"] == ["Only subscription plans can be tagged."]


def test_deactivating_clears_the_tag(platform):
    tagged = plan("Starter", tag=Plan.Tag.BASIC)
    response = platform.patch(f"/api/platform/plans/{tagged.pk}", {"is_active": False}, format="json")
    assert response.data["tag"] == "" and response.data["is_active"] is False
    # The tag is free for another plan now.
    other = plan("Other")
    assert platform.patch(f"/api/platform/plans/{other.pk}", {"tag": "basic"}, format="json").status_code == 200
    # An inactive plan cannot take a tag.
    response = platform.patch(f"/api/platform/plans/{tagged.pk}", {"tag": "advanced"}, format="json")
    assert response.data["tag"] == ""


# The plans pages


def test_public_plans_are_open_on_the_root_host_and_only_active():
    plan("Starter", tag=Plan.Tag.RECOMMENDED, description="<p>Good</p>")
    plan("Old", is_active=False)
    PlatformSettings.objects.update(billing_contact_email="sales@azaria.test")
    client = APIClient(HTTP_HOST="localhost")
    # A stale token does not matter on a public page.
    client.credentials(HTTP_AUTHORIZATION="Bearer not-a-token")
    response = client.get("/api/platform/public-plans")
    assert response.status_code == 200
    assert response.data["billing_contact_email"] == "sales@azaria.test"
    [row] = response.data["plans"]
    assert set(row) == {"id", "name", "kind", "tag", "description", "monthly_price", "annual_price", "currency"}
    assert (row["name"], row["tag"], row["description"]) == ("Starter", "recommended", "<p>Good</p>")
    assert APIClient().get("/api/platform/public-plans").status_code == 404


def test_agency_plans_show_its_current_plans_to_its_admins_only(customer_api):
    current = plan("Starter")
    plan("Premium")
    tenant = Tenant.objects.get(schema_name=TEST_SCHEMA)
    other = Tenant.objects.get(schema_name=OTHER_SCHEMA)
    Subscription.objects.create(
        tenant=tenant,
        plan=current,
        kind="subscription",
        billing_cycle="monthly",
        started_on=date(2026, 1, 1),
        next_period_start=date(2026, 2, 1),
    )
    Subscription.objects.create(
        tenant=other,
        plan=Plan.objects.get(name="Premium"),
        kind="subscription",
        billing_cycle="monthly",
        started_on=date(2026, 1, 1),
        next_period_start=date(2026, 2, 1),
    )
    admin = User.objects.create_user(email="boss@test.test", password="Str0ng-pass!", full_name="B", role="admin")
    client = APIClient()
    client.force_authenticate(admin)
    data = client.get("/api/admin/plans").data
    assert data["current_plan_ids"] == [str(current.pk)]
    assert {row["name"] for row in data["plans"]} == {"Starter", "Premium"}
    assert customer_api.get("/api/admin/plans").status_code == 403
    assert APIClient().get("/api/admin/plans").status_code == 401
