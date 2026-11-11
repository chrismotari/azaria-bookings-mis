import copy
import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from freezegun import freeze_time

from airlines.models import Airline
from integrations.models import Integration, Route
from integrations.providers import duffel
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
