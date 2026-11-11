"""The Travelport (uAPI) provider: requests it sends, how recorded responses map to results, and faults; Travelport
integrations in runs, re-checks and the admin API, alongside Duffel."""

import base64
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from xml.etree import ElementTree

import httpx
import pytest

from bookings.services import create_booking
from catalog.models import Offer
from core.models import AppSettings
from integrations.models import Fare, Integration, SearchRun
from integrations.providers import ProviderError, SearchRequest, travelport
from integrations.providers.travelport import TravelportProvider

from .conftest import FIXTURES, TODAY, set_window, soap_fault, solutions_for, tp

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)

CREDENTIALS = {"username": "uAPI2514620686-0edbb8e4", "password": "Tp-secret", "target_branch": "P7141733"}


def provider(mode="test"):
    return TravelportProvider(CREDENTIALS, mode)


def one_way(**fields):
    return SearchRequest(
        **{
            "origin": "NBO",
            "destination": "LHR",
            "departure_date": date(2026, 12, 1),
            "return_date": None,
            "cabin": "economy",
            "max_connections": None,
            **fields,
        }
    )


def sent(request):
    """The request element inside the SOAP body sent."""
    envelope = ElementTree.fromstring(request.content)
    return envelope.find(f"{{{travelport.SOAP}}}Body")[0]


def air(tag):
    return f"{{{travelport.AIR}}}{tag}"


def common(tag):
    return f"{{{travelport.COMMON}}}{tag}"


def test_the_low_fare_search_sent(travelport_api):
    provider().search(one_way(max_connections=1, cabin="business"))
    [request] = travelport_api.requests
    assert request.method == "POST"
    assert str(request.url) == "https://emea.universal-api.pp.travelport.com/B2BGateway/connect/uAPI/AirService"
    scheme, token = request.headers["Authorization"].split()
    assert scheme == "Basic"
    assert base64.b64decode(token).decode() == "Universal API/uAPI2514620686-0edbb8e4:Tp-secret"
    assert request.headers["Content-Type"].startswith("text/xml")
    search = sent(request)
    assert search.tag == air("LowFareSearchReq")
    assert (search.get("TargetBranch"), search.get("SolutionResult")) == ("P7141733", "true")
    assert search.find(common("BillingPointOfSaleInfo")).get("OriginApplication") == "UAPI"
    [leg] = search.findall(air("SearchAirLeg"))
    assert leg.find(f"{air('SearchOrigin')}/{common('Airport')}").get("Code") == "NBO"
    assert leg.find(f"{air('SearchDestination')}/{common('Airport')}").get("Code") == "LHR"
    assert leg.find(air("SearchDepTime")).get("PreferredTime") == "2026-12-01"
    modifiers = leg.find(air("AirLegModifiers"))
    assert modifiers.find(f"{air('PermittedCabins')}/{common('CabinClass')}").get("Type") == "Business"
    assert modifiers.find(air("FlightType")).get("MaxConnections") == "1"
    assert (
        search.find(f"{air('AirSearchModifiers')}/{air('PreferredProviders')}/{common('Provider')}").get("Code") == "1G"
    )
    assert search.find(common("SearchPassenger")).get("Code") == "ADT"


def test_a_return_search_sends_two_legs_any_connections_no_limit_and_live_mode_production(travelport_api):
    travelport_api.reply = solutions_for("travelport_return.xml")
    provider("live").search(one_way(return_date=date(2026, 12, 8)))
    [request] = travelport_api.requests
    assert str(request.url) == "https://emea.universal-api.travelport.com/B2BGateway/connect/uAPI/AirService"
    outbound, back = sent(request).findall(air("SearchAirLeg"))
    assert outbound.find(air("SearchDepTime")).get("PreferredTime") == "2026-12-01"
    assert back.find(f"{air('SearchOrigin')}/{common('Airport')}").get("Code") == "LHR"
    assert back.find(f"{air('SearchDestination')}/{common('Airport')}").get("Code") == "NBO"
    assert back.find(air("SearchDepTime")).get("PreferredTime") == "2026-12-08"
    assert outbound.find(f"{air('AirLegModifiers')}/{air('FlightType')}") is None


def test_one_way_direct_solution(travelport_api):
    direct, _ = provider().search(one_way())
    [segment] = direct.segments
    assert (segment.direction, segment.airline, segment.flight_number, segment.operating_airline) == (
        "outbound",
        "KQ",
        "100",
        None,
    )
    assert (segment.origin, segment.destination) == ("NBO", "LHR")
    # Local times as printed (the offsets are dropped), arriving the next day.
    assert (segment.departure_date, segment.departure_time) == (date(2026, 12, 1), time(23, 55))
    assert (segment.arrival_date, segment.arrival_time) == (date(2026, 12, 2), time(6, 0))
    assert direct.airline == "KQ"
    assert direct.ticket_class == "economy"
    # Priced in euros.
    assert (direct.net_amount, direct.net_currency) == (Decimal("560.00"), "EUR")
    assert (direct.checked_bags, direct.checked_bag_kg, direct.cabin_bag_kg) == (2, 23, None)
    # Refundable with a penalty: with a fee; exchangeable with a zero penalty: free.
    assert (direct.refund_policy, direct.change_policy) == ("with_fee", "free")
    assert direct.fare_type == "public"
    assert direct.seats_left == 4
    assert direct.provider_ref == "SOL1xKQ100"
    assert direct.expires_at == datetime(2026, 11, 3, 20, 59, tzinfo=timezone.utc)


def test_connection_codeshare_bags_conditions_and_private_fare(travelport_api):
    _, connecting = provider().search(one_way())
    first, second = connecting.segments
    # The technical stop in Mombasa is not a segment.
    assert [(s.origin, s.destination) for s in connecting.segments] == [("NBO", "DXB"), ("DXB", "LHR")]
    assert (first.airline, first.flight_number, first.operating_airline) == ("EK", "720", None)
    assert (first.arrival_date, first.arrival_time) == (date(2026, 12, 1), time(16, 20))
    assert (second.airline, second.flight_number, second.operating_airline) == ("KQ", "3110", "EK")
    assert connecting.airline == "EK"
    assert (connecting.net_amount, connecting.net_currency) == (Decimal("610.00"), "USD")
    # A weight allowance alone is one bag of that weight.
    assert (connecting.checked_bags, connecting.checked_bag_kg) == (1, 30)
    # Not refundable; exchangeable for a percentage.
    assert (connecting.refund_policy, connecting.change_policy) == ("not_allowed", "with_fee")
    assert connecting.fare_type == "private"
    # The fewest seats on any flight.
    assert connecting.seats_left == 2


def test_return_solution(travelport_api):
    travelport_api.reply = solutions_for("travelport_return.xml")
    [solution] = provider().search(one_way(return_date=date(2026, 12, 8)))
    assert [(s.direction, s.flight_number, s.origin, s.destination) for s in solution.segments] == [
        ("outbound", "100", "NBO", "LHR"),
        ("return", "101", "LHR", "NBO"),
    ]
    assert (solution.segments[1].arrival_date, solution.segments[1].arrival_time) == (date(2026, 12, 9), time(5, 45))
    assert (solution.net_amount, solution.net_currency) == (Decimal("812.30"), "GBP")
    # Neither refundable nor exchangeable stated.
    assert (solution.refund_policy, solution.change_policy) == ("not_allowed", "not_allowed")
    assert (solution.checked_bags, solution.checked_bag_kg) == (1, 23)
    # No booking counts given.
    assert solution.seats_left is None


def test_cabins_and_penalties_as_given(travelport_api):
    def edit(root):
        tp(root, "BookingInfo")[0].set("CabinClass", "PremiumEconomy")
        tp(root, "CancelPenalty")[0].find(air("Amount")).text = "EUR0.00"
        del tp(root, "FareInfo")[0].find(air("BaggageAllowance")).find(air("MaxWeight")).attrib["Value"]

    travelport_api.reply = solutions_for("travelport_one_way.xml", edit)
    direct, _ = provider().search(one_way())
    assert direct.ticket_class == "premium_economy"
    assert direct.refund_policy == "free"
    # Pieces without a stated weight.
    assert (direct.checked_bags, direct.checked_bag_kg) == (2, None)


def test_no_solutions_is_an_empty_result(travelport_api):
    def edit(root):
        response = tp(root, "LowFareSearchRsp")[0]
        for solution in tp(root, "AirPricingSolution"):
            response.remove(solution)

    travelport_api.reply = solutions_for("travelport_one_way.xml", edit)
    assert provider().search(one_way()) == []


def test_a_soap_fault_is_a_provider_error(travelport_api):
    travelport_api.reply = soap_fault
    with pytest.raises(ProviderError) as raised:
        provider().search(one_way())
    assert str(raised.value) == "Travelport error: Target branch P7999999 is not authorised for this user."


def test_a_fault_without_details_names_the_fault(travelport_api):
    content = (FIXTURES / "travelport_fault.xml").read_text()
    start, end = content.index("<detail>"), content.index("</detail>") + len("</detail>")
    travelport_api.reply = lambda request: httpx.Response(500, content=content[:start] + content[end:])
    with pytest.raises(ProviderError, match="^Travelport error: Unable to process the request$"):
        provider().search(one_way())


def test_rejected_credentials_and_unreadable_answers(travelport_api):
    travelport_api.reply = lambda request: httpx.Response(401, text="Unauthorized")
    with pytest.raises(ProviderError, match="username or password was not accepted"):
        provider().search(one_way())
    travelport_api.reply = lambda request: httpx.Response(503, text="<html>Service unavailable</html>")
    with pytest.raises(ProviderError, match=r"^Travelport error 503\.$"):
        provider().search(one_way())
    travelport_api.reply = lambda request: httpx.Response(200, text="not xml")
    with pytest.raises(ProviderError, match="could not be read"):
        provider().search(one_way())


def test_an_unreadable_price_is_a_provider_error(travelport_api):
    travelport_api.reply = solutions_for(
        "travelport_one_way.xml", lambda root: tp(root, "AirPricingSolution")[0].set("TotalPrice", "560 euros")
    )
    with pytest.raises(ProviderError, match="unreadable price"):
        provider().search(one_way())


def test_a_network_failure_is_a_provider_error(travelport_api):
    def fail(request):
        raise httpx.ConnectError("refused")

    travelport_api.reply = fail
    with pytest.raises(ProviderError, match="Travelport could not be reached"):
        provider().search(one_way())


def test_the_connection_test_pings_the_system_service(travelport_api):
    assert provider().test() == "Connected to Travelport."
    [request] = travelport_api.requests
    assert str(request.url) == "https://emea.universal-api.pp.travelport.com/B2BGateway/connect/uAPI/SystemService"
    ping = sent(request)
    assert ping.tag == f"{{{travelport.SYSTEM}}}PingReq"
    assert ping.get("TargetBranch") == "P7141733"


# Travelport in runs


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


def only_direct(root):
    """Keeps the recorded KQ 100 solution only."""
    response = tp(root, "LowFareSearchRsp")[0]
    response.remove(tp(root, "AirPricingSolution")[1])


def kq100(root):
    return [s for s in tp(root, "AirSegment") if s.get("FlightNumber") == "100"][0]


def test_travelport_results_are_stored_as_fares(search, route, make_travelport, travelport_api, exchange_rates):
    make_travelport()
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 1, 2, [])
    eur = Fare.objects.get(net_currency="EUR")
    # 560 EUR at 0.92 per USD = 608.695… → 608.70.
    assert (eur.net_amount, eur.net_usd, eur.integration.provider) == (
        Decimal("560.000"),
        Decimal("608.70"),
        "travelport",
    )
    assert (eur.checked_bags, eur.checked_bag_kg, eur.seats_left, eur.provider_ref) == (2, 23, 4, "SOL1xKQ100")
    assert eur.fare_key == "KQ100@2026-12-01/economy"
    usd = Fare.objects.get(net_currency="USD")
    assert usd.fare_key == "EK720@2026-12-01-KQ3110@2026-12-01/economy"
    assert usd.itinerary[1]["operating_airline"] == str(usd.airline.pk)


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda root: kq100(root).set("Carrier", "ZZ"), "airline ZZ is not in the airline list"),
        (
            lambda root: ElementTree.SubElement(kq100(root), air("CodeshareInfo"), {"OperatingCarrier": "ZY"}),
            "airline ZY is not in the airline list",
        ),
        (
            lambda root: tp(root, "AirPricingInfo")[0].set("PlatingCarrier", "ZX"),
            "airline ZX is not in the airline list",
        ),
        (lambda root: kq100(root).set("Destination", "XXX"), "airport XXX is not in the airport list"),
        (lambda root: kq100(root).set("FlightNumber", "12345"), "unusable flight number"),
        # Lands before it leaves (more than a day earlier).
        (
            lambda root: kq100(root).set("ArrivalTime", "2026-11-29T06:00:00.000+00:00"),
            "the arrival date must be between one day before and two days after the departure",
        ),
        # Ends somewhere other than the route's destination.
        (lambda root: kq100(root).set("Destination", "DXB"), "must arrive at LHR"),
        (
            lambda root: (
                tp(root, "FareInfo")[0]
                .find(air("BaggageAllowance"))
                .find(air("NumberOfPieces"))
                .__setattr__("text", "4")
            ),
            "more than 3 checked bags",
        ),
        (lambda root: tp(root, "BookingInfo")[0].set("CabinClass", "Steerage"), "unknown cabin steerage"),
    ],
)
def test_results_breaking_a_rule_are_skipped_and_counted(search, route, make_travelport, travelport_api, edit, message):
    make_travelport()

    def broken(root):
        only_direct(root)
        edit(root)

    travelport_api.reply = solutions_for("travelport_one_way.xml", broken)
    run = search(route)
    assert run.fares_found == 0 and not Fare.objects.exists()
    assert run.status == "done"
    [error] = run.errors
    assert error.startswith("Travelport test: skipped, ") and message in error


def test_a_return_trip_on_a_one_way_route_is_skipped(search, route, make_travelport, travelport_api):
    make_travelport()
    travelport_api.reply = solutions_for("travelport_return.xml")
    run = search(route)
    assert run.errors == ["Travelport test: skipped, the trip type does not match the route"]


def test_an_inactive_airline_is_skipped(search, route, make_travelport, travelport_api, carriers):
    make_travelport()
    travelport_api.reply = solutions_for("travelport_one_way.xml", only_direct)
    carriers["KQ"].is_active = False
    carriers["KQ"].save()
    run = search(route)
    assert run.errors == ["Travelport test: skipped, Outbound flight 1: Kenya Airways is no longer active"]


def test_a_return_route_searches_with_the_stay(search, make_route, make_travelport, travelport_api, exchange_rates):
    make_travelport()
    route = make_route(trip_type="return", stay_nights=7)
    travelport_api.reply = solutions_for("travelport_return.xml")
    run = search(route)
    [fare] = Fare.objects.all()
    assert (run.fares_found, fare.trip_type, fare.net_currency, fare.no_rate) == (1, "return", "GBP", False)
    assert [s["direction"] for s in fare.itinerary] == ["outbound", "return"]
    assert fare.fare_key == "KQ100@2026-12-01-KQ101@2026-12-08/economy"


def test_a_soap_fault_is_recorded_and_the_run_goes_on(
    search, route, make_travelport, integration, travelport_api, duffel_api
):
    make_travelport()
    travelport_api.reply = soap_fault
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found) == ("done", 2, 2)
    assert run.errors == [
        "Travelport test, 01 Dec: Travelport error: Target branch P7999999 is not authorised for this user."
    ]
    assert {fare.integration.provider for fare in Fare.objects.all()} == {"duffel"}


def test_a_route_searches_duffel_and_travelport_and_counts_the_same_flights_once(
    search, route, make_travelport, integration, travelport_api, duffel_api, exchange_rates
):
    make_travelport()
    route.max_per_date = 5
    route.save()
    run = search(route)
    assert (run.status, run.searches_made, run.fares_found, run.errors) == ("done", 2, 4, [])
    assert len(duffel_api.requests) == len(travelport_api.requests) == 1
    # Both found KQ 100 and EK 720 + KQ 3110: Travelport's KQ 100 at 560 EUR (608.70 USD) beats Duffel's 650 USD,
    # and Duffel's connection at 455.50 GBP (576.58 USD) beats Travelport's 610 USD.
    picked = Fare.objects.filter(picked=True).order_by("net_usd")
    assert [(f.fare_key, f.integration.provider, f.net_usd) for f in picked] == [
        ("EK720@2026-12-01-KQ3110@2026-12-01/economy", "duffel", Decimal("576.58")),
        ("KQ100@2026-12-01/economy", "travelport", Decimal("608.70")),
    ]


def test_only_the_routes_chosen_integration_is_searched(
    search, route, make_travelport, integration, travelport_api, duffel_api
):
    route.integrations.set([make_travelport()])
    run = search(route)
    assert run.searches_made == 1 and duffel_api.requests == []
    assert {fare.integration.provider for fare in Fare.objects.all()} == {"travelport"}


# Re-checking a booking found through Travelport


@pytest.fixture
def travelport_booking(admin_api, customer, route, make_travelport, travelport_api, exchange_rates, search):
    """A requested booking of the offer published from Travelport's KQ 100 fare on 1 December."""
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    route.integrations.set([make_travelport()])
    search(route)
    fare = Fare.objects.get(net_currency="EUR")
    body = {"price": "699.00", "valid_until": (TODAY + timedelta(days=7)).isoformat(), "is_public": True}
    response = admin_api.post(f"/api/admin/fares/{fare.id}/publish", body, format="json")
    assert response.status_code == 200, response.data
    travelport_api.requests.clear()
    return create_booking(customer, {"offer": Offer.objects.get(pk=response.data["offer"]).pk, "passenger_count": 1})


def test_a_travelport_booking_is_rechecked(admin_api, travelport_booking, travelport_api):
    response = admin_api.post(f"/api/admin/bookings/{travelport_booking.id}/recheck-fare")
    assert response.status_code == 200, response.data
    data = response.json()
    assert data["found"] is True
    assert (data["fare"]["net_amount"], data["fare"]["net_currency"], data["fare"]["net_usd"]) == (
        "560.000",
        "EUR",
        "608.70",
    )
    assert len(travelport_api.requests) == 1


def test_a_travelport_fault_on_recheck_is_a_502(admin_api, travelport_booking, travelport_api):
    travelport_api.reply = soap_fault
    response = admin_api.post(f"/api/admin/bookings/{travelport_booking.id}/recheck-fare")
    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Travelport test could not be searched: "
        "Travelport error: Target branch P7999999 is not authorised for this user."
    )


# The admin API


def test_travelport_credentials_are_encrypted_at_rest_and_never_returned(admin_api):
    credentials = {"username": "uAPI2514620686-0edbb8e4", "password": "Tp-secret-pw", "target_branch": "P7141733"}
    response = admin_api.post(
        "/api/admin/integrations",
        {"provider": "travelport", "name": "Travelport", "mode": "test", "credentials": credentials},
        format="json",
    )
    assert response.status_code == 201, response.data
    assert "credentials" not in response.data and response.data["provider"] == "travelport"
    integration = Integration.objects.get()
    for secret in credentials.values():
        assert secret not in integration.credentials
    assert integration.get_credentials() == credentials
    listed = admin_api.get("/api/admin/integrations").data
    assert "credentials" not in listed[0]
    assert "credentials" not in admin_api.get(f"/api/admin/integrations/{integration.id}").data


def test_travelport_needs_its_three_credentials(admin_api):
    body = {"provider": "travelport", "name": "Travelport", "mode": "live"}
    response = admin_api.post(
        "/api/admin/integrations", {**body, "credentials": {"username": "u", "password": "p"}}, format="json"
    )
    assert response.status_code == 400 and response.data["credentials"] == ["Enter the target branch."]
    # An access token alone is Duffel's, not Travelport's.
    response = admin_api.post("/api/admin/integrations", {**body, "credentials": {"access_token": "x"}}, format="json")
    assert response.status_code == 400 and response.data["credentials"] == ["Enter the username."]


def test_replacing_travelport_credentials_keeps_only_its_fields(admin_api, make_travelport):
    integration = make_travelport()
    new = {"username": "uAPI-new", "password": "new-pw", "target_branch": "P7000001", "access_token": "ignored"}
    response = admin_api.patch(f"/api/admin/integrations/{integration.id}", {"credentials": new}, format="json")
    assert response.status_code == 200
    integration.refresh_from_db()
    assert integration.get_credentials() == {"username": "uAPI-new", "password": "new-pw", "target_branch": "P7000001"}


def test_travelport_test_connection_success_and_failure(admin_api, make_travelport, travelport_api):
    url = f"/api/admin/integrations/{make_travelport().id}/test"
    response = admin_api.post(url)
    assert response.status_code == 200
    assert (response.data["last_test_ok"], response.data["last_test_message"]) == (True, "Connected to Travelport.")
    [ping] = travelport_api.requests
    assert ping.url.path.endswith("/SystemService")
    assert base64.b64decode(ping.headers["Authorization"].split()[1]).decode() == (
        "Universal API/uAPI2514620686-0edbb8e4:Tp-secret"
    )

    travelport_api.ping = soap_fault
    response = admin_api.post(url)
    assert response.status_code == 200
    assert response.data["last_test_ok"] is False
    assert response.data["last_test_message"] == (
        "Travelport error: Target branch P7999999 is not authorised for this user."
    )
