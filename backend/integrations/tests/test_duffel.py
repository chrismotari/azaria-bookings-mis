"""The Duffel provider: requests it sends and how recorded responses map to results."""

import json
from datetime import UTC, date, datetime, time
from decimal import Decimal

import httpx
import pytest

from integrations.providers import ProviderError, SearchRequest, duffel
from integrations.providers.duffel import DuffelProvider

from .conftest import offers_for, recorded

pytestmark = pytest.mark.django_db


def provider():
    return DuffelProvider({"access_token": "duffel_test_secret"}, "test")


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


def test_the_offer_request_sent(duffel_api):
    provider().search(one_way(max_connections=1))
    [request] = duffel_api.requests
    assert request.method == "POST"
    assert request.url.path == "/air/offer_requests"
    assert request.url.params["return_offers"] == "true"
    assert request.headers["Authorization"] == "Bearer duffel_test_secret"
    assert request.headers["Duffel-Version"] == "v2"
    assert json.loads(request.content) == {
        "data": {
            "slices": [{"origin": "NBO", "destination": "LHR", "departure_date": "2026-12-01"}],
            "passengers": [{"type": "adult"}],
            "cabin_class": "economy",
            "max_connections": 1,
        }
    }


def test_a_return_search_sends_two_slices_and_any_connections_leaves_the_limit_out(duffel_api):
    duffel_api.reply = offers_for("duffel_return.json")
    provider().search(one_way(return_date=date(2026, 12, 8)))
    body = json.loads(duffel_api.requests[0].content)["data"]
    assert body["slices"][1] == {"origin": "LHR", "destination": "NBO", "departure_date": "2026-12-08"}
    assert "max_connections" not in body


def test_one_way_direct_offer(duffel_api):
    direct, _ = provider().search(one_way())
    [segment] = direct.segments
    assert (segment.direction, segment.airline, segment.flight_number, segment.operating_airline) == (
        "outbound",
        "KQ",
        "100",
        None,
    )
    assert (segment.origin, segment.destination) == ("NBO", "LHR")
    # Local times as printed, arriving the next day.
    assert (segment.departure_date, segment.departure_time) == (date(2026, 12, 1), time(23, 55))
    assert (segment.arrival_date, segment.arrival_time) == (date(2026, 12, 2), time(6, 0))
    assert direct.airline == "KQ"
    assert direct.ticket_class == "economy"
    assert (direct.net_amount, direct.net_currency) == (Decimal("650.00"), "USD")
    assert (direct.checked_bags, direct.checked_bag_kg, direct.cabin_bag_kg) == (2, None, None)
    # A refund penalty is "with a fee"; a change penalty of zero is free.
    assert (direct.refund_policy, direct.change_policy) == ("with_fee", "free")
    assert direct.fare_type == "public"
    assert direct.seats_left is None
    assert direct.provider_ref == "off_0000AgYrSpqKZx0Q2Wmc9X"
    assert direct.expires_at == datetime(2026, 11, 1, 9, 30, 1, 120000, tzinfo=UTC)


def test_connection_codeshare_bags_conditions_and_currency(duffel_api):
    _, connecting = provider().search(one_way())
    first, second = connecting.segments
    # The technical stop in Mombasa is not a segment.
    assert [(s.origin, s.destination) for s in connecting.segments] == [("NBO", "DXB"), ("DXB", "LHR")]
    assert (first.airline, first.flight_number, first.operating_airline) == ("EK", "720", None)
    assert (second.airline, second.flight_number, second.operating_airline) == ("KQ", "3110", "EK")
    assert connecting.airline == "EK"
    assert (connecting.net_amount, connecting.net_currency) == (Decimal("455.50"), "GBP")
    # One checked bag on every flight.
    assert connecting.checked_bags == 1
    # No refund condition stated: not allowed; a change allowed with an unstated penalty: with a fee.
    assert (connecting.refund_policy, connecting.change_policy) == ("not_allowed", "with_fee")
    assert connecting.fare_type == "private"


def test_return_offer(duffel_api):
    duffel_api.reply = offers_for("duffel_return.json")
    [offer] = provider().search(one_way(return_date=date(2026, 12, 8)))
    assert [(s.direction, s.flight_number, s.origin, s.destination) for s in offer.segments] == [
        ("outbound", "100", "NBO", "LHR"),
        ("return", "101", "LHR", "NBO"),
    ]
    assert offer.segments[1].arrival_date == date(2026, 12, 9)
    assert (offer.net_amount, offer.net_currency) == (Decimal("1012.40"), "EUR")
    assert (offer.refund_policy, offer.change_policy) == ("not_allowed", "with_fee")
    assert offer.checked_bags == 1


def test_an_offer_without_private_fares_listed_has_an_unknown_fare_type(duffel_api):
    data = recorded("duffel_one_way.json")["data"]["offers"][0]
    del data["private_fares"]
    assert duffel.map_offer(data, "economy").fare_type == "unknown"


def test_a_provider_error_names_duffels_message(duffel_api):
    duffel_api.reply = lambda request: httpx.Response(401, json=recorded("duffel_unauthorized.json"))
    with pytest.raises(ProviderError) as raised:
        provider().search(one_way())
    assert str(raised.value) == "Duffel error 401: The access token used is not recognised by our system"


def test_a_network_failure_is_a_provider_error(duffel_api):
    def fail(request):
        raise httpx.ConnectError("refused")

    duffel_api.reply = fail
    with pytest.raises(ProviderError, match="could not be reached"):
        provider().test()


def test_the_connection_test_lists_one_airline(duffel_api):
    duffel_api.reply = lambda request: httpx.Response(200, json={"data": [], "meta": {"limit": 1}})
    assert provider().test() == "Connected to Duffel."
    [request] = duffel_api.requests
    assert (request.method, request.url.path, request.url.params["limit"]) == ("GET", "/air/airlines", "1")
