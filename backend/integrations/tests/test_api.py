"""The admin API: integrations, routes, fares and publishing; permissions and isolation between agencies."""

from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
from django_tenants.utils import schema_context
from rest_framework.test import APIClient

from accounts.models import User
from catalog.models import Offer
from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA
from integrations.models import Fare, Integration, Route
from tenants.models import Tenant

from .conftest import TODAY, recorded, set_window

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)


@pytest.fixture
def searched(admin_api, route, integration, duffel_api, exchange_rates, django_capture_on_commit_callbacks):
    """The route searched for 1 December: a USD direct fare (650) and a GBP connecting one (576.58 USD, picked)."""
    set_window(route, DEC_1, DEC_1)
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(f"/api/admin/routes/{route.id}/search")
    assert response.status_code == 201
    return {fare.net_currency: fare for fare in Fare.objects.all()}


def publish(admin_api, fare, **body):
    data = {"price": "699.00", "valid_until": (TODAY + timedelta(days=7)).isoformat(), "is_public": True, **body}
    return admin_api.post(f"/api/admin/fares/{fare.id}/publish", data, format="json")


# Integrations


def test_credentials_are_encrypted_at_rest_and_never_returned(admin_api):
    response = admin_api.post(
        "/api/admin/integrations",
        {"provider": "duffel", "name": "Duffel", "mode": "test", "credentials": {"access_token": "duffel_test_abc123"}},
        format="json",
    )
    assert response.status_code == 201
    assert "credentials" not in response.data
    integration = Integration.objects.get()
    assert "duffel_test_abc123" not in integration.credentials
    assert integration.get_credentials() == {"access_token": "duffel_test_abc123"}
    listed = admin_api.get("/api/admin/integrations").data
    assert [item["name"] for item in listed] == ["Duffel"] and "credentials" not in listed[0]
    assert "credentials" not in admin_api.get(f"/api/admin/integrations/{integration.id}").data


def test_creating_needs_the_providers_credentials(admin_api):
    response = admin_api.post(
        "/api/admin/integrations", {"provider": "duffel", "name": "Duffel", "credentials": {}}, format="json"
    )
    assert response.status_code == 400 and response.data["credentials"] == ["Enter the access token."]
    response = admin_api.post("/api/admin/integrations", {"provider": "duffel", "name": "Duffel"}, format="json")
    assert response.status_code == 400 and "credentials" in response.data


def test_rename_disable_and_replace_credentials(admin_api, integration):
    integration.last_test_ok = True
    integration.save()
    url = f"/api/admin/integrations/{integration.id}"
    response = admin_api.patch(
        url,
        {"name": "Duffel live", "mode": "live", "is_active": False, "credentials": {"access_token": "new"}},
        format="json",
    )
    assert response.status_code == 200
    assert (response.data["name"], response.data["mode"], response.data["is_active"]) == ("Duffel live", "live", False)
    # A new token is untested.
    assert response.data["last_test_ok"] is None
    integration.refresh_from_db()
    assert integration.get_credentials() == {"access_token": "new"}
    assert admin_api.patch(url, {"provider": "other"}, format="json").status_code == 400
    assert admin_api.delete(url).status_code == 405


def test_test_connection_success_and_failure(admin_api, integration, duffel_api):
    url = f"/api/admin/integrations/{integration.id}/test"
    duffel_api.reply = lambda request: httpx.Response(200, json={"data": []})
    response = admin_api.post(url)
    assert response.status_code == 200
    assert (response.data["last_test_ok"], response.data["last_test_message"]) == (True, "Connected to Duffel.")
    assert duffel_api.requests[0].headers["Authorization"] == "Bearer duffel_test_secret"

    duffel_api.reply = lambda request: httpx.Response(401, json=recorded("duffel_unauthorized.json"))
    response = admin_api.post(url)
    assert response.status_code == 200
    assert response.data["last_test_ok"] is False
    assert (
        response.data["last_test_message"] == "Duffel error 401: The access token used is not recognised by our system"
    )
    assert response.data["last_tested_at"] is not None


# Routes


def test_create_and_edit_a_route(admin_api, airports, carriers, integration):
    response = admin_api.post(
        "/api/admin/routes",
        {
            "origin": "nbo",
            "destination": "LHR",
            "trip_type": "return",
            "stay_nights": 7,
            "ticket_class": "economy",
            "max_connections": 1,
            "airlines": [str(carriers["KQ"].id)],
            "integrations": [str(integration.id)],
            "weekdays": [4, 1, 4],
            "pick_cheapest_direct": True,
            "max_per_date": 2,
            "markup_percent": "5.00",
            "markup_fixed": "20.00",
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    data = response.data
    assert data["origin"]["code"] == "NBO" and data["destination"]["city"] == "London"
    assert data["weekdays"] == [1, 4]
    assert [a["iata_code"] for a in data["airlines"]] == ["KQ"]
    assert data["integrations"] == [
        {"id": str(integration.id), "name": "Duffel test", "provider": "duffel", "is_active": True}
    ]
    assert (data["last_run"], data["new_fares"]) == (None, 0)

    response = admin_api.patch(
        f"/api/admin/routes/{data['id']}", {"trip_type": "one_way", "is_active": False}, format="json"
    )
    assert response.status_code == 200
    assert (response.data["stay_nights"], response.data["is_active"]) == (None, False)
    assert admin_api.delete(f"/api/admin/routes/{data['id']}").status_code == 405


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"destination": "NBO"}, "destination"),
        ({"trip_type": "return"}, "stay_nights"),
        ({"trip_type": "return", "stay_nights": 61}, "stay_nights"),
        ({"weekdays": [7]}, "weekdays"),
        ({"max_per_date": 6}, "max_per_date"),
        ({"max_connections": 5}, "max_connections"),
        ({"markup_percent": "-1"}, "markup_percent"),
        ({"markup_fixed": "-0.01"}, "markup_fixed"),
        ({"pick_cheapest": False, "pick_cheapest_direct": False}, "pick_cheapest"),
    ],
)
def test_route_validation(admin_api, airports, body, field):
    response = admin_api.post(
        "/api/admin/routes", {"origin": "NBO", "destination": "LHR", "ticket_class": "economy", **body}, format="json"
    )
    assert response.status_code == 400 and field in response.data


def test_routes_list_their_last_run_and_new_fares(admin_api, route, searched):
    [row] = admin_api.get("/api/admin/routes").data["results"]
    assert row["new_fares"] == 1
    assert row["last_run"]["status"] == "done" and row["last_run"]["fares_found"] == 2
    runs = admin_api.get(f"/api/admin/routes/{route.id}/runs").data["results"]
    assert [run["searches_made"] for run in runs] == [1]


# Fares


def test_fares_grouped_per_departure_date_sorted_in_usd(admin_api, route, searched):
    response = admin_api.get("/api/admin/fares", {"route": route.id})
    assert response.status_code == 200
    [day] = response.data["dates"]
    assert day["departure_date"] == DEC_1
    gbp, usd = day["fares"]
    assert (gbp["net_amount"], gbp["net_currency"], gbp["net_usd"], gbp["rate_date"]) == (
        "455.500",
        "GBP",
        "576.58",
        "2026-10-30",
    )
    assert (gbp["selling_price"], gbp["picked"], gbp["fare_type"]) == ("576.58", True, "private")
    assert gbp["integration"]["name"] == "Duffel test"
    assert [s["flight_number"] for s in gbp["itinerary"]["outbound"]["segments"]] == ["720", "3110"]
    assert gbp["itinerary"]["outbound"]["connections"][0]["airport"]["code"] == "DXB"
    assert gbp["itinerary"]["outbound"]["segments"][1]["operating_airline"]["iata_code"] == "EK"
    assert usd["net_usd"] == "650.00" and usd["picked"] is False

    picked = admin_api.get("/api/admin/fares", {"route": route.id, "picked": "true"}).data
    assert [f["net_currency"] for f in picked["dates"][0]["fares"]] == ["GBP"]
    assert picked["run"]["id"] == str(searched["GBP"].run_id)


def test_a_route_never_searched_has_no_fares(admin_api, route):
    assert admin_api.get("/api/admin/fares", {"route": route.id}).data == {"run": None, "dates": []}
    assert admin_api.get("/api/admin/fares").status_code == 400


def test_publish_creates_a_gds_offer(admin_api, searched, customer_api):
    fare = searched["GBP"]
    response = publish(admin_api, fare)
    assert response.status_code == 200, response.data
    assert response.data["status"] == "published"
    offer = Offer.objects.get(pk=response.data["offer"])
    assert (offer.source, offer.price, offer.ticket_class, offer.trip_type) == (
        "gds",
        Decimal("699.00"),
        "economy",
        "one_way",
    )
    assert (offer.net_amount, offer.net_currency, offer.net_usd, offer.rate, offer.rate_date) == (
        Decimal("455.500"),
        "GBP",
        Decimal("576.58"),
        Decimal("0.79"),
        date(2026, 10, 30),
    )
    assert (offer.integration, offer.route, offer.provider_ref, offer.fare_key, offer.fare_type) == (
        fare.integration,
        fare.route,
        fare.provider_ref,
        fare.fare_key,
        "private",
    )
    assert offer.price_checked_at == fare.run.finished_at
    assert (offer.origin.code, offer.destination.code, offer.departure_date) == ("NBO", "LHR", DEC_1)
    assert offer.airline.iata_code == "EK"
    assert [(s.flight, s.operating_airline_id is not None) for s in offer.segments.all()] == [
        ("EK 720", False),
        ("KQ 3110", True),
    ]
    assert (offer.checked_bags, offer.refund_policy, offer.change_policy) == (1, "not_allowed", "with_fee")

    # Customers see the source and when the price was checked, never the net amount, rate or fare type.
    public = customer_api.get(f"/api/offers/{offer.id}").data
    assert public["source"] == "gds" and public["price_checked_at"] is not None
    assert not {"net_amount", "net_currency", "net_usd", "rate", "rate_date", "fare_type", "provider_ref"} & set(public)
    assert public["itinerary"]["outbound"]["stop_count"] == 1
    # Admins see them all.
    admin = admin_api.get(f"/api/admin/offers/{offer.id}").data
    assert (admin["net_amount"], admin["net_currency"], admin["fare_type"]) == ("455.500", "GBP", "private")
    assert admin["integration"] == {"id": str(fare.integration_id), "name": "Duffel test"}


def test_publishing_the_same_flights_again_updates_the_offer(
    admin_api, searched, route, django_capture_on_commit_callbacks
):
    first = publish(admin_api, searched["GBP"], price="650.00").data
    offer = Offer.objects.get(pk=first["offer"])
    with django_capture_on_commit_callbacks(execute=True):
        admin_api.post(f"/api/admin/routes/{route.id}/search")
    later = Fare.objects.filter(net_currency="GBP", status="new").get()
    Fare.objects.filter(pk=later.pk).update(net_amount=Decimal("400"), net_usd=Decimal("506.33"))
    response = publish(admin_api, later, price="560.00", valid_until="2026-11-20", is_public=False)
    assert response.data["offer"] == offer.pk
    offer.refresh_from_db()
    assert (offer.price, offer.net_amount, offer.net_usd) == (Decimal("560.00"), Decimal("400.000"), Decimal("506.33"))
    assert offer.price_checked_at == later.run.finished_at
    # The rest stays as first published.
    assert offer.is_public is True and offer.valid_until == TODAY + timedelta(days=7)
    assert Offer.objects.count() == 1


def test_publish_rules(admin_api, searched):
    fare = searched["GBP"]
    assert publish(admin_api, fare, price="0").status_code == 400
    assert "valid_until" in publish(admin_api, fare, valid_until="2026-12-02").data
    assert "valid_until" in publish(admin_api, fare, valid_until="2026-10-31").data
    assert publish(admin_api, fare).status_code == 200
    assert publish(admin_api, fare).status_code == 409


def test_a_fare_without_a_rate_cannot_be_published(admin_api, searched):
    Fare.objects.filter(pk=searched["GBP"].pk).update(no_rate=True, net_usd=None, rate=None, rate_date=None)
    response = publish(admin_api, searched["GBP"])
    assert response.status_code == 409 and "no exchange rate for GBP" in response.data["detail"]


def test_dismiss_hides_a_fare(admin_api, searched, route):
    fare = searched["USD"]
    response = admin_api.post(f"/api/admin/fares/{fare.id}/dismiss")
    assert response.status_code == 200 and response.data["status"] == "dismissed"
    shown = admin_api.get("/api/admin/fares", {"route": route.id}).data["dates"][0]["fares"]
    assert [f["id"] for f in shown] == [str(searched["GBP"].id)]
    hidden = admin_api.get("/api/admin/fares", {"route": route.id, "status": "dismissed"}).data["dates"][0]["fares"]
    assert [f["id"] for f in hidden] == [str(fare.id)]
    publish(admin_api, searched["GBP"])
    assert admin_api.post(f"/api/admin/fares/{searched['GBP'].id}/dismiss").status_code == 409


def test_the_dashboard_counts_new_picked_fares(admin_api, searched):
    assert admin_api.get("/api/admin/dashboard").data["new_fares"] == 1


# Permissions and isolation


ENDPOINTS = [
    ("get", "/api/admin/integrations"),
    ("get", "/api/admin/routes"),
    ("get", "/api/admin/search-usage"),
    ("get", "/api/admin/fares"),
]


@pytest.mark.parametrize(("method", "url"), ENDPOINTS)
def test_admins_only(api, customer_api, method, url):
    assert getattr(api, method)(url).status_code == 401
    assert getattr(customer_api, method)(url).status_code == 403


def test_another_agencys_integrations_routes_and_fares_are_invisible(admin_api, searched, route, integration):
    fare = searched["USD"]
    other_admin = APIClient(HTTP_HOST="other.localhost")
    with schema_context(OTHER_SCHEMA):
        user = User.objects.create_user(email="boss@other.test", password="x", full_name="Boss", role="admin")
    other_admin.force_authenticate(user)
    with schema_context(OTHER_SCHEMA):
        assert other_admin.get("/api/admin/integrations").data == []
        assert other_admin.get("/api/admin/routes").data["results"] == []
        assert other_admin.get(f"/api/admin/routes/{route.id}").status_code == 404
        assert other_admin.post(f"/api/admin/integrations/{integration.id}/test").status_code == 404
        assert other_admin.get("/api/admin/fares", {"route": route.id}).status_code == 404
        assert other_admin.post(f"/api/admin/fares/{fare.id}/dismiss").status_code == 404
        assert other_admin.get("/api/admin/search-usage").data["used"] == 0
        assert not Route.objects.exists()


def test_platform_tenants_show_and_edit_the_allowance(searched):
    from tenants.tests.test_platform import platform_user, root_client

    client = root_client()
    client.force_authenticate(platform_user())
    tenant = Tenant.objects.get(schema_name=TEST_SCHEMA)
    rows = {row["id"]: row for row in client.get("/api/platform/tenants").data["results"]}
    assert (rows[str(tenant.id)]["monthly_search_allowance"], rows[str(tenant.id)]["searches_this_month"]) == (1500, 1)
    response = client.patch(f"/api/platform/tenants/{tenant.id}", {"monthly_search_allowance": 200}, format="json")
    assert response.status_code == 200 and response.data["monthly_search_allowance"] == 200
    assert (
        client.patch(f"/api/platform/tenants/{tenant.id}", {"monthly_search_allowance": -1}, format="json").status_code
        == 400
    )
