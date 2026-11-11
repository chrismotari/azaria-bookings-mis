"""Exchange rates: conversion, the daily feed and the platform's rates screen."""

import json
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from freezegun import freeze_time
from rest_framework.test import APIClient

import rates
from rates import tasks
from rates.models import ExchangeRate

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 1)
FEED = json.loads((Path(__file__).parent / "fixtures" / "exchange_rates.json").read_text())


@pytest.fixture(autouse=True)
def _frozen():
    # Noon in Nairobi.
    with freeze_time("2026-11-01 09:00:00"):
        yield


def rate(currency, units, on, source="feed"):
    return ExchangeRate.objects.create(currency=currency, units_per_usd=Decimal(units), date=on, source=source)


@pytest.fixture
def feed(monkeypatch, settings):
    """The feed answers with the recorded response; returns the requests it received."""
    settings.EXCHANGE_RATES_URL = "https://rates.example/v6/latest/USD"
    received = []

    def handle(request):
        received.append(request)
        return httpx.Response(200, json=FEED)

    monkeypatch.setattr(tasks, "transport", httpx.MockTransport(handle))
    return received


# Conversion


def test_usd_is_always_one():
    assert rates.convert(Decimal("100.005"), "usd", on=TODAY) == rates.Conversion(
        Decimal("100.01"), Decimal(1), TODAY, False
    )


@pytest.mark.parametrize(
    ("amount", "units", "usd"),
    [
        ("100.00", "0.80000000", "125.00"),
        # 0.10 ÷ 0.8 = 0.125, half up to 0.13.
        ("0.10", "0.80000000", "0.13"),
        ("1000", "129.25000000", "7.74"),
        ("455.50", "0.79000000", "576.58"),
    ],
)
def test_rounding_half_up_to_the_cent(amount, units, usd):
    rate("XYZ", units, TODAY)
    assert rates.convert(Decimal(amount), "XYZ", on=TODAY).usd == Decimal(usd)


def test_the_latest_rate_on_or_before_the_date():
    rate("EUR", "0.90", TODAY - timedelta(days=2))
    rate("EUR", "0.95", TODAY - timedelta(days=1))
    rate("EUR", "0.50", TODAY + timedelta(days=1))
    conversion = rates.convert(Decimal("95"), "EUR", on=TODAY)
    assert (conversion.usd, conversion.rate, conversion.rate_date, conversion.stale) == (
        Decimal("100.00"),
        Decimal("0.95"),
        TODAY - timedelta(days=1),
        False,
    )
    assert rates.convert(Decimal("90"), "EUR", on=TODAY - timedelta(days=2)).usd == Decimal("100.00")


def test_no_rate_at_all_raises():
    rate("EUR", "0.90", TODAY + timedelta(days=1))
    with pytest.raises(rates.NoRate):
        rates.convert(Decimal("1"), "EUR", on=TODAY)
    with pytest.raises(rates.NoRate):
        rates.convert(Decimal("1"), "GBP", on=TODAY)


def test_a_rate_older_than_three_days_is_used_but_stale():
    rate("GBP", "0.80", TODAY - timedelta(days=3))
    assert rates.convert(Decimal("8"), "GBP", on=TODAY).stale is False
    conversion = rates.convert(Decimal("8"), "GBP", on=TODAY + timedelta(days=1))
    assert (conversion.usd, conversion.stale) == (Decimal("10.00"), True)


# The feed


def test_the_feed_task_stores_todays_rates(feed):
    assert tasks.fetch_exchange_rates.delay().get() == 5
    assert str(feed[0].url) == "https://rates.example/v6/latest/USD"
    stored = {r.currency: r for r in ExchangeRate.objects.all()}
    assert set(stored) == {"EUR", "GBP", "KES", "AED", "JPY"}
    assert (stored["KES"].units_per_usd, stored["KES"].date, stored["KES"].source) == (Decimal("129.25"), TODAY, "feed")
    assert stored["JPY"].units_per_usd == Decimal("151.873")
    # Running again the same day replaces the day's feed rates rather than adding rows.
    tasks.fetch_exchange_rates.delay().get()
    assert ExchangeRate.objects.count() == 5


def test_a_manual_rate_survives_the_feed(feed):
    rate("KES", "130.00", TODAY, source="manual")
    rate("EUR", "0.80", TODAY - timedelta(days=1), source="manual")
    assert tasks.fetch_exchange_rates() == 4
    assert ExchangeRate.objects.get(currency="KES", date=TODAY).units_per_usd == Decimal("130.00")
    # A manual rate only holds its own day.
    assert ExchangeRate.objects.get(currency="EUR", date=TODAY).source == "feed"


def test_a_failed_feed_stores_nothing(monkeypatch):
    monkeypatch.setattr(
        tasks,
        "transport",
        httpx.MockTransport(lambda r: httpx.Response(200, json={"result": "error", "error-type": "unknown-code"})),
    )
    with pytest.raises(ValueError, match="unknown-code"):
        tasks.fetch_exchange_rates()
    assert not ExchangeRate.objects.exists()


# The platform's screen


@pytest.fixture
def platform():
    from tenants.tests.test_platform import platform_user, root_client

    client = root_client()
    client.force_authenticate(platform_user())
    return client


def test_the_latest_rate_per_currency_with_staleness(platform):
    rate("GBP", "0.79", TODAY - timedelta(days=1))
    rate("GBP", "0.78", TODAY - timedelta(days=5))
    rate("KES", "129.00", TODAY - timedelta(days=4))
    response = platform.get("/api/platform/exchange-rates")
    assert response.status_code == 200
    assert [(r["currency"], r["units_per_usd"], r["date"], r["stale"]) for r in response.data] == [
        ("GBP", "0.79000000", "2026-10-31", False),
        ("KES", "129.00000000", "2026-10-28", True),
    ]


def test_a_manual_rate_for_today(platform):
    rate("KES", "129.00", TODAY)
    response = platform.post(
        "/api/platform/exchange-rates", {"currency": "kes", "units_per_usd": "131.5"}, format="json"
    )
    assert response.status_code == 201
    assert (response.data["currency"], response.data["source"], response.data["date"]) == (
        "KES",
        "manual",
        "2026-11-01",
    )
    assert ExchangeRate.objects.get(currency="KES").units_per_usd == Decimal("131.5")
    for body in (
        {"currency": "USD", "units_per_usd": "1"},
        {"currency": "KE", "units_per_usd": "1"},
        {"currency": "KES", "units_per_usd": "0"},
    ):
        assert platform.post("/api/platform/exchange-rates", body, format="json").status_code == 400


def test_only_the_owner_sees_rates(admin_api):
    assert APIClient(HTTP_HOST="localhost").get("/api/platform/exchange-rates").status_code == 401
    # On an agency host there is no such endpoint.
    assert admin_api.get("/api/platform/exchange-rates").status_code == 404
