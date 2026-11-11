"""Re-checking a requested GDS booking's fare, and applying the answer through confirm availability."""

import copy
from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from django.db import connection

from bookings.models import Booking
from bookings.services import create_booking
from catalog.models import Offer
from core.models import AppSettings
from integrations.models import Fare, SearchRun
from tenants.models import Tenant

from .conftest import TODAY, offers_for, recorded, set_window

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)
# The GBP fare of the recorded reply: EK 720 to Dubai, then KQ 3110 to London.
EK_KEY = "EK720@2026-12-01-KQ3110@2026-12-01/economy"


@pytest.fixture(autouse=True)
def payment_instructions(db):
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")


@pytest.fixture
def booking(admin_api, customer, route, integration, duffel_api, exchange_rates, django_capture_on_commit_callbacks):
    """A requested booking of the offer published from the GBP fare found on 1 December."""
    set_window(route, DEC_1, DEC_1)
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.post(f"/api/admin/routes/{route.id}/search").status_code == 201
    fare = Fare.objects.get(net_currency="GBP")
    body = {"price": "699.00", "valid_until": (TODAY + timedelta(days=7)).isoformat(), "is_public": True}
    response = admin_api.post(f"/api/admin/fares/{fare.id}/publish", body, format="json")
    assert response.status_code == 200, response.data
    offer = Offer.objects.get(pk=response.data["offer"])
    duffel_api.requests.clear()
    return create_booking(customer, {"offer": offer.pk, "passenger_count": 2})


def recheck(api, booking):
    return api.post(f"/api/admin/bookings/{booking.id}/recheck-fare")


def set_allowance(value):
    Tenant.objects.filter(schema_name=connection.schema_name).update(monthly_search_allowance=value)


def later_ek(amount):
    """The recorded reply with the GBP fare at amount and its Dubai–London flight leaving two hours later."""

    def edit(data):
        ek = data["data"]["offers"][1]
        ek["total_amount"] = amount
        flight = ek["slices"][0]["segments"][1]
        for key in ("departing_at", "arriving_at"):
            flight[key] = (datetime.fromisoformat(flight[key]) + timedelta(hours=2)).isoformat()

    return offers_for("duffel_one_way.json", edit)


def without_ek(extra_kq=()):
    """The recorded reply without the GBP fare, plus copies of the KQ 100 fare as (flight number, USD amount)."""

    def edit(data):
        offers = data["data"]["offers"]
        del offers[1]
        for number, amount in extra_kq:
            offer = copy.deepcopy(offers[0])
            offer["id"] = f"off_kq{number}"
            offer["total_amount"] = amount
            offer["slices"][0]["segments"][0]["marketing_carrier_flight_number"] = number
            offers.append(offer)

    return offers_for("duffel_one_way.json", edit)


# Bookings keep where their fare came from


def test_bookings_copy_the_source_integration_and_fare_key(admin_api, booking, integration):
    assert (booking.source, booking.integration, booking.fare_key) == ("gds", integration, EK_KEY)
    data = admin_api.get(f"/api/admin/bookings/{booking.id}").json()
    assert (data["source"], data["integration"], data["fare_key"]) == (
        "gds",
        {"id": str(integration.id), "name": "Duffel test"},
        EK_KEY,
    )


def test_bookings_of_manual_offers_have_no_fare(admin_api, customer, make_offer):
    booking = create_booking(customer, {"offer": make_offer().pk, "passenger_count": 1})
    data = admin_api.get(f"/api/admin/bookings/{booking.id}").json()
    assert (data["source"], data["integration"], data["fare_key"]) == ("manual", None, None)


# Re-checking


def test_found_unchanged(admin_api, booking, duffel_api):
    response = recheck(admin_api, booking)
    assert response.status_code == 200, response.data
    data = response.json()
    assert (data["found"], data["alternatives"]) == (True, [])
    fare = data["fare"]
    # 455.50 GBP at 0.79 per USD, from the rate of two days ago; no markup on the route.
    assert (fare["net_amount"], fare["net_currency"], fare["net_usd"], fare["rate"], fare["rate_date"]) == (
        "455.500",
        "GBP",
        "576.58",
        "0.79000000",
        (TODAY - timedelta(days=2)).isoformat(),
    )
    assert (fare["selling_price"], fare["no_rate"], fare["fare_key"]) == ("576.58", False, EK_KEY)
    # In the shape confirm availability takes, as the published fare stored them.
    assert fare["segments"] == Fare.objects.get(net_currency="GBP").itinerary
    assert [s["flight_number"] for s in fare["itinerary"]["outbound"]["segments"]] == ["720", "3110"]

    # One search: the booking's date, route and cabin, with as many connections as the booking has.
    body = duffel_api.requests[0].read()
    assert len(duffel_api.requests) == 1
    assert b'"departure_date":"2026-12-01"' in body.replace(b" ", b"")
    assert b'"max_connections":1' in body.replace(b" ", b"")
    run = booking.offer.route.runs.get(trigger="recheck")
    assert (run.status, run.searches_made, run.fares_found, run.date_from, run.date_to) == ("done", 1, 2, DEC_1, DEC_1)
    assert admin_api.get("/api/admin/search-usage").json()["used"] == 2
    # Nothing about the booking changes, and the re-check stores no fares.
    booking.refresh_from_db()
    assert (booking.status, booking.unit_price, booking.changes) == ("requested", Decimal("699.00"), None)
    assert Fare.objects.count() == 2


def test_found_changed_flows_through_confirm_availability(admin_api, customer_api, booking, route, duffel_api):
    route.markup_percent, route.markup_fixed = Decimal("10"), Decimal("5")
    route.save()
    duffel_api.reply = later_ek("440.00")
    fare = recheck(admin_api, booking).json()["fare"]
    # 440 GBP at 0.79 = 556.96 USD; × 1.10 + 5 = 617.66 with the route's markup as it is now.
    assert (fare["net_usd"], fare["selling_price"]) == ("556.96", "617.66")
    assert [s["departure_time"] for s in fare["segments"]] == ["10:15", "23:40"]

    response = admin_api.post(
        f"/api/admin/bookings/{booking.id}/confirm-availability",
        {"unit_price": fare["selling_price"], "segments": fare["segments"]},
        format="json",
    )
    assert response.status_code == 200, response.data
    changes = response.json()["changes"]
    assert changes["unit_price"] == {"old": "699.00", "new": "617.66"}
    assert [line["departure"][-5:] for line in changes["segments"]["new"]] == ["10:15", "23:40"]
    assert customer_api.post(f"/api/bookings/{booking.id}/accept-changes").status_code == 200
    booking.refresh_from_db()
    assert booking.unit_price == Decimal("617.66")
    assert booking.changes_accepted


def test_not_found_returns_the_cheapest_alternatives(admin_api, booking, duffel_api):
    duffel_api.reply = without_ek([("101", "640.00"), ("102", "900.00"), ("103", "700.00")])
    data = recheck(admin_api, booking).json()
    assert (data["found"], data["fare"]) == (False, None)
    alternatives = data["alternatives"]
    assert [a["segments"][0]["flight_number"] for a in alternatives] == ["101", "100", "103"]
    assert [a["selling_price"] for a in alternatives] == ["640.00", "650.00", "700.00"]
    assert alternatives[0]["net_currency"] == "USD"

    # An alternative keeps the booking's route and trip type, so confirm availability takes it as it is.
    response = admin_api.post(
        f"/api/admin/bookings/{booking.id}/confirm-availability",
        {"unit_price": alternatives[0]["selling_price"], "segments": alternatives[0]["segments"]},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.json()["changes"]["segments"]["new"][0]["flight"] == "KQ 101"


def test_alternatives_need_a_rate(admin_api, booking, duffel_api):
    def edit(data):
        data["data"]["offers"][0]["total_currency"] = "XOF"
        del data["data"]["offers"][1]

    duffel_api.reply = offers_for("duffel_one_way.json", edit)
    data = recheck(admin_api, booking).json()
    assert (data["found"], data["alternatives"]) == (False, [])


def test_found_without_a_rate_has_no_usd_price(admin_api, booking, duffel_api):
    def edit(data):
        data["data"]["offers"][1]["total_currency"] = "XOF"

    duffel_api.reply = offers_for("duffel_one_way.json", edit)
    fare = recheck(admin_api, booking).json()["fare"]
    assert (fare["net_currency"], fare["no_rate"], fare["net_usd"], fare["rate"], fare["selling_price"]) == (
        "XOF",
        True,
        None,
        None,
        None,
    )


def test_over_the_allowance_is_refused(admin_api, booking, duffel_api):
    set_allowance(1)
    response = recheck(admin_api, booking)
    assert response.status_code == 409
    assert response.json()["detail"] == "This re-check needs 1 search, but only 0 are left this month."
    assert duffel_api.requests == []
    assert not SearchRun.objects.filter(trigger="recheck").exists()


def test_a_provider_error_changes_nothing(admin_api, booking, duffel_api):
    duffel_api.reply = lambda request: httpx.Response(401, json=recorded("duffel_unauthorized.json"))
    response = recheck(admin_api, booking)
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Duffel test could not be searched: Duffel error 401: The access token used is not recognised by our system"
    )
    booking.refresh_from_db()
    assert (booking.status, booking.unit_price, booking.changes) == ("requested", Decimal("699.00"), None)
    # The search was made, so it counts like a failed run's.
    run = SearchRun.objects.get(trigger="recheck")
    assert (run.status, run.searches_made) == ("failed", 1)
    assert run.errors[0].startswith("Duffel test, 01 Dec: Duffel error 401")


def test_manual_bookings_are_refused(admin_api, customer, make_offer, duffel_api):
    booking = create_booking(customer, {"offer": make_offer().pk, "passenger_count": 1})
    response = recheck(admin_api, booking)
    assert response.status_code == 409
    assert "entered by hand" in response.json()["detail"]
    assert duffel_api.requests == []


def test_only_requested_bookings_can_be_rechecked(admin_api, booking, duffel_api):
    confirmed = admin_api.post(f"/api/admin/bookings/{booking.id}/confirm-availability", {}, format="json")
    assert confirmed.status_code == 200
    response = recheck(admin_api, booking)
    assert response.status_code == 409
    assert response.json()["detail"] == "Only a requested booking's fare can be re-checked."
    assert duffel_api.requests == []


def test_a_disabled_integration_is_refused(admin_api, booking, integration, duffel_api):
    integration.is_active = False
    integration.save()
    response = recheck(admin_api, booking)
    assert response.status_code == 409
    assert duffel_api.requests == []


def test_admin_only(api, customer_api, booking):
    assert recheck(customer_api, booking).status_code == 403
    assert recheck(api, booking).status_code == 401
    assert booking.status == Booking.Status.REQUESTED


def test_the_fares_screen_skips_recheck_runs(admin_api, booking, route, duffel_api):
    search_run = route.runs.get(trigger="manual")
    recheck(admin_api, booking)
    data = admin_api.get(f"/api/admin/fares?route={route.id}").json()
    assert data["run"]["id"] == str(search_run.id)
    runs = admin_api.get(f"/api/admin/routes/{route.id}/runs").json()["results"]
    assert [run["trigger"] for run in runs] == ["recheck", "manual"]


def test_an_alternative_from_another_airline_changes_the_ticketing_airline(admin_api, customer_api, booking, duffel_api):
    assert booking.airline.iata_code == "EK"
    duffel_api.reply = without_ek()
    [alternative] = recheck(admin_api, booking).json()["alternatives"]
    assert alternative["airline"]["iata_code"] == "KQ"

    response = admin_api.post(
        f"/api/admin/bookings/{booking.id}/confirm-availability",
        {
            "unit_price": alternative["selling_price"],
            "airline": alternative["airline"]["id"],
            "segments": alternative["segments"],
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    data = response.json()
    assert data["changes"]["airline"] == {"old": booking.airline.name, "new": alternative["airline"]["name"]}
    assert data["airline"]["iata_code"] == "KQ"
    assert customer_api.get(f"/api/bookings/{booking.id}").json()["airline"]["iata_code"] == "KQ"
    booking.refresh_from_db()
    assert (booking.airline.iata_code, booking.offer.airline.iata_code) == ("KQ", "EK")
