"""Agency themes: the starting themes, contrast rules, the default, choosing a theme, the APIs and the emails."""

import pytest
from django.core import mail
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django_tenants.utils import schema_context
from rest_framework.test import APIClient

from accounts import tasks as account_tasks
from accounts.models import User
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, html_part
from tenants import services, themes
from tenants import tasks as tenant_tasks
from tenants.models import Tenant, Theme
from tenants.tests.test_platform import owner, platform, root_client  # noqa: F401 (fixtures)

pytestmark = pytest.mark.django_db

STARTING = {
    "Indigo & Amber": ("#1800d2", "#ffb400"),
    "Navy & Gold": ("#1b3a6b", "#f2c14e"),
    "Teal & Coral": ("#00676b", "#ff9a7a"),
    "Forest & Lime": ("#1e5631", "#a4de02"),
    "Burgundy & Sand": ("#7b1e3a", "#f4d58d"),
    "Plum & Peach": ("#5b2a86", "#ffb38a"),
    "Charcoal & Sky": ("#2b2d42", "#8ecae6"),
    "Ocean & Sunflower": ("#0057b8", "#ffd100"),
}
NEW = {"name": "Pine & Honey", "primary": "#1F4D3A", "accent": "#F5C26B"}


def theme(name):
    return Theme.objects.get(name=name)


def tenant(schema=TEST_SCHEMA):
    return Tenant.objects.get(schema_name=schema)


def inactive_theme():
    return Theme.objects.create(name="Old", primary="#1b3a6b", accent="#f2c14e", is_active=False)


# The starting themes


def test_the_migration_creates_eight_themes_that_pass_every_rule():
    assert {t.name: (t.primary, t.accent) for t in Theme.objects.all()} == STARTING
    for starting in Theme.objects.all():
        assert starting.is_active
        assert themes.primary_problems(starting.primary) == []
        assert themes.accent_problems(starting.accent) == []
        assert themes.accent_on_bar_problems(starting.accent, starting.primary) == []


def test_indigo_and_amber_is_the_one_default_and_every_agency_has_it():
    assert list(Theme.objects.filter(is_default=True).values_list("name", flat=True)) == ["Indigo & Amber"]
    # The session's agencies were created after the migration with the default, as existing ones got it.
    assert set(Tenant.objects.values_list("theme__name", flat=True)) == {"Indigo & Amber"}


def test_colours_are_derived_from_primary_and_accent():
    assert theme("Indigo & Amber").colors == {
        "primary": "#1800d2",
        "primary_text": "#ffffff",
        "primary_tint": "#eae8fb",
        "primary_hover": "#341fd7",
        "bar": "#1800d2",
        "bar_text": "#ffffff",
        "bar_hover": "#341fd7",
        "accent": "#ffb400",
        "accent_text": "#252525",
    }


# Contrast rules


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        ({"primary": "#4d7cff"}, "primary", "White text on this primary is 3.7:1; it needs 4.5:1."),
        # White text passes on this one (4.5:1), but it is too close to its tint and to the page background.
        ({"primary": "#767676"}, "primary", "This primary on its tint is 4.0:1; it needs 4.5:1."),
        ({"primary": "#767676"}, "primary", "This primary on the page background is 4.1:1; it needs 4.5:1."),
        ({"primary": "#686868"}, "primary", "White text on this primary's hover shade is 4.2:1; it needs 4.5:1."),
        ({"accent": "#7a5c00"}, "accent", "Dark text on this accent is 2.4:1; it needs 4.5:1."),
        # Readable with dark text, but too close to the primary for a button edge to show.
        ({"primary": "#00676b", "accent": "#ff8a65"}, "accent", "This accent on the primary is 2.8:1; it needs 3:1."),
    ],
)
def test_every_contrast_rule_refuses_a_failing_colour_on_create_and_on_change(platform, changes, field, message):
    response = platform.post("/api/platform/themes", {**NEW, **changes}, format="json")
    assert response.status_code == 400
    assert message in response.data[field]
    assert not Theme.objects.filter(name=NEW["name"]).exists()

    navy = theme("Navy & Gold")
    response = platform.patch(f"/api/platform/themes/{navy.pk}", changes, format="json")
    assert response.status_code == 400
    assert message in response.data[field]
    navy.refresh_from_db()
    assert (navy.primary, navy.accent) == STARTING["Navy & Gold"]


def test_a_primary_can_fail_only_the_tint_and_background_rules():
    # White text passes at 4.5:1 or more, but the primary is too close to its own tint and the page background.
    assert themes.contrast("#ffffff", "#767676") >= 4.5
    assert [problem.split(" is ")[0] for problem in themes.primary_problems("#767676")] == [
        "White text on this primary's hover shade",
        "This primary on its tint",
        "This primary on the page background",
    ]


def test_a_primary_can_fail_only_the_hover_shade_rule():
    # White passes on the primary itself, but the lighter hover shade under the heading cards' labels is too pale.
    assert themes.contrast("#ffffff", "#686868") >= 4.5
    assert themes.primary_problems("#686868") == ["White text on this primary's hover shade is 4.2:1; it needs 4.5:1."]


# Bar and text colours

NAVY = "#1b3a6b"


@pytest.mark.parametrize(
    ("bar", "text", "hover"),
    [
        ("#ffd100", "#252525", themes.blend("#252525", 0.10, over="#ffd100")),
        ("#f8c8dc", "#252525", themes.blend("#252525", 0.10, over="#f8c8dc")),
        ("#ffffff", "#252525", themes.blend("#252525", 0.10, over="#ffffff")),
        ("#7b1e3a", "#ffffff", themes.blend("#ffffff", 0.12, over="#7b1e3a")),
    ],
)
def test_a_bar_gets_white_or_dark_text_and_a_hover_shade_that_follows_it(bar, text, hover):
    colors = themes.derived_colors(NAVY, "#f2c14e", bar=bar)
    assert (colors["bar"], colors["bar_text"], colors["bar_hover"]) == (bar, text, hover)
    assert (colors["primary"], colors["primary_text"]) == (NAVY, "#ffffff")


def test_the_automatic_bar_text_flips_at_the_4_5_edge():
    # #767676 is the lightest grey white still reaches 4.5:1 on; one step lighter takes dark text.
    assert themes.auto_text("#767676") == "#ffffff"
    assert themes.auto_text("#777777") == "#252525"


def test_without_a_bar_the_bar_colours_are_the_primarys():
    colors = theme("Navy & Gold").colors
    assert (colors["bar"], colors["bar_text"], colors["bar_hover"]) == (
        colors["primary"],
        colors["primary_text"],
        colors["primary_hover"],
    )


def test_chosen_text_colours_are_returned_and_move_the_hover_shade(platform):
    body = {
        **NEW,
        "primary": NAVY,
        "primary_text": "#FFF8E7",
        "bar": "#FFD100",
        "bar_text": "#1B3A6B",
        "accent": "#1E5631",
        "accent_text": "#FFFFFF",
    }
    response = platform.post("/api/platform/themes", body, format="json")
    assert response.status_code == 201, response.data
    colors = response.data["colors"]
    assert colors["primary_text"] == "#fff8e7"
    assert colors["primary_hover"] == themes.blend("#ffffff", 0.12, over=NAVY)
    assert (colors["bar"], colors["bar_text"]) == ("#ffd100", "#1b3a6b")
    assert colors["bar_hover"] == themes.blend("#252525", 0.10, over="#ffd100")
    assert (colors["accent"], colors["accent_text"]) == ("#1e5631", "#ffffff")
    assert APIClient().get("/api/agency").data["theme"]["colors"]["bar"] == "#1800d2"
    created = theme("Pine & Honey")
    assert (created.bar, created.primary_text, created.bar_text, created.accent_text) == (
        "#ffd100",
        "#fff8e7",
        "#1b3a6b",
        "#ffffff",
    )
    # Blank goes back to automatic.
    response = platform.patch(f"/api/platform/themes/{created.pk}", {"bar_text": ""}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["colors"]["bar_text"] == "#252525"
    # Without the bar, the dark green accent would sit on the navy primary.
    response = platform.patch(f"/api/platform/themes/{created.pk}", {"bar": ""}, format="json")
    assert response.status_code == 400
    assert "This accent on the primary is 1.3:1; it needs 3:1." in response.data["accent"]


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        (
            {"primary": NAVY, "primary_text": "#252525"},
            "primary_text",
            "Dark text on this primary is 1.3:1; it needs 4.5:1.",
        ),
        # Readable on the primary, but not on its lighter hover shade.
        (
            {"primary": NAVY, "primary_text": "#b8c4d6"},
            "primary_text",
            "This text colour on this primary's hover shade is 4.4:1; it needs 4.5:1.",
        ),
        # Mid grey: white and dark text both fall short, so the automatic text cannot pass.
        ({"bar": "#808080"}, "bar", "Text on this bar colour is 3.8:1; it needs 4.5:1."),
        ({"bar": "#ffd100", "bar_text": "#ffffff"}, "bar_text", "Text on this bar colour is 1.4:1; it needs 4.5:1."),
        (
            {"bar": "#ffffff", "bar_text": "#6c7171"},
            "bar_text",
            "Text on this bar colour's hover shade is 4.0:1; it needs 4.5:1.",
        ),
        ({"bar_text": "#252525"}, "bar_text", "Choose a bar colour for this text colour."),
        ({"bar": "#ffd100", "accent": "#f2c14e"}, "accent", "This accent on the bar colour is 1.1:1; it needs 3:1."),
        (
            {"accent": "#f2c14e", "accent_text": "#ffffff"},
            "accent_text",
            "White text on this accent is 1.6:1; it needs 4.5:1.",
        ),
    ],
)
def test_bar_and_text_colour_rules_refuse_with_their_ratio(platform, changes, field, message):
    response = platform.post("/api/platform/themes", {**NEW, **changes}, format="json")
    assert response.status_code == 400
    assert message in response.data[field]
    navy = theme("Navy & Gold")
    response = platform.patch(f"/api/platform/themes/{navy.pk}", changes, format="json")
    assert response.status_code == 400
    assert message in response.data[field]


def test_the_accent_on_the_bar_passes_at_3_to_1():
    assert themes.accent_on_bar_problems("#ff9a7a", "#00676b") == []
    assert themes.accent_on_bar_problems("#ff8a65", "#00676b") == ["This accent on the primary is 2.8:1; it needs 3:1."]
    # With a bar, the accent is checked against the bar, not the primary.
    assert themes.accent_on_bar_problems("#ff8a65", "#00676b", bar="#1b3a6b") == []


def test_a_light_text_colour_on_a_dark_accent_is_accepted(platform):
    response = platform.post(
        "/api/platform/themes", {**NEW, "bar": "#ffd100", "accent": "#1e5631", "accent_text": "#ffffff"}, format="json"
    )
    assert response.status_code == 201, response.data


@pytest.mark.parametrize("color", ["1b3a6b", "#1b3a6", "#gggggg", "navy"])
def test_colours_must_be_hex(platform, color):
    response = platform.post("/api/platform/themes", {**NEW, "primary": color}, format="json")
    assert response.status_code == 400
    assert response.data["primary"] == ["Enter a colour as #rrggbb."]


# Platform themes API


def test_the_owner_lists_themes_with_inactive_ones_default_first(platform):
    inactive_theme()
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(theme=theme("Teal & Coral"))
    response = platform.get("/api/platform/themes")
    assert response.status_code == 200
    names = [row["name"] for row in response.data]
    assert names[0] == "Indigo & Amber" and names[1:] == sorted(names[1:]) and "Old" in names
    rows = {row["name"]: row for row in response.data}
    # The platform's own row is not an agency.
    assert rows["Indigo & Amber"]["agency_count"] == 1
    assert rows["Teal & Coral"]["agency_count"] == 1
    assert rows["Old"]["is_active"] is False
    assert set(rows["Indigo & Amber"]) == {
        "id",
        "name",
        "colors",
        "primary",
        "accent",
        "bar",
        "primary_text",
        "bar_text",
        "accent_text",
        "is_active",
        "is_default",
        "agency_count",
    }


def test_creating_a_theme_stores_lowercase_colours_and_derives_the_rest(platform):
    response = platform.post("/api/platform/themes", NEW, format="json")
    assert response.status_code == 201, response.data
    created = theme("Pine & Honey")
    assert (created.primary, created.accent, created.is_active, created.is_default) == (
        "#1f4d3a",
        "#f5c26b",
        True,
        False,
    )
    assert response.data["colors"] == {
        "primary": "#1f4d3a",
        "primary_text": "#ffffff",
        "primary_tint": themes.blend("#1f4d3a", 0.09),
        "primary_hover": themes.blend("#ffffff", 0.12, over="#1f4d3a"),
        "bar": "#1f4d3a",
        "bar_text": "#ffffff",
        "bar_hover": themes.blend("#ffffff", 0.12, over="#1f4d3a"),
        "accent": "#f5c26b",
        "accent_text": "#252525",
    }
    assert response.data["agency_count"] == 0


def test_theme_names_are_unique_and_at_most_40_characters(platform):
    response = platform.post("/api/platform/themes", {**NEW, "name": "navy & gold"}, format="json")
    assert response.status_code == 400
    assert response.data["name"] == ["A theme with this name already exists."]
    response = platform.post("/api/platform/themes", {**NEW, "name": "x" * 41}, format="json")
    assert response.status_code == 400


def test_editing_a_theme_changes_every_agency_using_it(platform):
    indigo = theme("Indigo & Amber")
    response = platform.patch(
        f"/api/platform/themes/{indigo.pk}", {"name": "Indigo", "primary": "#2A1AB0"}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["colors"]["primary"] == "#2a1ab0"
    assert APIClient().get("/api/agency").data["theme"]["colors"]["primary"] == "#2a1ab0"


def test_make_default_moves_it(platform):
    navy = theme("Navy & Gold")
    response = platform.post(f"/api/platform/themes/{navy.pk}/make-default")
    assert response.status_code == 200
    assert response.data["is_default"] is True
    assert list(Theme.objects.filter(is_default=True)) == [navy]


def test_the_default_cannot_be_deactivated_and_an_inactive_theme_cannot_be_made_default(platform):
    indigo = theme("Indigo & Amber")
    response = platform.patch(f"/api/platform/themes/{indigo.pk}", {"is_active": False}, format="json")
    assert response.status_code == 400
    assert response.data["is_active"] == ["The default theme cannot be deactivated."]
    old = inactive_theme()
    response = platform.post(f"/api/platform/themes/{old.pk}/make-default")
    assert response.status_code == 409
    assert Theme.default() == indigo


def test_deactivating_and_activating_a_theme(platform):
    navy = theme("Navy & Gold")
    assert (
        platform.patch(f"/api/platform/themes/{navy.pk}", {"is_active": False}, format="json").data["is_active"]
        is False
    )
    assert platform.patch(f"/api/platform/themes/{navy.pk}", {"is_active": True}, format="json").data["is_active"]


def test_themes_are_never_deleted(platform):
    navy = theme("Navy & Gold")
    assert platform.delete(f"/api/platform/themes/{navy.pk}").status_code == 405


def test_the_platform_themes_api_needs_the_owner(admin_user):
    client = root_client()
    assert client.get("/api/platform/themes").status_code == 401
    # An agency admin's token is not a platform token.
    client.force_authenticate(admin_user)
    assert client.get("/api/platform/themes").status_code == 403
    assert APIClient().get("/api/platform/themes").status_code == 404


# An agency's theme: create_agency, the command, the platform tenants API


def test_create_agency_takes_the_default_theme_or_the_one_given():
    first = services.create_agency(
        slug="sky", name="Sky", admin_email="a@sky.test", admin_password="Str0ng-pass!", admin_name="A"
    )
    assert first.theme == Theme.default()
    second = services.create_agency(
        slug="sea",
        name="Sea",
        admin_email="a@sea.test",
        admin_password="Str0ng-pass!",
        admin_name="A",
        theme=theme("Teal & Coral"),
    )
    assert second.theme.name == "Teal & Coral"


def test_create_agency_refuses_an_inactive_theme():
    with pytest.raises(ValidationError) as error:
        services.create_agency(
            slug="sky",
            name="Sky",
            admin_email="a@sky.test",
            admin_password="Str0ng-pass!",
            admin_name="A",
            theme=inactive_theme(),
        )
    assert error.value.message_dict == {"theme": ["Choose an active theme."]}
    assert not Tenant.objects.filter(schema_name="sky").exists()


def test_the_command_with_and_without_a_theme():
    args = ["--admin-email", "a@x.test", "--admin-password", "Str0ng-pass!", "--admin-name", "A"]
    call_command("create_agency", "--schema", "plain", "--name", "Plain", *args)
    assert tenant("plain").theme == Theme.default()
    call_command("create_agency", "--schema", "plum", "--name", "Plum", "--theme", "Plum & Peach", *args)
    assert tenant("plum").theme.name == "Plum & Peach"
    with pytest.raises(CommandError, match="There is no theme named Nope."):
        call_command("create_agency", "--schema", "nope", "--name", "Nope", "--theme", "Nope", *args)


def test_the_platform_creates_an_agency_with_a_theme(platform):
    body = {
        "name": "Sky",
        "slug": "sky",
        "admin_name": "A",
        "admin_email": "a@sky.test",
        "admin_password": "Str0ng-pass!",
    }
    response = platform.post("/api/platform/tenants", {**body, "theme": str(inactive_theme().pk)}, format="json")
    assert response.status_code == 400
    assert response.data["theme"] == ["Choose an active theme."]
    teal = theme("Teal & Coral")
    response = platform.post("/api/platform/tenants", {**body, "theme": str(teal.pk)}, format="json")
    assert response.status_code == 201, response.data
    assert response.json()["theme"] == str(teal.pk)
    response = platform.post(
        "/api/platform/tenants", {**body, "slug": "sea", "admin_email": "a@sea.test"}, format="json"
    )
    assert response.json()["theme"] == str(Theme.default().pk)


def test_the_platform_changes_an_agencys_theme(platform):
    other = tenant(OTHER_SCHEMA)
    url = f"/api/platform/tenants/{other.pk}"
    assert platform.get(url).json()["theme"] == str(Theme.default().pk)
    old = inactive_theme()
    assert platform.patch(url, {"theme": str(old.pk)}, format="json").status_code == 400
    # An agency already on an inactive theme keeps it.
    Tenant.objects.filter(pk=other.pk).update(theme=old)
    assert platform.patch(url, {"theme": str(old.pk), "name": "Other"}, format="json").status_code == 200
    navy = theme("Navy & Gold")
    response = platform.patch(url, {"theme": str(navy.pk)}, format="json")
    assert response.status_code == 200
    assert response.json()["theme"] == str(navy.pk)
    assert tenant(OTHER_SCHEMA).theme == navy


# The agency's own API


def test_agency_endpoint_returns_the_agencys_theme():
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(theme=theme("Navy & Gold"))
    body = APIClient(HTTP_HOST=OTHER_DOMAIN).get("/api/agency").json()
    assert body["theme"]["name"] == "Navy & Gold"
    assert body["theme"]["colors"] == theme("Navy & Gold").colors


def test_admins_list_the_active_themes_default_first(admin_api, customer_api):
    inactive_theme()
    response = admin_api.get("/api/admin/themes")
    assert response.status_code == 200
    names = [row["name"] for row in response.data]
    assert names[0] == "Indigo & Amber" and names[1:] == sorted(names[1:]) and "Old" not in names
    assert set(response.data[0]) == {"id", "name", "colors"}
    assert customer_api.get("/api/admin/themes").status_code == 403
    assert APIClient().get("/api/admin/themes").status_code == 401


def test_an_admin_changes_only_their_own_agencys_theme(admin_api):
    teal = theme("Teal & Coral")
    response = admin_api.patch("/api/admin/settings", {"theme": str(teal.pk)}, format="json")
    assert response.status_code == 200
    assert response.data["theme"] == str(teal.pk)
    assert tenant().theme == teal
    assert tenant(OTHER_SCHEMA).theme == Theme.default()
    assert admin_api.get("/api/admin/settings").data["theme"] == str(teal.pk)


def test_an_admin_cannot_choose_an_inactive_theme_but_keeps_one_they_have(admin_api):
    old = inactive_theme()
    response = admin_api.patch("/api/admin/settings", {"theme": str(old.pk)}, format="json")
    assert response.status_code == 400
    assert response.data["theme"] == ["Choose an active theme."]
    Tenant.objects.filter(schema_name=TEST_SCHEMA).update(theme=old)
    response = admin_api.patch("/api/admin/settings", {"theme": str(old.pk)}, format="json")
    assert response.status_code == 200


def test_customers_cannot_change_the_theme(customer_api):
    teal = theme("Teal & Coral")
    assert customer_api.patch("/api/admin/settings", {"theme": str(teal.pk)}, format="json").status_code == 403
    assert tenant().theme == Theme.default()


# Emails


def test_agency_emails_use_the_agencys_colours():
    navy = theme("Navy & Gold")
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(theme=navy)
    with schema_context(OTHER_SCHEMA):
        user = User.objects.create_user(email="nia@example.com", password="Str0ng-pass!", full_name="Nia")
    account_tasks.send_welcome_email(OTHER_SCHEMA, user.pk)
    html = html_part(mail.outbox[-1])
    colors = navy.colors
    assert f"background-color:{colors['primary']}" in html
    assert f"background-color:{colors['accent']}" in html
    assert "#1800d2" not in html and "#ffb400" not in html


def test_the_email_header_uses_the_bar():
    navy = theme("Navy & Gold")
    Theme.objects.filter(pk=navy.pk).update(bar="#ffd100")
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(theme=navy)
    with schema_context(OTHER_SCHEMA):
        user = User.objects.create_user(email="ama@example.com", password="Str0ng-pass!", full_name="Ama")
    account_tasks.send_welcome_email(OTHER_SCHEMA, user.pk)
    html = html_part(mail.outbox[-1])
    assert "background-color:#ffd100; color:#252525;" in html


def test_platform_emails_use_azarias_colours():
    other = tenant(OTHER_SCHEMA)
    Tenant.objects.filter(pk=other.pk).update(
        theme=theme("Navy & Gold"),
        is_active=False,
        suspension_reason=Tenant.SuspensionReason.NON_PAYMENT,
        billing_email="billing@other.test",
    )
    tenant_tasks.notify_tenant_suspended_non_payment(other.pk)
    html = html_part(mail.outbox[-1])
    assert "background-color:#1800d2" in html
    assert "#1b3a6b" not in html


def test_theme_ids_are_uuids():
    import uuid

    assert all(isinstance(pk, uuid.UUID) for pk in Theme.objects.values_list("pk", flat=True))


# /django-admin/


def test_django_admin_lists_themes_read_only_and_offers_active_themes_for_an_agency(client):
    with schema_context("public"):
        owner = User.objects.create_superuser(email="owner@platform.test", password="Str0ng-pass!", full_name="O")
        client.force_login(owner)
    old = inactive_theme()
    response = client.get("/django-admin/tenants/theme/", HTTP_HOST="localhost")
    assert response.status_code == 200
    assert b"Navy &amp; Gold" in response.content
    assert client.get("/django-admin/tenants/theme/add/", HTTP_HOST="localhost").status_code == 403
    navy = theme("Navy & Gold")
    response = client.post(f"/django-admin/tenants/theme/{navy.pk}/change/", {"name": "X"}, HTTP_HOST="localhost")
    assert response.status_code == 403

    other = tenant(OTHER_SCHEMA)
    page = client.get(f"/django-admin/tenants/tenant/{other.pk}/change/", HTTP_HOST="localhost").content.decode()
    assert "Navy &amp; Gold" in page and ">Old<" not in page
    Tenant.objects.filter(pk=other.pk).update(theme=old)
    page = client.get(f"/django-admin/tenants/tenant/{other.pk}/change/", HTTP_HOST="localhost").content.decode()
    assert ">Old<" in page
