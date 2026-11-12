"""The Amadeus provider: the token and flight offers requests it sends, how recorded responses map to results, and
errors; Amadeus integrations in runs, re-checks and the admin API, alongside Duffel."""

import json
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from urllib.parse import parse_qs

import httpx
import pytest

from bookings.services import create_booking
from catalog.models import Offer
from core.models import AppSettings
from integrations.models import Fare, Integration, SearchRun
from integrations.providers import ProviderError, SearchRequest
from integrations.providers.amadeus import AmadeusProvider

from .conftest import TODAY, amadeus_error, flight_offers_for, recorded, set_window

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)

CREDENTIALS = {"api_key": "AmK3yQ9", "api_secret": "Am-secret"}


def provider(mode="test"):
    return AmadeusProvider(CREDENTIALS, mode)


def one_way(**fields):
    return SearchRequest(
        **{
            "origin": "NBO",
            "destination": "LHR",
            "departure_date": DEC_1,
            "return_date": None,
            "cabin": "economy",
            "max_connections": None,
            **fields,
        }
    )


def only_direct(data):
    """Keeps the recorded KQ 100 offer only."""
    del data["data"][1]


def test_the_token_and_search_sent(amadeus_api):
    provider().search(one_way(max_connections=1, cabin="business"))
    token, search = amadeus_api.requests
    assert str(token.url) == "https://test.api.amadeus.com/v1/security/oauth2/token"
    assert parse_qs(token.content.decode()) == {
        "grant_type": ["client_credentials"],
        "client_id": ["AmK3yQ9"],
        "client_secret": ["Am-secret"],
    }
    assert (search.method, str(search.url)) == ("POST", "https://test.api.amadeus.com/v2/shopping/flight-offers")
    assert search.headers["Authorization"] == "Bearer Ab12Cd34Ef56Gh78"
    assert search.headers["X-HTTP-Method-Override"] == "GET"
    body = json.loads(search.content)
    assert body["originDestinations"] == [
        {
            "id": "1",
            "originLocationCode": "NBO",
            "destinationLocationCode": "LHR",
            "departureDateTimeRange": {"date": "2026-12-01"},
        }
    ]
    assert body["travelers"] == [{"id": "1", "travelerType": "ADULT"}]
    assert body["sources"] == ["GDS"]
    filters = body["searchCriteria"]["flightFilters"]
    assert filters["cabinRestrictions"] == [
        {"cabin": "BUSINESS", "coverage": "ALL_SEGMENTS", "originDestinationIds": ["1"]}
    ]
    assert filters["connectionRestriction"] == {"maxNumberOfConnections": 1}


def test_a_return_search_any_connections_and_live_mode_production(amadeus_api):
    amadeus_api.reply = flight_offers_for("amadeus_return.json")
    provider("live").search(one_way(return_date=date(2026, 12, 8)))
    token, search = amadeus_api.requests
    assert str(token.url) == "https://api.amadeus.com/v1/security/oauth2/token"
    body = json.loads(search.content)
    back = body["originDestinations"][1]
    assert (back["id"], back["originLocationCode"], back["destinationLocationCode"]) == ("2", "LHR", "NBO")
    assert back["departureDateTimeRange"] == {"date": "2026-12-08"}
    assert body["searchCriteria"]["flightFilters"]["cabinRestrictions"][0]["originDestinationIds"] == ["1", "2"]
    assert "connectionRestriction" not in body["searchCriteria"]["flightFilters"]


def test_more_connections_than_amadeus_allows_ask_for_its_most(amadeus_api):
    provider().search(one_way(max_connections=4))
    body = json.loads(amadeus_api.requests[1].content)
    assert body["searchCriteria"]["flightFilters"]["connectionRestriction"] == {"maxNumberOfConnections": 2}


def test_one_token_per_provider(amadeus_api):
    amadeus = provider()
    amadeus.search(one_way())
    amadeus.search(one_way())
    assert [r.url.path for r in amadeus_api.requests] == [
        "/v1/security/oauth2/token",
        "/v2/shopping/flight-offers",
        "/v2/shopping/flight-offers",
    ]


def test_one_way_direct_offer(amadeus_api):
    direct, _ = provider().search(one_way())
    [segment] = direct.segments
    assert (segment.direction, segment.airline, segment.flight_number, segment.operating_airline) == (
        "outbound",
        "KQ",
        "100",
        None,
    )
    assert (segment.origin, segment.destination) == ("NBO", "LHR")
    assert (segment.departure_date, segment.departure_time) == (DEC_1, time(23, 55))
    assert (segment.arrival_date, segment.arrival_time) == (date(2026, 12, 2), time(6, 0))
    assert (direct.airline, direct.ticket_class) == ("KQ", "economy")
    assert (direct.net_amount, direct.net_currency) == (Decimal("640.00"), "USD")
    assert (direct.checked_bags, direct.checked_bag_kg, direct.cabin_bag_kg) == (2, None, None)
    # The search states no conditions.
    assert (direct.refund_policy, direct.change_policy) == ("not_allowed", "not_allowed")
    assert (direct.fare_type, direct.seats_left, direct.provider_ref) == ("public", 4, "1")
    # The end of the last ticketing date, Nairobi time.
    assert direct.expires_at == datetime(2026, 11, 20, 20, 59, tzinfo=UTC)


def test_connection_codeshare_weight_and_negotiated_fare(amadeus_api):
    _, connecting = provider().search(one_way())
    first, second = connecting.segments
    # The technical stop is not a segment.
    assert [(s.origin, s.destination) for s in connecting.segments] == [("NBO", "DXB"), ("DXB", "LHR")]
    assert (first.airline, first.flight_number, first.operating_airline) == ("EK", "720", None)
    assert (second.airline, second.flight_number, second.operating_airline) == ("KQ", "3110", "EK")
    assert (second.arrival_date, second.arrival_time) == (date(2026, 12, 2), time(1, 55))
    assert connecting.airline == "EK"
    assert (connecting.net_amount, connecting.net_currency) == (Decimal("560.00"), "EUR")
    # A weight allowance alone is one bag of that weight.
    assert (connecting.checked_bags, connecting.checked_bag_kg) == (1, 30)
    assert (connecting.fare_type, connecting.seats_left, connecting.expires_at) == ("private", 2, None)


def test_return_offer(amadeus_api):
    amadeus_api.reply = flight_offers_for("amadeus_return.json")
    [fare] = provider().search(one_way(return_date=date(2026, 12, 8)))
    assert [(s.direction, s.flight_number, s.origin, s.destination) for s in fare.segments] == [
        ("outbound", "100", "NBO", "LHR"),
        ("return", "101", "LHR", "NBO"),
    ]
    assert (fare.segments[1].arrival_date, fare.segments[1].arrival_time) == (date(2026, 12, 9), time(5, 45))
    assert (fare.net_amount, fare.net_currency) == (Decimal("812.30"), "GBP")
    assert (fare.checked_bags, fare.checked_bag_kg, fare.seats_left) == (1, 23, 9)


def test_cabins_bags_and_fare_types_as_given(amadeus_api):
    def edit(data):
        offer = data["data"][0]
        details = offer["travelerPricings"][0]["fareDetailsBySegment"]
        details[0]["cabin"] = "PREMIUM_ECONOMY"
        details[0]["includedCheckedBags"] = {"quantity": 1, "weight": 23, "weightUnit": "KG"}
        offer["pricingOptions"]["fareType"] = []
        del data["data"][1]["travelerPricings"][0]["fareDetailsBySegment"][1]["includedCheckedBags"]

    amadeus_api.reply = flight_offers_for("amadeus_one_way.json", edit)
    direct, connecting = provider().search(one_way())
    assert (direct.ticket_class, direct.checked_bags, direct.checked_bag_kg, direct.fare_type) == (
        "premium_economy",
        1,
        23,
        "unknown",
    )
    # A flight without included bags makes the fare's checked bags none.
    assert (connecting.checked_bags, connecting.checked_bag_kg) == (0, None)


def test_no_offers_is_an_empty_result(amadeus_api):
    amadeus_api.reply = lambda request: httpx.Response(200, json={"meta": {"count": 0}, "data": []})
    assert provider().search(one_way()) == []


def test_http_errors_refused_tokens_and_unreadable_answers(amadeus_api):
    amadeus_api.reply = amadeus_error
    with pytest.raises(ProviderError, match="^Amadeus error 400: invalid query parameter format$"):
        provider().search(one_way())
    amadeus_api.reply = lambda request: httpx.Response(500, text="<html>Internal error</html>")
    with pytest.raises(ProviderError, match=r"^Amadeus error 500\.$"):
        provider().search(one_way())
    amadeus_api.reply = lambda request: httpx.Response(200, json={"errors": []})
    with pytest.raises(ProviderError, match="could not be read"):
        provider().search(one_way())
    amadeus_api.token = lambda request: httpx.Response(401, json=recorded("amadeus_denied.json"))
    with pytest.raises(ProviderError, match="^Amadeus error 401: Client credentials are invalid$"):
        provider().search(one_way())


def test_an_unreadable_price_is_a_provider_error(amadeus_api):
    def edit(data):
        data["data"][0]["price"]["grandTotal"] = "640 dollars"

    amadeus_api.reply = flight_offers_for("amadeus_one_way.json", edit)
    with pytest.raises(ProviderError, match="unreadable price"):
        provider().search(one_way())


def test_a_network_failure_is_a_provider_error(amadeus_api):
    def fail(request):
        raise httpx.ConnectError("refused")

    amadeus_api.token = fail
    with pytest.raises(ProviderError, match="Amadeus could not be reached"):
        provider().search(one_way())


def test_the_connection_test_takes_a_token(amadeus_api):
    assert provider().test() == "Connected to Amadeus."
    [request] = amadeus_api.requests
    assert request.url.path == "/v1/security/oauth2/token"


# Amadeus in runs


@pytest.fixture
def search(admin_api, django_capture_on_commit_callbacks):
    """Search now on a route with a fixed window, running the queued run at once; returns the run."""

    def run(route, date_from=DEC_1, date_to=DEC_1):
        set_window(route, date_from, date_to)
        with django_capture_on_commit_callbacks(execute=True):
            response = admin_api.post(f"/api/admin/routes/{route.id}/search")
        assert response.status_code == 201, response.data
        return SearchRun.objects.get(pk=response.data["id"])

    return run


def test_amadeus_results_are_stored_as_fares(search, route, make_amadeus, amadeus_api, exchange_rates):
    make_amadeus()
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 1, 2, [])
    eur = Fare.objects.get(net_currency="EUR")
    assert (eur.net_usd, eur.integration.provider, eur.fare_type) == (Decimal("608.70"), "amadeus", "private")
    assert eur.fare_key == "EK720@2026-12-01-KQ3110@2026-12-01/economy"
    usd = Fare.objects.get(net_currency="USD")
    assert (usd.checked_bags, usd.seats_left, usd.provider_ref) == (2, 4, "1")
    assert usd.fare_key == "KQ100@2026-12-01/economy"


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (
            lambda data: data["data"][0]["itineraries"][0]["segments"][0].update(carrierCode="ZZ"),
            "airline ZZ is not in the airline list",
        ),
        (
            lambda data: data["data"][0]["itineraries"][0]["segments"][0]["arrival"].update(iataCode="XXX"),
            "airport XXX is not in the airport list",
        ),
        (
            lambda data: data["data"][0].update(validatingAirlineCodes=["ZX"]),
            "airline ZX is not in the airline list",
        ),
    ],
)
def test_results_breaking_a_rule_are_skipped_and_counted(search, route, make_amadeus, amadeus_api, edit, message):
    make_amadeus()

    def broken(data):
        only_direct(data)
        edit(data)

    amadeus_api.reply = flight_offers_for("amadeus_one_way.json", broken)
    run = search(route)
    assert run.fares_found == 0 and not Fare.objects.exists()
    [error] = run.errors
    assert error.startswith("Amadeus test: skipped, ") and message in error


def test_a_return_route_searches_with_the_stay(search, make_route, make_amadeus, amadeus_api, exchange_rates):
    make_amadeus()
    route = make_route(trip_type="return", stay_nights=7)
    amadeus_api.reply = flight_offers_for("amadeus_return.json")
    run = search(route)
    [fare] = Fare.objects.all()
    assert (run.fares_found, fare.trip_type, fare.net_currency) == (1, "return", "GBP")
    assert fare.fare_key == "KQ100@2026-12-01-KQ101@2026-12-08/economy"


def test_an_amadeus_error_is_recorded_and_the_run_goes_on(
    search, route, make_amadeus, integration, amadeus_api, duffel_api
):
    make_amadeus()
    amadeus_api.reply = amadeus_error
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found) == ("done", 2, 2)
    assert run.errors == ["Amadeus test, 01 Dec: Amadeus error 400: invalid query parameter format"]
    assert {fare.integration.provider for fare in Fare.objects.all()} == {"duffel"}


def test_a_route_searches_duffel_and_amadeus_and_counts_the_same_flights_once(
    search, route, make_amadeus, integration, amadeus_api, duffel_api, exchange_rates
):
    make_amadeus()
    route.max_per_date = 5
    route.save()
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 2, 4, [])
    picked = Fare.objects.filter(picked=True).order_by("net_usd")
    assert [(f.fare_key, f.integration.provider, f.net_usd) for f in picked] == [
        ("EK720@2026-12-01-KQ3110@2026-12-01/economy", "duffel", Decimal("576.58")),
        ("KQ100@2026-12-01/economy", "amadeus", Decimal("640.00")),
    ]


# Re-checking a booking found through Amadeus


@pytest.fixture
def amadeus_booking(admin_api, customer, route, make_amadeus, amadeus_api, exchange_rates, search):
    """A requested booking of the offer published from Amadeus's KQ 100 fare on 1 December."""
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    route.integrations.set([make_amadeus()])
    search(route)
    fare = Fare.objects.get(net_currency="USD")
    body = {"price": "699.00", "valid_until": (TODAY + timedelta(days=7)).isoformat(), "is_public": True}
    response = admin_api.post(f"/api/admin/fares/{fare.id}/publish", body, format="json")
    assert response.status_code == 200, response.data
    amadeus_api.requests.clear()
    return create_booking(customer, {"offer": Offer.objects.get(pk=response.data["offer"]).pk, "passenger_count": 1})


def test_an_amadeus_booking_is_rechecked(admin_api, amadeus_booking, amadeus_api):
    response = admin_api.post(f"/api/admin/bookings/{amadeus_booking.id}/recheck-fare")
    assert response.status_code == 200, response.data
    data = response.json()
    assert data["found"] is True
    assert (data["fare"]["net_amount"], data["fare"]["net_currency"], data["fare"]["net_usd"]) == (
        "640.000",
        "USD",
        "640.00",
    )
    assert len(amadeus_api.requests) == 2


def test_an_amadeus_error_on_recheck_is_a_502(admin_api, amadeus_booking, amadeus_api):
    amadeus_api.reply = amadeus_error
    response = admin_api.post(f"/api/admin/bookings/{amadeus_booking.id}/recheck-fare")
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Amadeus test could not be searched: Amadeus error 400: invalid query parameter format"
    )


# The admin API


def test_amadeus_credentials_are_encrypted_at_rest_and_never_returned(admin_api):
    credentials = {"api_key": "AmK3yQ9-key", "api_secret": "Am-secret-pw"}
    response = admin_api.post(
        "/api/admin/integrations",
        {"provider": "amadeus", "name": "Amadeus", "mode": "test", "credentials": credentials},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert "credentials" not in response.data and response.data["provider"] == "amadeus"
    integration = Integration.objects.get()
    for secret in credentials.values():
        assert secret not in integration.credentials
    assert integration.get_credentials() == credentials
    assert "credentials" not in admin_api.get("/api/admin/integrations").data[0]


def test_amadeus_needs_its_two_credentials(admin_api):
    body = {"provider": "amadeus", "name": "Amadeus", "mode": "live"}
    response = admin_api.post("/api/admin/integrations", {**body, "credentials": {"api_key": "k"}}, format="json")
    assert response.status_code == 400 and response.data["credentials"] == ["Enter the api secret."]


def test_amadeus_test_connection_success_and_failure(admin_api, make_amadeus, amadeus_api):
    url = f"/api/admin/integrations/{make_amadeus().id}/test"
    response = admin_api.post(url)
    assert (response.data["last_test_ok"], response.data["last_test_message"]) == (True, "Connected to Amadeus.")

    amadeus_api.token = lambda request: httpx.Response(401, json=recorded("amadeus_denied.json"))
    response = admin_api.post(url)
    assert response.data["last_test_ok"] is False
    assert response.data["last_test_message"] == "Amadeus error 401: Client credentials are invalid"
