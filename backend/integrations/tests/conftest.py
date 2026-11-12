import copy
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from xml.etree import ElementTree

import httpx
import pytest
from freezegun import freeze_time

from airlines.models import Airline
from integrations.models import Integration, Route
from integrations.providers import duffel, sabre, travelport
from rates.models import ExchangeRate

FIXTURES = Path(__file__).parent / "fixtures"
# The departure date the recorded responses were searched for.
RECORDED_ON = date(2026, 12, 1)
TODAY = date(2026, 11, 1)


def recorded(name):
    return json.loads((FIXTURES / name).read_text())


def shifted(data, days):
    """The recorded response with every flight moved by days."""
    data = copy.deepcopy(data)
    for offer in data["data"]["offers"]:
        for piece in offer["slices"]:
            for segment in piece["segments"]:
                for key in ("departing_at", "arriving_at"):
                    moved = datetime.fromisoformat(segment[key]) + timedelta(days=days)
                    segment[key] = moved.isoformat()
    return data


def offers_for(name, edit=None):
    """A Duffel reply: the recorded offers moved to the date searched; edit(data) may change them first."""

    def reply(request):
        searched = date.fromisoformat(json.loads(request.content)["data"]["slices"][0]["departure_date"])
        data = shifted(recorded(name), (searched - RECORDED_ON).days)
        if edit:
            edit(data)
        return httpx.Response(200, json=data)

    return reply


class FakeDuffel:
    """Answers Duffel's API from recorded responses; reply(request) -> httpx.Response, set per test."""

    def __init__(self):
        self.requests = []
        self.reply = offers_for("duffel_one_way.json")

    def handle(self, request):
        self.requests.append(request)
        return self.reply(request)


def tp(root, tag):
    """Every element of a uAPI answer with this local name (Air schema)."""
    return list(root.iter(f"{{{travelport.AIR}}}{tag}"))


def solutions_for(name, edit=None):
    """A Travelport reply: the recorded solutions moved to the date searched; edit(root) may change them first."""

    def reply(request):
        searched = date.fromisoformat(re.search(rb'PreferredTime="([0-9-]+)"', request.content).group(1).decode())
        days = (searched - RECORDED_ON).days
        root = ElementTree.fromstring((FIXTURES / name).read_bytes())
        for element in root.iter():
            for key in ("DepartureTime", "ArrivalTime"):
                if key in element.attrib:
                    moved = datetime.fromisoformat(element.get(key)) + timedelta(days=days)
                    element.set(key, moved.isoformat(timespec="milliseconds"))
        if edit:
            edit(root)
        return httpx.Response(200, content=ElementTree.tostring(root), headers={"Content-Type": "text/xml"})

    return reply


def soap_fault(request):
    return httpx.Response(
        500, content=(FIXTURES / "travelport_fault.xml").read_bytes(), headers={"Content-Type": "text/xml"}
    )


class FakeTravelport:
    """Answers uAPI from recorded responses: reply(request) for searches, ping(request) for pings, set per test."""

    def __init__(self):
        self.requests = []
        self.reply = solutions_for("travelport_one_way.xml")
        self.ping = lambda request: httpx.Response(200, content=(FIXTURES / "travelport_ping.xml").read_bytes())

    def handle(self, request):
        self.requests.append(request)
        return (self.ping if request.url.path.endswith("/SystemService") else self.reply)(request)


def itineraries_for(name, edit=None):
    """A Sabre reply: the recorded itineraries moved to the date searched; edit(data) may change them first."""

    def reply(request):
        body = json.loads(request.content)["OTA_AirLowFareSearchRQ"]
        searched = date.fromisoformat(body["OriginDestinationInformation"][0]["DepartureDateTime"][:10])
        data = recorded(name)
        for group in data["groupedItineraryResponse"].get("itineraryGroups") or []:
            for leg in group["groupDescription"]["legDescriptions"]:
                moved = date.fromisoformat(leg["departureDate"]) + (searched - RECORDED_ON)
                leg["departureDate"] = moved.isoformat()
        if edit:
            edit(data)
        return httpx.Response(200, json=data)

    return reply


def sabre_error(request):
    return httpx.Response(400, json=recorded("sabre_bad_request.json"))


class FakeSabre:
    """Answers Sabre's REST API from recorded responses: token(request) and reply(request), set per test."""

    def __init__(self):
        self.requests = []
        self.reply = itineraries_for("sabre_one_way.json")
        self.token = lambda request: httpx.Response(200, json=recorded("sabre_token.json"))

    def handle(self, request):
        self.requests.append(request)
        return (self.token if request.url.path == sabre.TOKEN_PATH else self.reply)(request)


@pytest.fixture(autouse=True)
def _frozen():
    # Noon in Nairobi; the clock runs so that later runs are later.
    with freeze_time("2026-11-01 09:00:00", tick=True):
        yield


@pytest.fixture
def duffel_api(monkeypatch):
    fake = FakeDuffel()
    monkeypatch.setattr(duffel, "transport", httpx.MockTransport(fake.handle))
    return fake


@pytest.fixture
def travelport_api(monkeypatch):
    fake = FakeTravelport()
    monkeypatch.setattr(travelport, "transport", httpx.MockTransport(fake.handle))
    return fake


@pytest.fixture
def sabre_api(monkeypatch):
    fake = FakeSabre()
    monkeypatch.setattr(sabre, "transport", httpx.MockTransport(fake.handle))
    return fake


@pytest.fixture
def make_sabre(db):
    def make(name="Sabre test", **fields):
        integration = Integration(provider="sabre", name=name, mode="test", **fields)
        integration.set_credentials(
            {"user_id": "7971", "password": "Sb-secret", "pseudo_city_code": "K2RL", "domain": "AA"}
        )
        integration.save()
        return integration

    return make


@pytest.fixture
def make_travelport(db):
    def make(name="Travelport test", **fields):
        integration = Integration(provider="travelport", name=name, mode="test", **fields)
        integration.set_credentials(
            {"username": "uAPI2514620686-0edbb8e4", "password": "Tp-secret", "target_branch": "P7141733"}
        )
        integration.save()
        return integration

    return make


@pytest.fixture
def carriers(db):
    names = {"KQ": "Kenya Airways", "EK": "Emirates", "BA": "British Airways"}
    return {
        code: Airline.objects.get_or_create(iata_code=code, defaults={"name": name})[0] for code, name in names.items()
    }


@pytest.fixture
def exchange_rates(db):
    """GBP and EUR rates from two days ago."""
    on = TODAY - timedelta(days=2)
    return {
        currency: ExchangeRate.objects.create(currency=currency, units_per_usd=Decimal(units), date=on, source="feed")
        for currency, units in {"GBP": "0.79000000", "EUR": "0.92000000"}.items()
    }


@pytest.fixture
def make_integration(db):
    def make(name="Duffel test", **fields):
        integration = Integration(provider="duffel", name=name, mode="test", **fields)
        integration.set_credentials({"access_token": "duffel_test_secret"})
        integration.save()
        return integration

    return make


@pytest.fixture
def integration(make_integration):
    return make_integration()


@pytest.fixture
def make_route(airports, carriers):
    def make(**fields):
        return Route.objects.create(origin=airports["NBO"], destination=airports["LHR"], **fields)

    return make


@pytest.fixture
def route(make_route):
    return make_route()


def set_window(route, date_from, date_to):
    """Gives the route a fixed window of departure dates."""
    route.window, route.window_from, route.window_to = "fixed", date_from, date_to
    route.days_ahead_from = route.days_ahead_to = None
    route.save()
