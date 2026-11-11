"""The shared airline list, its seeder, logos and the airline picker API."""

import struct
from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from django_tenants.utils import schema_context
from rest_framework.test import APIRequestFactory

from accounts.models import User
from airlines.management.commands import seed_airlines
from airlines.models import MAX_LOGO_SIZE, Airline, validate_logo
from airlines.serializers import AirlineSerializer
from core.storage import public_storage
from core.tests.helpers import TEST_SCHEMA, direct

pytestmark = pytest.mark.django_db

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF" + struct.pack("<I", 30) + b"WEBPVP8 " + b"\x00" * 22


def upload(name, content, content_type="image/png"):
    return SimpleUploadedFile(name, content, content_type=content_type)


# The seeder


def test_seed_airlines_from_the_openflights_file():
    call_command("seed_airlines")
    count = Airline.objects.count()
    assert count > 800
    kq = Airline.objects.get(iata_code="KQ")
    assert (kq.name, kq.icao_code, kq.country, kq.is_active) == ("Kenya Airways", "KQA", "Kenya", True)
    assert all(len(code) == 2 for code in Airline.objects.values_list("iata_code", flat=True))


def test_seed_airlines_filters_dedupes_and_never_changes_existing_rows(tmp_path, monkeypatch):
    source = tmp_path / "airlines.dat"
    source.write_text(
        "\n".join(
            [
                '1,"Old Name Air",\\N,"AA","","","Kenya","Y"',
                '2,"Better Air","","AA","BTR","","Kenya","Y"',
                '3,"Inactive Air",\\N,"IN","INA","","Kenya","N"',
                '4,"No Code Air",\\N,"-","NCA","","Kenya","Y"',
                '5,"Long Code Air",\\N,"ABC","LCA","","Kenya","Y"',
                '6,"Plain Air",\\N,"PL","\\N","","\\N","Y"',
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(seed_airlines, "SOURCE", source)
    call_command("seed_airlines")
    rows = {a.iata_code: (a.name, a.icao_code, a.country) for a in Airline.objects.all()}
    # One per code, preferring the row with an ICAO code; inactive and bad codes left out.
    assert rows == {"AA": ("Better Air", "BTR", "Kenya"), "PL": ("Plain Air", "", "")}

    # The system owner's corrections survive a re-run.
    Airline.objects.filter(iata_code="AA").update(name="Corrected", is_active=False)
    call_command("seed_airlines")
    aa = Airline.objects.get(iata_code="AA")
    assert (aa.name, aa.is_active) == ("Corrected", False)
    assert Airline.objects.count() == 2


# Logos


@pytest.mark.parametrize(
    ("name", "content"), [("logo.png", PNG), ("logo.JPG", JPEG), ("logo.jpeg", JPEG), ("logo.webp", WEBP)]
)
def test_png_jpeg_and_webp_logos_are_accepted(name, content):
    validate_logo(upload(name, content))


@pytest.mark.parametrize(
    ("name", "content", "message"),
    [
        ("logo.svg", b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "PNG, JPEG or WebP"),
        ("logo.gif", b"GIF89a" + b"\x00" * 20, "PNG, JPEG or WebP"),
        ("logo.png", JPEG, "does not match"),
        ("logo.webp", b"RIFF" + b"\x00" * 4 + b"AVI " + b"\x00" * 20, "does not match"),
        ("logo.png", PNG + b"\x00" * MAX_LOGO_SIZE, "larger than 200 KB"),
    ],
)
def test_other_logos_are_refused(name, content, message):
    with pytest.raises(ValidationError, match=message):
        validate_logo(upload(name, content))


def test_replacing_or_removing_a_logo_deletes_the_old_file(django_capture_on_commit_callbacks):
    airline = Airline.objects.create(iata_code="KQ", name="Kenya Airways", logo=upload("kq.png", PNG))
    first = airline.logo.name
    assert first.startswith("airline_logos/") and first.endswith(".png")
    assert public_storage.exists(first)

    with django_capture_on_commit_callbacks(execute=True):
        airline.logo = upload("kq2.png", PNG)
        airline.save()
    second = airline.logo.name
    assert not public_storage.exists(first)
    assert public_storage.exists(second)

    with django_capture_on_commit_callbacks(execute=True):
        airline.logo = ""
        airline.save()
    assert not public_storage.exists(second)


# The API


def test_offers_return_the_airline_with_an_absolute_logo_url(api, make_offer):
    with_logo = Airline.objects.create(iata_code="KQ", name="Kenya Airways", logo=upload("kq.png", PNG))
    without = Airline.objects.create(iata_code="EK", name="Emirates")
    make_offer(airline=with_logo)
    make_offer(airline=without, departure_date=timezone.localdate() + timedelta(days=40))
    first, second = api.get("/api/offers").data["results"]
    assert first["airline"] == {
        "id": str(with_logo.id),
        "iata_code": "KQ",
        "name": "Kenya Airways",
        "logo_url": f"http://testserver/media/{with_logo.logo.name}",
    }
    assert second["airline"]["logo_url"] is None
    # On another agency's host the URL follows that host.
    request = APIRequestFactory().get("/", HTTP_HOST="acme.localhost")
    assert AirlineSerializer(with_logo, context={"request": request}).data["logo_url"].startswith(
        "http://acme.localhost/media/airline_logos/"
    )


def offer_body(airports, airline, **overrides):
    return {
        "segments": direct("NBO", "LHR", timezone.localdate() + timedelta(days=30)),
        "ticket_class": "economy",
        "price": "500",
        "airline": str(airline.id),
        "valid_until": (timezone.localdate() + timedelta(days=5)).isoformat(),
        **overrides,
    }


def test_offers_are_created_with_an_airline_id(admin_api, airports):
    kq = Airline.objects.create(iata_code="KQ", name="Kenya Airways")
    response = admin_api.post("/api/admin/offers", offer_body(airports, kq), format="json")
    assert response.status_code == 201, response.data
    assert response.data["airline"]["iata_code"] == "KQ"


def test_an_inactive_or_unknown_airline_cannot_be_chosen(admin_api, airports, make_offer):
    gone = Airline.objects.create(iata_code="ZZ", name="Gone Air", is_active=False)
    response = admin_api.post("/api/admin/offers", offer_body(airports, gone), format="json")
    assert response.status_code == 400
    assert response.data["airline"] == ["This airline is no longer active."]
    unknown = {**offer_body(airports, gone), "airline": "00000000-0000-4000-8000-000000000000"}
    assert "airline" in admin_api.post("/api/admin/offers", unknown, format="json").data

    offer = make_offer()
    changed = admin_api.patch(f"/api/admin/offers/{offer.id}", {"airline": str(gone.id)}, format="json")
    assert changed.status_code == 400


def test_an_offer_keeps_an_airline_deactivated_later(admin_api, make_offer):
    offer = make_offer()
    Airline.objects.filter(pk=offer.airline_id).update(is_active=False)
    response = admin_api.patch(
        f"/api/admin/offers/{offer.id}", {"price": "700", "airline": str(offer.airline_id)}, format="json"
    )
    assert response.status_code == 200, response.data


def test_airline_search_for_the_admin(admin_api, api, customer_api):
    Airline.objects.create(iata_code="KQ", icao_code="KQA", name="Kenya Airways")
    Airline.objects.create(iata_code="QK", name="Kenyan Charter Air")
    Airline.objects.create(iata_code="KX", name="Kenya Closed Air", is_active=False)

    def codes(search):
        return [a["iata_code"] for a in admin_api.get("/api/airlines", {"search": search}).data]

    assert codes("kenya") == ["KQ", "QK"]
    assert codes("qk") == ["QK"]
    # An exact code comes first even when other names match too.
    Airline.objects.create(iata_code="AB", name="Qk Fans Airline")
    assert codes("qk")[0] == "QK"
    assert codes("kqa") == ["KQ"]
    assert api.get("/api/airlines").status_code == 401
    assert customer_api.get("/api/airlines").status_code == 403


def test_airline_search_returns_at_most_20(admin_api):
    Airline.objects.bulk_create(Airline(iata_code=f"A{n}", name=f"Air {n}") for n in range(10))
    Airline.objects.bulk_create(Airline(iata_code=f"B{n}", name=f"Air B{n}") for n in range(10))
    Airline.objects.bulk_create(Airline(iata_code=f"C{n}", name=f"Air C{n}") for n in range(10))
    assert len(admin_api.get("/api/airlines", {"search": "air"}).data) == 20


# The platform admin


def test_the_platform_admin_manages_airlines_and_tenant_hosts_do_not(client):
    Airline.objects.create(iata_code="KQ", name="Kenya Airways", logo=upload("kq.png", PNG))
    with schema_context("public"):
        owner = User.objects.create_superuser(email="owner@platform.test", password="Str0ng-pass!", full_name="O")
        client.force_login(owner)
    page = client.get("/django-admin/airlines/airline/", HTTP_HOST="localhost")
    assert page.status_code == 200
    assert b"Kenya Airways" in page.content and b"/media/airline_logos/" in page.content
    assert client.get("/django-admin/airlines/airline/?has_logo=no", HTTP_HOST="localhost").status_code == 200

    with schema_context(TEST_SCHEMA):
        support = User.objects.create_superuser(email="support@test.test", password="Str0ng-pass!", full_name="S")
        client.force_login(support)
    assert client.get("/django-admin/airlines/airline/").status_code == 404
