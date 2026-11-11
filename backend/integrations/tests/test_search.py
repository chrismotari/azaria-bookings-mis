"""Search runs: the allowance, storing results, skips, conversion, picking and clean-up."""

from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
from django.db import connection
from django.utils import timezone
from freezegun import freeze_time

from integrations import services
from integrations.models import Fare, SearchRun
from rates.models import ExchangeRate
from tenants.models import Tenant

from .conftest import TODAY, offers_for, recorded, set_window

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)


@pytest.fixture
def search(admin_api, django_capture_on_commit_callbacks):
    """Search now on a route with a fixed window, running the queued run at once; returns the response."""

    def run(route, date_from=DEC_1, date_to=DEC_1):
        set_window(route, date_from, date_to)
        with django_capture_on_commit_callbacks(execute=True):
            return admin_api.post(f"/api/admin/routes/{route.id}/search")

    return run


def latest_run(route):
    return route.runs.order_by("-created_at").first()


def set_allowance(value):
    Tenant.objects.filter(schema_name=connection.schema_name).update(monthly_search_allowance=value)


def drop_offer(index):
    def edit(data):
        del data["data"]["offers"][index]

    return edit


# Storing results


def test_every_valid_result_is_stored_whatever_its_currency(search, route, integration, duffel_api, exchange_rates):
    response = search(route)
    assert response.status_code == 201
    run = latest_run(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 1, 2, [])
    usd, gbp = sorted(run.fares.all(), key=lambda fare: fare.net_currency, reverse=True)
    assert (usd.net_amount, usd.net_currency, usd.net_usd, usd.rate, usd.rate_date) == (
        Decimal("650.000"),
        "USD",
        Decimal("650.00"),
        Decimal("1"),
        TODAY,
    )
    # 455.50 GBP at 0.79 per USD = 576.582… → 576.58, with the rate's own date.
    assert (gbp.net_usd, gbp.rate, gbp.rate_date, gbp.no_rate) == (
        Decimal("576.58"),
        Decimal("0.79"),
        TODAY - timedelta(days=2),
        False,
    )
    assert gbp.selling_price == Decimal("576.58")
    assert gbp.fare_type == "private" and gbp.airline.iata_code == "EK"
    assert gbp.fare_key == "EK720@2026-12-01-KQ3110@2026-12-01/economy"
    assert gbp.itinerary[1]["operating_airline"] == str(gbp.airline.pk)
    assert usd.itinerary == [
        {
            "direction": "outbound",
            "airline": str(usd.airline.pk),
            "flight_number": "100",
            "operating_airline": None,
            "origin": "NBO",
            "destination": "LHR",
            "departure_date": "2026-12-01",
            "departure_time": "23:55",
            "arrival_date": "2026-12-02",
            "arrival_time": "06:00",
        }
    ]


def test_a_currency_without_a_rate_is_stored_but_not_picked(search, route, integration, duffel_api):
    search(route)
    gbp = Fare.objects.get(net_currency="GBP")
    assert gbp.no_rate is True
    assert (gbp.net_usd, gbp.rate, gbp.rate_date, gbp.selling_price) == (None, None, None, None)
    assert gbp.picked is False
    assert Fare.objects.get(net_currency="USD").picked is True


def test_a_return_route_searches_with_the_stay(search, make_route, integration, duffel_api, exchange_rates):
    route = make_route(trip_type="return", stay_nights=7)
    duffel_api.reply = offers_for("duffel_return.json")
    search(route)
    [fare] = Fare.objects.all()
    assert fare.trip_type == "return" and fare.net_currency == "EUR"
    assert [s["direction"] for s in fare.itinerary] == ["outbound", "return"]
    assert duffel_api.requests[0].content.count(b"2026-12-08") == 1


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (
            lambda o: o["slices"][0]["segments"][0]["marketing_carrier"].update(iata_code="ZZ"),
            "airline ZZ is not in the airline list",
        ),
        (
            lambda o: o["slices"][0]["segments"][0]["operating_carrier"].update(iata_code="ZY"),
            "airline ZY is not in the airline list",
        ),
        (lambda o: o["owner"].update(iata_code="ZX"), "airline ZX is not in the airline list"),
        (
            lambda o: o["slices"][0]["segments"][0]["destination"].update(iata_code="XXX"),
            "airport XXX is not in the airport list",
        ),
        (
            lambda o: o["slices"][0]["segments"][0].update(marketing_carrier_flight_number="12345"),
            "unusable flight number",
        ),
        # Lands before it leaves (more than a day earlier).
        (
            lambda o: o["slices"][0]["segments"][0].update(arriving_at="2026-11-29T06:00:00"),
            "the arrival date must be between one day before and two days after the departure",
        ),
        # Ends somewhere other than the route's destination.
        (lambda o: o["slices"][0]["segments"][0]["destination"].update(iata_code="DXB"), "must arrive at LHR"),
        (
            lambda o: o["slices"][0]["segments"][0]["passengers"][0]["baggages"][0].update(quantity=4),
            "more than 3 checked bags",
        ),
    ],
)
def test_results_breaking_a_rule_are_skipped_and_counted(search, route, integration, duffel_api, edit, message):
    def broken(data):
        del data["data"]["offers"][1]
        edit(data["data"]["offers"][0])

    duffel_api.reply = offers_for("duffel_one_way.json", broken)
    search(route)
    run = latest_run(route)
    assert run.fares_found == 0 and not Fare.objects.exists()
    assert run.status == "done"
    [error] = run.errors
    assert error.startswith("Duffel test: skipped, ") and message in error


def test_an_inactive_airline_is_skipped(search, route, integration, duffel_api, carriers):
    duffel_api.reply = offers_for("duffel_one_way.json", drop_offer(1))
    carriers["KQ"].is_active = False
    carriers["KQ"].save()
    search(route)
    assert latest_run(route).errors == ["Duffel test: skipped, Outbound flight 1: Kenya Airways is no longer active"]


def test_the_same_skip_is_counted_once_per_message(search, route, integration, duffel_api):
    def two_unknown(data):
        for offer in data["data"]["offers"]:
            offer["owner"]["iata_code"] = "ZZ"

    duffel_api.reply = offers_for("duffel_one_way.json", two_unknown)
    search(route)
    assert latest_run(route).errors == ["Duffel test: skipped, airline ZZ is not in the airline list (2×)"]


def test_a_provider_error_is_recorded_and_the_run_goes_on(search, route, make_integration, duffel_api):
    make_integration(name="A broken one")
    make_integration(name="B working one")
    working = offers_for("duffel_one_way.json", drop_offer(1))
    calls = []

    def reply(request):
        calls.append(request)
        # The first search of each date fails.
        if len(calls) % 2 == 1:
            return httpx.Response(401, json=recorded("duffel_unauthorized.json"))
        return working(request)

    duffel_api.reply = reply
    search(route, DEC_1, DEC_1 + timedelta(days=1))
    run = latest_run(route)
    assert (run.status, run.searches_made, run.fares_found) == ("done", 4, 2)
    assert run.errors == [
        "A broken one, 01 Dec: Duffel error 401: The access token used is not recognised by our system",
        "A broken one, 02 Dec: Duffel error 401: The access token used is not recognised by our system",
    ]


def test_a_run_where_every_search_failed_is_failed(search, route, integration, duffel_api):
    duffel_api.reply = lambda request: httpx.Response(500, json={"errors": [{"message": "Internal error"}]})
    search(route)
    run = latest_run(route)
    assert run.status == "failed" and run.finished_at is not None


# The allowance


def test_searches_needed_count_weekdays_and_integrations(search, make_route, make_integration, duffel_api):
    first, second = make_integration(name="One"), make_integration(name="Two")
    make_integration(name="Off", is_active=False)
    # Tuesdays and Thursdays from Tue 1 to Mon 14 Dec: 4 dates.
    route = make_route(weekdays=[1, 3])
    set_allowance(7)
    response = search(route, DEC_1, date(2026, 12, 14))
    assert response.status_code == 409
    assert response.data["detail"] == "This search needs 8 searches, but only 7 are left this month."
    assert not SearchRun.objects.exists()

    # Only the route's chosen integration.
    route.integrations.set([first])
    assert search(route, DEC_1, date(2026, 12, 14)).status_code == 201
    assert latest_run(route).searches_made == 4
    assert {r.url.params.get("supplier_timeout") for r in duffel_api.requests} == {"20000"}
    assert second.fares.count() == 0


def test_the_allowance_is_per_nairobi_calendar_month(search, route, integration, duffel_api, admin_api):
    set_allowance(3)
    search(route, DEC_1, DEC_1 + timedelta(days=1))
    assert admin_api.get("/api/admin/search-usage").data == {"allowance": 3, "used": 2, "left": 1}
    assert search(route, DEC_1, DEC_1 + timedelta(days=1)).status_code == 409

    # 23:30 on 30 November in Nairobi is still November.
    with freeze_time("2026-11-30 20:30:00"):
        assert admin_api.get("/api/admin/search-usage").data["used"] == 2
    # 00:30 on 1 December in Nairobi (21:30 UTC on the 30th) starts a new month.
    with freeze_time("2026-11-30 21:30:00"):
        assert admin_api.get("/api/admin/search-usage").data == {"allowance": 3, "used": 0, "left": 3}
        assert search(route, DEC_1, DEC_1 + timedelta(days=1)).status_code == 201


def test_no_search_without_an_active_integration(search, route, make_integration):
    make_integration(is_active=False)
    assert search(route).status_code == 409


# Picking


def test_the_cheapest_in_usd_is_picked_across_currencies(search, route, integration, duffel_api, exchange_rates):
    # 650 USD against 455.50 GBP (576.58 USD).
    search(route)
    assert Fare.objects.get(picked=True).net_currency == "GBP"


def test_the_same_flights_from_two_integrations_count_once_at_the_cheapest(
    search, route, make_integration, duffel_api, exchange_rates
):
    make_integration(name="One")
    make_integration(name="Two")
    calls = []

    def reply(request):
        calls.append(request)

        def price(data):
            del data["data"]["offers"][1]
            # The second integration has the same flight cheaper, in euros: 550 EUR = 597.83 USD.
            if len(calls) == 2:
                data["data"]["offers"][0].update(total_amount="550.00", total_currency="EUR")

        return offers_for("duffel_one_way.json", price)(request)

    duffel_api.reply = reply
    route.max_per_date = 5
    route.save()
    search(route)
    assert Fare.objects.count() == 2
    [picked] = Fare.objects.filter(picked=True)
    assert (picked.integration.name, picked.net_usd) == ("Two", Decimal("597.83"))


def test_pick_rules_per_date(search, route, integration, duffel_api, exchange_rates):
    route.pick_cheapest, route.pick_cheapest_direct = False, True
    route.save()
    search(route)
    assert Fare.objects.get(picked=True).net_currency == "USD"

    route.pick_cheapest, route.max_per_date = True, 1
    route.save()
    search(route)
    # The cheapest (connecting) and the cheapest direct.
    assert Fare.objects.filter(picked=True).count() == 2

    route.pick_cheapest_direct, route.max_per_date = False, 2
    route.save()
    search(route, DEC_1, DEC_1 + timedelta(days=1))
    run = latest_run(route)
    assert run.fares.filter(picked=True).count() == 4


@pytest.mark.parametrize(
    ("change", "picked"),
    [
        ({"max_connections": 0}, "USD"),
        ({"airlines": "KQ"}, "USD"),
        ({"airlines": "EK"}, "GBP"),
        ({"ticket_class": "business"}, None),
    ],
)
def test_filters_before_picking(search, route, integration, duffel_api, exchange_rates, carriers, change, picked):
    if "airlines" in change:
        route.airlines.set([carriers[change.pop("airlines")]])
    for field, value in change.items():
        setattr(route, field, value)
    route.save()
    search(route)
    assert [fare.net_currency for fare in Fare.objects.filter(picked=True)] == ([picked] if picked else [])


def test_markup_is_added_in_usd_and_rounded_half_up(search, route, integration, duffel_api, exchange_rates):
    route.markup_percent, route.markup_fixed = Decimal("7.5"), Decimal("10.00")
    route.save()
    search(route)
    # 650 × 1.075 + 10 = 708.75; 576.58 × 1.075 + 10 = 629.8235 → 629.82.
    assert sorted(Fare.objects.values_list("selling_price", flat=True)) == [Decimal("629.82"), Decimal("708.75")]
    assert services.markup(Decimal("100.01"), route) == Decimal("117.51")


def test_a_later_run_replaces_earlier_new_fares(search, route, integration, duffel_api, exchange_rates):
    search(route)
    first = Fare.objects.get(picked=True)
    other = Fare.objects.exclude(pk=first.pk).get()
    search(route)
    first.refresh_from_db()
    assert first.picked is False
    assert latest_run(route).fares.filter(picked=True).count() == 1
    # Kept for the price history.
    assert Fare.objects.filter(pk=other.pk).exists()


def test_stored_conversions_stay_when_rates_change(search, route, integration, duffel_api, exchange_rates):
    search(route)
    ExchangeRate.objects.create(currency="GBP", units_per_usd=Decimal("0.5"), date=TODAY, source="manual")
    gbp = Fare.objects.get(net_currency="GBP")
    assert (gbp.net_usd, gbp.rate) == (Decimal("576.58"), Decimal("0.79"))


# Clean-up


def test_fares_older_than_30_days_are_deleted_except_published(search, route, integration, duffel_api, exchange_rates):
    from integrations.tasks import delete_old_fares

    search(route)
    usd, gbp = Fare.objects.get(net_currency="USD"), Fare.objects.get(net_currency="GBP")
    Fare.objects.filter(pk=usd.pk).update(status="published")
    with freeze_time(timezone.now() + timedelta(days=30, minutes=-1)):
        assert delete_old_fares() == 0
    with freeze_time(timezone.now() + timedelta(days=30, minutes=1)):
        assert delete_old_fares() == 1
    assert list(Fare.objects.values_list("pk", flat=True)) == [usd.pk]
    assert not Fare.objects.filter(pk=gbp.pk).exists()


# Price history


def test_price_history_is_the_cheapest_usd_fare_per_run(
    search, route, integration, duffel_api, exchange_rates, admin_api
):
    search(route)
    ExchangeRate.objects.create(currency="GBP", units_per_usd=Decimal("0.70"), date=TODAY, source="manual")
    with freeze_time("2026-11-02 09:00:00"):
        search(route)
    response = admin_api.get("/api/admin/fares/history", {"route": route.id, "departure_date": "2026-12-01"})
    assert [(row["net_usd"], row["net_currency"]) for row in response.data] == [("576.58", "GBP"), ("650.00", "USD")]
