"""Route schedules and windows, scheduled runs, refreshing published offers and auto-publishing."""

from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
from django.db import connection
from django.utils import timezone
from freezegun import freeze_time

from catalog.models import Offer
from integrations import services, tasks
from integrations.models import Fare, SearchRun
from rates.models import ExchangeRate
from tenants.models import Tenant

from .conftest import TODAY, offers_for, recorded, set_window

pytestmark = pytest.mark.django_db

DEC_1 = date(2026, 12, 1)
# Monday 2 November 2026 in Nairobi (UTC+3).
MONDAY_0130 = "2026-11-01 22:30:00"
MONDAY_0200 = "2026-11-01 23:00:00"


def set_allowance(value):
    Tenant.objects.filter(schema_name=connection.schema_name).update(monthly_search_allowance=value)


def scheduled(route, schedule="daily", weekday=None, days=(30, 30)):
    route.schedule, route.schedule_weekday = schedule, weekday
    route.window, route.window_from, route.window_to = "rolling", None, None
    route.days_ahead_from, route.days_ahead_to = days
    route.save()
    return route


@pytest.fixture
def due(django_capture_on_commit_callbacks):
    """Runs the hourly beat task at a time (UTC), running the queued runs at once; returns how many started."""

    def run(at):
        with freeze_time(at), django_capture_on_commit_callbacks(execute=True):
            return tasks.run_due_route_searches()

    return run


@pytest.fixture
def search(admin_api, django_capture_on_commit_callbacks):
    """Search now on the route over 1 December, running the run at once."""

    def run(route):
        set_window(route, DEC_1, DEC_1)
        with django_capture_on_commit_callbacks(execute=True):
            response = admin_api.post(f"/api/admin/routes/{route.id}/search")
        assert response.status_code == 201, response.data
        return SearchRun.objects.get(pk=response.data["id"])

    return run


def publish(admin_api, fare, price="699.00"):
    body = {"price": price, "valid_until": (TODAY + timedelta(days=7)).isoformat(), "is_public": True}
    response = admin_api.post(f"/api/admin/fares/{fare.id}/publish", body, format="json")
    assert response.status_code == 200, response.data
    return Offer.objects.get(pk=response.data["offer"])


def gbp_amount(amount):
    """The recorded reply with the GBP fare (EK 720) priced at amount."""

    def edit(data):
        data["data"]["offers"][1]["total_amount"] = amount

    return offers_for("duffel_one_way.json", edit)


# Schedules and windows on routes


def test_a_route_keeps_its_schedule_window_and_auto_publish(admin_api, airports, integration):
    body = {"origin": "NBO", "destination": "LHR", "ticket_class": "economy"}
    data = admin_api.post("/api/admin/routes", body, format="json").data
    assert (data["schedule"], data["schedule_weekday"], data["auto_publish"]) == ("manual", None, False)
    assert (data["window"], data["days_ahead_from"], data["days_ahead_to"]) == ("rolling", 1, 30)

    url = f"/api/admin/routes/{data['id']}"
    changed = {"schedule": "weekly", "schedule_weekday": 2, "window": "fixed", "window_from": "2026-12-01"}
    response = admin_api.patch(url, {**changed, "window_to": "2026-12-31", "auto_publish": True}, format="json")
    assert response.status_code == 200, response.data
    data = response.data
    assert (data["schedule"], data["schedule_weekday"], data["auto_publish"]) == ("weekly", 2, True)
    assert (data["window_from"], data["window_to"], data["days_ahead_from"], data["days_ahead_to"]) == (
        "2026-12-01",
        "2026-12-31",
        None,
        None,
    )

    # Back to a daily, rolling route: the weekday and fixed dates go.
    response = admin_api.patch(
        url, {"schedule": "daily", "window": "rolling", "days_ahead_from": 0, "days_ahead_to": 60}, format="json"
    )
    data = response.data
    assert (data["schedule_weekday"], data["window_from"], data["window_to"]) == (None, None, None)
    assert (data["days_ahead_from"], data["days_ahead_to"]) == (0, 60)


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"schedule": "weekly"}, "schedule_weekday"),
        ({"schedule": "weekly", "schedule_weekday": 7}, "schedule_weekday"),
        ({"window": "fixed", "window_to": "2026-12-01"}, "window_from"),
        ({"window": "fixed", "window_from": "2026-12-01"}, "window_to"),
        ({"window": "fixed", "window_from": "2026-12-02", "window_to": "2026-12-01"}, "window_to"),
        # 61 departure dates.
        ({"window": "fixed", "window_from": "2026-12-01", "window_to": "2027-01-30"}, "window_to"),
        ({"window": "fixed", "window_from": "2026-10-01", "window_to": "2026-10-31"}, "window_to"),
        ({"days_ahead_from": 10, "days_ahead_to": 9}, "days_ahead_to"),
        ({"days_ahead_from": 5, "days_ahead_to": 66}, "days_ahead_to"),
        ({"days_ahead_from": -1}, "days_ahead_from"),
        ({"days_ahead_to": None}, "days_ahead_to"),
    ],
)
def test_schedule_and_window_validation(admin_api, airports, body, field):
    response = admin_api.post(
        "/api/admin/routes", {"origin": "NBO", "destination": "LHR", "ticket_class": "economy", **body}, format="json"
    )
    assert response.status_code == 400 and field in response.data


def test_a_fixed_window_of_60_days_is_allowed(admin_api, airports):
    body = {"origin": "NBO", "destination": "LHR", "ticket_class": "economy", "window": "fixed"}
    response = admin_api.post(
        "/api/admin/routes", {**body, "window_from": "2026-12-01", "window_to": "2027-01-29"}, format="json"
    )
    assert response.status_code == 201, response.data


# Search now over the window


def test_search_now_searches_the_rolling_window_from_today(admin_api, route, integration, duffel_api):
    scheduled(route, schedule="manual", days=(7, 9))
    response = admin_api.post(f"/api/admin/routes/{route.id}/search")
    assert response.status_code == 201
    # Today is 1 November in Nairobi.
    assert (response.data["date_from"], response.data["date_to"]) == ("2026-11-08", "2026-11-10")
    assert (response.data["trigger"], response.data["searches_made"]) == ("manual", 3)


def test_search_now_skips_the_past_part_of_a_fixed_window(admin_api, route, integration, duffel_api):
    set_window(route, TODAY - timedelta(days=5), TODAY + timedelta(days=1))
    response = admin_api.post(f"/api/admin/routes/{route.id}/search")
    assert (response.data["date_from"], response.data["searches_made"]) == ("2026-11-01", 2)

    set_window(route, TODAY - timedelta(days=5), TODAY - timedelta(days=1))
    response = admin_api.post(f"/api/admin/routes/{route.id}/search")
    assert response.status_code == 409 and response.data["detail"] == "The route's dates have passed."


def test_search_now_over_the_allowance_is_refused_not_skipped(admin_api, route, integration):
    scheduled(route, schedule="manual", days=(1, 10))
    set_allowance(9)
    response = admin_api.post(f"/api/admin/routes/{route.id}/search")
    assert response.status_code == 409
    assert response.data["detail"] == "This search needs 10 searches, but only 9 are left this month."
    assert not SearchRun.objects.exists()


# Which routes are due


def test_daily_routes_run_once_a_day_from_two_in_the_morning(due, route, make_route, integration, duffel_api):
    scheduled(route)
    make_route(is_active=False, schedule="daily")
    make_route(schedule="manual")

    assert due(MONDAY_0130) == 0
    assert due(MONDAY_0200) == 1
    run = SearchRun.objects.get()
    assert (run.trigger, run.status, run.started_by, run.searches_made) == ("scheduled", "done", None, 1)
    # Rolling: 30 days after Monday 2 November.
    assert run.date_from == run.date_to == date(2026, 12, 2)
    assert run.fares_found == 2

    assert due("2026-11-02 20:59:00") == 0
    # Tuesday 00:30 is too early; Tuesday 02:00 runs again.
    assert due("2026-11-02 21:30:00") == 0
    assert due("2026-11-02 23:00:00") == 1
    assert SearchRun.objects.count() == 2


def test_a_manual_search_does_not_replace_the_scheduled_one(due, admin_api, route, integration, duffel_api):
    scheduled(route)
    with freeze_time("2026-11-01 22:00:00"):
        assert admin_api.post(f"/api/admin/routes/{route.id}/search").status_code == 201
    assert due(MONDAY_0200) == 1


def test_weekly_routes_run_on_their_weekday_once_a_week(due, route, integration, duffel_api):
    # Wednesdays.
    scheduled(route, schedule="weekly", weekday=2)
    assert due(MONDAY_0200) == 0
    assert due("2026-11-03 23:00:00") == 1  # Wednesday 4 November, 02:00
    assert due("2026-11-04 10:00:00") == 0  # Wednesday afternoon
    assert due("2026-11-05 23:00:00") == 0  # Friday
    assert due("2026-11-10 23:00:00") == 1  # Wednesday 11 November

    # Moved to Friday after this week's run: not again this week.
    route.schedule_weekday = 4
    route.save()
    assert due("2026-11-12 23:00:00") == 0
    assert due("2026-11-19 23:00:00") == 1


def test_a_run_over_the_allowance_is_skipped_once_with_the_reason(due, route, integration, duffel_api):
    scheduled(route, days=(30, 39))
    set_allowance(9)
    assert due(MONDAY_0200) == 0
    run = SearchRun.objects.get()
    assert (run.trigger, run.status, run.searches_made, run.fares_found) == ("scheduled", "skipped", 0, 0)
    assert run.errors == ["This search needs 10 searches, but only 9 are left this month."]
    assert (run.date_from, run.date_to) == (date(2026, 12, 2), date(2026, 12, 11))
    assert run.finished_at is not None
    assert duffel_api.requests == []

    # The skip is that day's run; the next day is tried again.
    assert due("2026-11-02 10:00:00") == 0
    assert SearchRun.objects.count() == 1
    set_allowance(10)
    assert due("2026-11-02 23:00:00") == 1


def test_the_fares_screen_opens_on_the_latest_run_not_skipped(search, due, admin_api, route, integration, duffel_api):
    searched = search(route)
    scheduled(route)
    set_allowance(1)
    assert due(MONDAY_0200) == 0
    assert route.runs.order_by("-created_at").first().status == "skipped"
    assert admin_api.get("/api/admin/fares", {"route": route.id}).data["run"]["id"] == str(searched.id)


def test_a_scheduled_run_with_nothing_to_search_is_skipped(due, route, make_integration):
    make_integration(is_active=False)
    scheduled(route)
    assert due(MONDAY_0200) == 0
    assert SearchRun.objects.get().errors == ["There is no active integration to search with."]


def test_suspended_agencies_are_not_searched(due, route, integration, duffel_api):
    scheduled(route)
    Tenant.objects.filter(schema_name=connection.schema_name).update(is_active=False)
    assert due(MONDAY_0200) == 0
    assert not SearchRun.objects.exists()


# Refreshing published offers


def test_a_run_refreshes_the_routes_offers(search, admin_api, route, integration, duffel_api, exchange_rates):
    first = search(route)
    offer = publish(admin_api, Fare.objects.get(net_currency="GBP"), price="699.00")
    assert offer.price_checked_at == first.finished_at

    ExchangeRate.objects.create(currency="GBP", units_per_usd=Decimal("0.80"), date=TODAY, source="manual")
    duffel_api.reply = gbp_amount("440.00")
    route.markup_fixed = Decimal("20.00")
    route.save()
    later = search(route)
    offer.refresh_from_db()
    # 440 GBP at 0.80 = 550.00 USD, plus 20.
    assert (offer.net_amount, offer.net_currency, offer.net_usd, offer.rate, offer.rate_date) == (
        Decimal("440.000"),
        "GBP",
        Decimal("550.00"),
        Decimal("0.80"),
        TODAY,
    )
    assert offer.price == Decimal("570.00")
    assert offer.price_checked_at == later.finished_at
    assert (offer.is_active, offer.missing_since) == (True, None)


def test_a_price_the_admin_edited_is_left_alone(search, admin_api, route, integration, duffel_api, exchange_rates):
    search(route)
    offer = publish(admin_api, Fare.objects.get(net_currency="GBP"))
    # Saving the same price is no edit.
    admin_api.patch(f"/api/admin/offers/{offer.id}", {"price": "699.00"}, format="json")
    offer.refresh_from_db()
    assert offer.price_edited is False
    assert admin_api.patch(f"/api/admin/offers/{offer.id}", {"price": "649.00"}, format="json").status_code == 200

    duffel_api.reply = gbp_amount("400.00")
    later = search(route)
    offer.refresh_from_db()
    assert offer.price == Decimal("649.00")
    assert (offer.net_amount, offer.net_usd, offer.price_checked_at) == (
        Decimal("400.000"),
        Decimal("506.33"),
        later.finished_at,
    )

    # Publishing it again sets a new price the refreshes follow.
    publish(admin_api, later.fares.get(net_currency="GBP"), price="600.00")
    offer.refresh_from_db()
    assert offer.price_edited is False
    search(route)
    offer.refresh_from_db()
    assert offer.price == Decimal("506.33")


def test_review_mode_flags_an_offer_not_found_until_found_again(
    search, admin_api, route, integration, duffel_api, exchange_rates
):
    search(route)
    offer = publish(admin_api, Fare.objects.get(net_currency="GBP"))
    checked = offer.price_checked_at

    duffel_api.reply = offers_for("duffel_one_way.json", lambda data: data["data"]["offers"].pop(1))
    missed = search(route)
    offer.refresh_from_db()
    assert (offer.is_active, offer.missing_since, offer.price_checked_at) == (True, missed.finished_at, checked)
    assert admin_api.get(f"/api/admin/offers/{offer.id}").data["missing_since"] is not None

    # Still missing: since the first search that missed it.
    search(route)
    offer.refresh_from_db()
    assert offer.missing_since == missed.finished_at

    duffel_api.reply = offers_for("duffel_one_way.json")
    found = search(route)
    offer.refresh_from_db()
    assert (offer.missing_since, offer.price_checked_at) == (None, found.finished_at)


def test_auto_publish_deactivates_an_offer_not_found_and_overrides_edits(
    search, admin_api, route, integration, duffel_api, exchange_rates
):
    search(route)
    gbp = publish(admin_api, Fare.objects.get(net_currency="GBP"))
    usd = publish(admin_api, Fare.objects.get(net_currency="USD", run=route.runs.get()))
    admin_api.patch(f"/api/admin/offers/{usd.id}", {"price": "999.00"}, format="json")
    route.auto_publish = True
    route.save()

    duffel_api.reply = offers_for("duffel_one_way.json", lambda data: data["data"]["offers"].pop(1))
    search(route)
    gbp.refresh_from_db()
    usd.refresh_from_db()
    assert (gbp.is_active, gbp.missing_since) == (False, None)
    assert (usd.is_active, usd.price) == (True, Decimal("650.00"))


def test_only_offers_on_dates_searched_successfully_are_refreshed(
    search, admin_api, route, make_integration, duffel_api, exchange_rates
):
    make_integration(name="One")
    search(route)
    offer = publish(admin_api, Fare.objects.get(net_currency="GBP"))
    # An offer for another date than the one searched.
    Offer.objects.filter(pk=offer.pk).update(departure_date=DEC_1 + timedelta(days=1))
    duffel_api.reply = lambda request: httpx.Response(200, json={"data": {"offers": []}})
    search(route)
    offer.refresh_from_db()
    assert offer.missing_since is None

    # A search that failed tells nothing about the date either.
    Offer.objects.filter(pk=offer.pk).update(departure_date=DEC_1)
    route.auto_publish = True
    route.save()
    duffel_api.reply = lambda request: httpx.Response(401, json=recorded("duffel_unauthorized.json"))
    assert search(route).status == "failed"
    offer.refresh_from_db()
    assert offer.is_active is True


def test_a_fare_without_a_rate_still_counts_as_found(search, admin_api, route, integration, duffel_api, exchange_rates):
    search(route)
    offer = publish(admin_api, Fare.objects.get(net_currency="GBP"))
    Offer.objects.filter(pk=offer.pk).update(missing_since=timezone.now())
    duffel_api.reply = offers_for(
        "duffel_one_way.json", lambda data: data["data"]["offers"][1].update(total_currency="JPY")
    )
    search(route)
    offer.refresh_from_db()
    assert (offer.missing_since, offer.net_currency, offer.price) == (None, "GBP", Decimal("699.00"))


# Auto-publish


def test_auto_publish_publishes_picked_fares_with_the_dialogs_defaults(
    search, route, integration, duffel_api, exchange_rates
):
    route.auto_publish, route.markup_percent = True, Decimal("10")
    route.save()
    run = search(route)
    picked = run.fares.get(picked=True)
    assert picked.status == "published"
    offer = picked.offer
    # 576.58 × 1.1 = 634.238 → 634.24.
    assert (offer.price, offer.valid_until, offer.is_public, offer.source) == (
        Decimal("634.24"),
        TODAY + timedelta(days=7),
        True,
        "gds",
    )
    assert offer.price_checked_at == run.finished_at
    assert run.fares.get(picked=False).status == "new"

    # The next run finds the same flights: the same offer, nothing new.
    later = search(route)
    assert later.fares.get(picked=True).offer == offer
    assert Offer.objects.count() == 1


def test_auto_publish_is_valid_until_departure_at_the_latest(search, route, integration, duffel_api, exchange_rates):
    route.auto_publish = True
    route.save()
    with freeze_time("2026-11-28 09:00:00"):
        run = search(route)
    assert run.fares.get(picked=True).offer.valid_until == DEC_1


def test_a_fare_that_cannot_be_published_is_reported_on_the_run(
    search, route, integration, duffel_api, exchange_rates, monkeypatch
):
    route.auto_publish = True
    route.save()

    def refuse(*args, **kwargs):
        raise services.Conflict("Emirates is no longer active.")

    monkeypatch.setattr(services, "publish", refuse)
    run = search(route)
    assert run.status == "done"
    assert run.errors == ["Not published, EK720@2026-12-01-KQ3110@2026-12-01/economy: Emirates is no longer active."]


def test_review_mode_publishes_nothing(search, route, integration, duffel_api, exchange_rates):
    run = search(route)
    assert not run.fares.exclude(status="new").exists() and not Offer.objects.exists()


# The platform


def test_the_platform_dashboard_shows_searches_per_agency(search, route, integration, duffel_api):
    from tenants.tests.test_platform import platform_user, root_client

    search(route)
    client = root_client()
    client.force_authenticate(platform_user())
    tenant = Tenant.objects.get(schema_name=connection.schema_name)
    data = client.get("/api/platform/dashboard").json()
    assert data["fare_searches"] == [
        {"tenant": {"id": str(tenant.id), "name": tenant.name}, "used": 1, "allowance": 1500}
    ]
