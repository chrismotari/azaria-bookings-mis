"""The Sabre provider: the token and Bargain Finder Max requests it sends, how recorded responses map to results, and
errors; Sabre integrations in runs, re-checks and the admin API, alongside Duffel."""

import base64
import json
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import httpx
import pytest

from bookings.services import create_booking
from catalog.models import Offer
from core.models import AppSettings
from integrations.models import Fare, Integration, SearchRun
from integrations.providers import ProviderError, SearchRequest
from integrations.providers.sabre import SabreProvider

from .conftest import TODAY, itineraries_for, recorded, sabre_error, set_window

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)

CREDENTIALS = {"user_id": "7971", "password": "Sb-secret", "pseudo_city_code": "K2RL", "domain": "AA"}


def provider(mode="test"):
    return SabreProvider(CREDENTIALS, mode)


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


def b64(value):
    return base64.b64decode(value).decode()


def sent(request):
    return json.loads(request.content)["OTA_AirLowFareSearchRQ"]


def itinerary(data, number):
    return data["groupedItineraryResponse"]["itineraryGroups"][0]["itineraries"][number]


def passenger(data, number=0):
    return itinerary(data, number)["pricingInformation"][0]["fare"]["passengerInfoList"][0]["passengerInfo"]


def only_direct(data):
    """Keeps the recorded KQ 100 itinerary only."""
    del data["groupedItineraryResponse"]["itineraryGroups"][0]["itineraries"][1]


def test_the_token_and_search_sent(sabre_api):
    provider().search(one_way(max_connections=1, cabin="business"))
    token, search = sabre_api.requests
    assert str(token.url) == "https://api.cert.platform.sabre.com/v2/auth/token"
    assert token.content == b"grant_type=client_credentials"
    scheme, secret = token.headers["Authorization"].split()
    client_id, password = b64(secret).split(":")
    assert (scheme, b64(client_id), b64(password)) == ("Basic", "V1:7971:K2RL:AA", "Sb-secret")

    assert (search.method, str(search.url)) == ("POST", "https://api.cert.platform.sabre.com/v5/offers/shop")
    assert search.headers["Authorization"] == "Bearer T1RLAQK3oVbzBQ5Hmq5vNcH0Wn"
    body = sent(search)
    assert body["POS"]["Source"][0]["PseudoCityCode"] == "K2RL"
    [leg] = body["OriginDestinationInformation"]
    assert (leg["DepartureDateTime"], leg["OriginLocation"], leg["DestinationLocation"]) == (
        "2026-12-01T00:00:00",
        {"LocationCode": "NBO"},
        {"LocationCode": "LHR"},
    )
    preferences = body["TravelPreferences"]
    assert preferences["CabinPref"] == [{"Cabin": "C", "PreferLevel": "Only"}]
    assert preferences["MaxStopsQuantity"] == 1
    assert preferences["TPA_Extensions"]["VoluntaryChanges"] == {"Match": "Info"}
    assert body["TravelerInfoSummary"]["AirTravelerAvail"] == [
        {"PassengerTypeQuantity": [{"Code": "ADT", "Quantity": 1}]}
    ]


def test_a_return_search_sends_two_legs_any_connections_and_live_mode_production(sabre_api):
    sabre_api.reply = itineraries_for("sabre_return.json")
    provider("live").search(one_way(return_date=date(2026, 12, 8)))
    token, search = sabre_api.requests
    assert str(token.url) == "https://api.platform.sabre.com/v2/auth/token"
    assert str(search.url) == "https://api.platform.sabre.com/v5/offers/shop"
    outbound, back = sent(search)["OriginDestinationInformation"]
    assert (outbound["RPH"], back["RPH"]) == ("1", "2")
    assert (back["DepartureDateTime"], back["OriginLocation"]["LocationCode"]) == ("2026-12-08T00:00:00", "LHR")
    assert back["DestinationLocation"]["LocationCode"] == "NBO"
    assert "MaxStopsQuantity" not in sent(search)["TravelPreferences"]


def test_one_token_per_provider(sabre_api):
    sabre = provider()
    sabre.search(one_way())
    sabre.search(one_way())
    assert [request.url.path for request in sabre_api.requests] == [
        "/v2/auth/token",
        "/v5/offers/shop",
        "/v5/offers/shop",
    ]


def test_one_way_direct_itinerary(sabre_api):
    direct, _ = provider().search(one_way())
    [segment] = direct.segments
    assert (segment.direction, segment.airline, segment.flight_number, segment.operating_airline) == (
        "outbound",
        "KQ",
        "100",
        None,
    )
    assert (segment.origin, segment.destination) == ("NBO", "LHR")
    # Local times as printed (the offsets dropped), arriving the next day.
    assert (segment.departure_date, segment.departure_time) == (DEC_1, time(23, 55))
    assert (segment.arrival_date, segment.arrival_time) == (date(2026, 12, 2), time(6, 0))
    assert (direct.airline, direct.ticket_class) == ("KQ", "economy")
    assert (direct.net_amount, direct.net_currency) == (Decimal("640.0"), "USD")
    assert (direct.checked_bags, direct.checked_bag_kg, direct.cabin_bag_kg) == (2, None, None)
    # Refundable before departure for a fee; exchangeable before departure for nothing.
    assert (direct.refund_policy, direct.change_policy) == ("with_fee", "free")
    assert direct.fare_type == "unknown"
    assert direct.seats_left == 4
    assert direct.provider_ref == "1"
    # 18:00 on the last ticketing date, Nairobi time.
    assert direct.expires_at == datetime(2026, 11, 20, 15, 0, tzinfo=UTC)


def test_connection_codeshare_bags_and_no_penalty_information(sabre_api):
    _, connecting = provider().search(one_way())
    first, second = connecting.segments
    # The technical stop is not a segment.
    assert [(s.origin, s.destination) for s in connecting.segments] == [("NBO", "DXB"), ("DXB", "LHR")]
    assert (first.airline, first.flight_number, first.operating_airline) == ("EK", "720", None)
    assert (first.arrival_date, first.arrival_time) == (DEC_1, time(16, 20))
    assert (second.airline, second.flight_number, second.operating_airline) == ("KQ", "3110", "EK")
    assert (second.arrival_date, second.arrival_time) == (date(2026, 12, 2), time(1, 55))
    assert connecting.airline == "EK"
    assert (connecting.net_amount, connecting.net_currency) == (Decimal("560.0"), "EUR")
    # A checked weight allowance alone is one bag of that weight; the carry-on allowance is not counted.
    assert (connecting.checked_bags, connecting.checked_bag_kg) == (1, 30)
    assert (connecting.refund_policy, connecting.change_policy) == ("not_allowed", "not_allowed")
    # The fewest seats on any flight; no last ticketing date.
    assert (connecting.seats_left, connecting.expires_at) == (2, None)


def test_return_itinerary(sabre_api):
    sabre_api.reply = itineraries_for("sabre_return.json")
    [fare] = provider().search(one_way(return_date=date(2026, 12, 8)))
    assert [(s.direction, s.flight_number, s.origin, s.destination, s.departure_date) for s in fare.segments] == [
        ("outbound", "100", "NBO", "LHR", DEC_1),
        ("return", "101", "LHR", "NBO", date(2026, 12, 8)),
    ]
    assert (fare.segments[1].arrival_date, fare.segments[1].arrival_time) == (date(2026, 12, 9), time(5, 45))
    assert (fare.net_amount, fare.net_currency) == (Decimal("812.3"), "GBP")
    assert (fare.checked_bags, fare.checked_bag_kg, fare.seats_left) == (1, 23, None)
    # A date without a time: the end of that day, Nairobi time.
    assert fare.expires_at == datetime(2026, 11, 5, 20, 59, tzinfo=UTC)


def test_a_departure_day_adjustment_and_penalties_as_given(sabre_api):
    def edit(data):
        response = data["groupedItineraryResponse"]
        response["legDescs"][1]["schedules"][1]["departureDateAdjustment"] = 1
        info = passenger(data)
        info["fareComponents"][0]["segments"][0]["segment"]["cabinCode"] = "W"
        info["penaltiesInfo"]["penalties"] = [
            {"type": "Refund", "applicability": "Before", "refundable": True, "amount": 0, "currency": "USD"},
            {"type": "Exchange", "applicability": "Before", "changeable": False},
        ]

    sabre_api.reply = itineraries_for("sabre_one_way.json", edit)
    direct, connecting = provider().search(one_way())
    assert direct.ticket_class == "premium_economy"
    assert (direct.refund_policy, direct.change_policy) == ("free", "not_allowed")
    # The second flight leaves the day after the leg's date.
    assert (connecting.segments[1].departure_date, connecting.segments[1].arrival_date) == (
        date(2026, 12, 2),
        date(2026, 12, 3),
    )


def test_error_messages_without_itineraries_are_a_provider_error(sabre_api):
    sabre_api.reply = lambda request: httpx.Response(200, json=recorded("sabre_no_results.json"))
    with pytest.raises(ProviderError) as raised:
        provider().search(one_way())
    assert str(raised.value) == "Sabre error: NO COMPLETE JOURNEY CAN BE BUILT IN IF2/ADVJR1."


def test_no_itineraries_and_no_error_is_an_empty_result(sabre_api):
    def edit(data):
        data["groupedItineraryResponse"]["itineraryGroups"] = []

    sabre_api.reply = itineraries_for("sabre_one_way.json", edit)
    assert provider().search(one_way()) == []


def test_http_errors_refused_tokens_and_unreadable_answers(sabre_api):
    sabre_api.reply = sabre_error
    with pytest.raises(ProviderError, match="^Sabre error 400: Request contains incorrect values in PseudoCityCode$"):
        provider().search(one_way())
    sabre_api.reply = lambda request: httpx.Response(503, text="<html>Service unavailable</html>")
    with pytest.raises(ProviderError, match=r"^Sabre error 503\.$"):
        provider().search(one_way())
    sabre_api.reply = lambda request: httpx.Response(200, text="not json")
    with pytest.raises(ProviderError, match="could not be read"):
        provider().search(one_way())
    sabre_api.token = lambda request: httpx.Response(401, json=recorded("sabre_denied.json"))
    with pytest.raises(ProviderError, match="^Sabre error 401: Credentials are missing"):
        provider().search(one_way())


def test_an_unreadable_price_is_a_provider_error(sabre_api):
    def edit(data):
        itinerary(data, 0)["pricingInformation"][0]["fare"]["totalFare"]["totalPrice"] = "640 dollars"

    sabre_api.reply = itineraries_for("sabre_one_way.json", edit)
    with pytest.raises(ProviderError, match="unreadable price"):
        provider().search(one_way())


def test_a_network_failure_is_a_provider_error(sabre_api):
    def fail(request):
        raise httpx.ConnectError("refused")

    sabre_api.token = fail
    with pytest.raises(ProviderError, match="Sabre could not be reached"):
        provider().search(one_way())


def test_the_connection_test_takes_a_token(sabre_api):
    assert provider().test() == "Connected to Sabre."
    [request] = sabre_api.requests
    assert request.url.path == "/v2/auth/token"


# Sabre in runs


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


def test_sabre_results_are_stored_as_fares(search, route, make_sabre, sabre_api, exchange_rates):
    make_sabre()
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 1, 2, [])
    eur = Fare.objects.get(net_currency="EUR")
    # 560 EUR at 0.92 per USD = 608.695… → 608.70.
    assert (eur.net_amount, eur.net_usd, eur.integration.provider) == (Decimal("560.000"), Decimal("608.70"), "sabre")
    assert eur.fare_key == "EK720@2026-12-01-KQ3110@2026-12-01/economy"
    assert eur.itinerary[1]["operating_airline"] == str(eur.airline.pk)
    usd = Fare.objects.get(net_currency="USD")
    assert (usd.checked_bags, usd.seats_left, usd.provider_ref, usd.fare_type) == (2, 4, "1", "unknown")
    assert usd.fare_key == "KQ100@2026-12-01/economy"


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (
            lambda data: data["groupedItineraryResponse"]["scheduleDescs"][0]["carrier"].update(marketing="ZZ"),
            "airline ZZ is not in the airline list",
        ),
        (
            lambda data: data["groupedItineraryResponse"]["scheduleDescs"][0]["arrival"].update(airport="XXX"),
            "airport XXX is not in the airport list",
        ),
        (
            lambda data: itinerary(data, 0)["pricingInformation"][0]["fare"].update(validatingCarrierCode="ZX"),
            "airline ZX is not in the airline list",
        ),
    ],
)
def test_results_breaking_a_rule_are_skipped_and_counted(search, route, make_sabre, sabre_api, edit, message):
    make_sabre()

    def broken(data):
        only_direct(data)
        edit(data)

    sabre_api.reply = itineraries_for("sabre_one_way.json", broken)
    run = search(route)
    assert run.fares_found == 0 and not Fare.objects.exists()
    [error] = run.errors
    assert error.startswith("Sabre test: skipped, ") and message in error


def test_a_return_route_searches_with_the_stay(search, make_route, make_sabre, sabre_api, exchange_rates):
    make_sabre()
    route = make_route(trip_type="return", stay_nights=7)
    sabre_api.reply = itineraries_for("sabre_return.json")
    run = search(route)
    [fare] = Fare.objects.all()
    assert (run.fares_found, fare.trip_type, fare.net_currency) == (1, "return", "GBP")
    assert fare.fare_key == "KQ100@2026-12-01-KQ101@2026-12-08/economy"


def test_a_sabre_error_is_recorded_and_the_run_goes_on(search, route, make_sabre, integration, sabre_api, duffel_api):
    make_sabre()
    sabre_api.reply = sabre_error
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found) == ("done", 2, 2)
    assert run.errors == ["Sabre test, 01 Dec: Sabre error 400: Request contains incorrect values in PseudoCityCode"]
    assert {fare.integration.provider for fare in Fare.objects.all()} == {"duffel"}


def test_a_route_searches_duffel_and_sabre_and_counts_the_same_flights_once(
    search, route, make_sabre, integration, sabre_api, duffel_api, exchange_rates
):
    make_sabre()
    route.max_per_date = 5
    route.save()
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 2, 4, [])
    # Sabre's KQ 100 at 640 USD beats Duffel's 650 USD; Duffel's connection at 455.50 GBP (576.58 USD) beats
    # Sabre's 560 EUR (608.70 USD).
    picked = Fare.objects.filter(picked=True).order_by("net_usd")
    assert [(f.fare_key, f.integration.provider, f.net_usd) for f in picked] == [
        ("EK720@2026-12-01-KQ3110@2026-12-01/economy", "duffel", Decimal("576.58")),
        ("KQ100@2026-12-01/economy", "sabre", Decimal("640.00")),
    ]


# Re-checking a booking found through Sabre


@pytest.fixture
def sabre_booking(admin_api, customer, route, make_sabre, sabre_api, exchange_rates, search):
    """A requested booking of the offer published from Sabre's KQ 100 fare on 1 December."""
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    route.integrations.set([make_sabre()])
    search(route)
    fare = Fare.objects.get(net_currency="USD")
    body = {"price": "699.00", "valid_until": (TODAY + timedelta(days=7)).isoformat(), "is_public": True}
    response = admin_api.post(f"/api/admin/fares/{fare.id}/publish", body, format="json")
    assert response.status_code == 200, response.data
    sabre_api.requests.clear()
    return create_booking(customer, {"offer": Offer.objects.get(pk=response.data["offer"]).pk, "passenger_count": 1})


def test_a_sabre_booking_is_rechecked(admin_api, sabre_booking, sabre_api):
    response = admin_api.post(f"/api/admin/bookings/{sabre_booking.id}/recheck-fare")
    assert response.status_code == 200, response.data
    data = response.json()
    assert data["found"] is True
    assert (data["fare"]["net_amount"], data["fare"]["net_currency"], data["fare"]["net_usd"]) == (
        "640.000",
        "USD",
        "640.00",
    )
    assert [request.url.path for request in sabre_api.requests] == ["/v2/auth/token", "/v5/offers/shop"]


def test_a_sabre_error_on_recheck_is_a_502(admin_api, sabre_booking, sabre_api):
    sabre_api.reply = sabre_error
    response = admin_api.post(f"/api/admin/bookings/{sabre_booking.id}/recheck-fare")
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Sabre test could not be searched: Sabre error 400: Request contains incorrect values in PseudoCityCode"
    )


# The admin API


def test_sabre_credentials_are_encrypted_at_rest_and_never_returned(admin_api):
    credentials = {"user_id": "7971", "password": "Sb-secret-pw", "pseudo_city_code": "K2RL", "domain": "AA"}
    response = admin_api.post(
        "/api/admin/integrations",
        {"provider": "sabre", "name": "Sabre", "mode": "test", "credentials": credentials},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert "credentials" not in response.data and response.data["provider"] == "sabre"
    integration = Integration.objects.get()
    assert "Sb-secret-pw" not in integration.credentials and "K2RL" not in integration.credentials
    assert integration.get_credentials() == credentials
    assert "credentials" not in admin_api.get("/api/admin/integrations").data[0]


def test_sabre_needs_its_four_credentials(admin_api):
    body = {"provider": "sabre", "name": "Sabre", "mode": "live"}
    response = admin_api.post(
        "/api/admin/integrations",
        {**body, "credentials": {"user_id": "7971", "password": "p", "pseudo_city_code": "K2RL"}},
        format="json",
    )
    assert response.status_code == 400 and response.data["credentials"] == ["Enter the domain."]
    response = admin_api.post("/api/admin/integrations", {**body, "credentials": {"access_token": "x"}}, format="json")
    assert response.status_code == 400 and response.data["credentials"] == ["Enter the user id."]


def test_sabre_test_connection_success_and_failure(admin_api, make_sabre, sabre_api):
    url = f"/api/admin/integrations/{make_sabre().id}/test"
    response = admin_api.post(url)
    assert response.status_code == 200
    assert (response.data["last_test_ok"], response.data["last_test_message"]) == (True, "Connected to Sabre.")

    sabre_api.token = lambda request: httpx.Response(401, json=recorded("sabre_denied.json"))
    response = admin_api.post(url)
    assert response.data["last_test_ok"] is False
    assert response.data["last_test_message"] == (
        "Sabre error 401: Credentials are missing or the syntax is not correct"
    )
