"""Step 49: Explore's featured cards per module."""

from datetime import timedelta

import pytest
from django.utils import timezone
from django_tenants.utils import schema_context
from freezegun import freeze_time
from rest_framework.test import APIClient

from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA
from hotels.tests.conftest import make_hotel  # noqa: F401
from tenants.models import Tenant
from tours.models import Tour, TourBooking
from tours.tests.conftest import make_tour  # noqa: F401

pytestmark = pytest.mark.django_db

NOW = "2026-03-10 09:00:00+03:00"


def modules(*names, schema=TEST_SCHEMA):
    Tenant.objects.filter(schema_name=schema).update(
        **{f"{name}_enabled": name in names for name in ("flights", "tours", "hotels")}
    )


def explore(api):
    response = api.get("/api/explore")
    assert response.status_code == 200
    return response.json()


def days(count):
    return timezone.localdate() + timedelta(days=count)


@freeze_time(NOW)
def test_only_modules_on_are_present(api):
    assert explore(api) == {"flights": []}
    modules("tours", "hotels")
    assert explore(api) == {"tours": [], "hotels": []}


@freeze_time(NOW)
def test_flights_featured_first_then_by_departure_filled_to_six(api, make_offer):
    late_featured = make_offer(departure_date=days(60), is_featured=True)
    early_featured = make_offer(departure_date=days(40), is_featured=True)
    rest = [make_offer(departure_date=days(10 + index)) for index in range(6)]
    make_offer(departure_date=days(1), is_public=False, is_featured=True)
    make_offer(departure_date=days(1), is_active=False, is_featured=True)
    make_offer(departure_date=days(1), valid_until=days(-1), is_featured=True)

    cards = explore(api)["flights"]
    assert [card["id"] for card in cards] == [str(o.id) for o in [early_featured, late_featured, *rest[:4]]]
    assert [card["is_featured"] for card in cards] == [True, True, False, False, False, False]
    assert cards[0]["origin"]["code"] == "NBO" and cards[0]["price"] == "650.00"


@freeze_time(NOW)
def test_tours_featured_first_then_by_start_only_listed(api, make_tour, customer):
    modules("tours")

    def start(count):
        return {
            "start_date": days(count),
            "end_date": days(count + 2),
            "booking_deadline": days(count - 1),
            "cancellation_deadline": days(count - 1),
        }

    featured = make_tour(title="Featured", is_featured=True, **start(50))
    soon = make_tour(title="Soon", **start(10))
    later = make_tour(title="Later", **start(20))
    make_tour(title="Inactive", is_active=False, is_featured=True, **start(5))
    make_tour(title="Closed", is_featured=True, **{**start(1), "booking_deadline": days(-1)})
    Tour.objects.filter(pk=make_tour(title="Cancelled", is_featured=True).pk).update(cancelled_at=timezone.now())

    sold_out = make_tour(title="Sold out", is_featured=True, slots=1, **start(30))
    TourBooking.objects.create(tour=sold_out, user=customer, people=1)

    cards = explore(api)["tours"]
    assert [card["title"] for card in cards] == ["Sold out", "Featured", "Soon", "Later"]
    assert [card["id"] for card in cards] == [str(sold_out.id), str(featured.id), str(soon.id), str(later.id)]
    assert cards[0]["not_bookable_reason"] == "fully_booked" and cards[1]["bookable"] is True
    assert cards[1]["is_featured"] is True and cards[1]["from_price"] == "300.00"
    assert "booked" not in cards[0]


@freeze_time(NOW)
def test_hotels_featured_first_then_by_from_price_then_name(api, make_hotel):
    modules("hotels")

    def priced(name, price, **fields):
        return make_hotel(name=name, rates=[{"name": "Room only", "periods": [(0, 30, price)]}], **fields)

    priced("Pricey featured", "300", is_featured=True)
    priced("Cheap featured", "50", is_featured=True)
    for name in ["Bravo", "Alpha", "Charlie", "Delta", "Echo"]:
        priced(name, "80")
    priced("Inactive", "10", is_active=False, is_featured=True)
    priced("Ended", "10", is_featured=True).room_types.first().rates.first().periods.update(
        start_date=days(-10), end_date=days(-1)
    )

    cards = explore(api)["hotels"]
    names = [card["name"] for card in cards]
    assert names == ["Cheap featured", "Pricey featured", "Alpha", "Bravo", "Charlie", "Delta"]
    assert cards[0]["from_price"] == "50.00" and cards[0]["is_featured"] is True


@freeze_time(NOW)
def test_nothing_from_another_agency(make_offer, make_tour):
    modules("flights", "tours")
    make_offer(is_featured=True)
    make_tour(is_featured=True)
    modules("flights", "tours", schema=OTHER_SCHEMA)
    other = APIClient(HTTP_HOST=OTHER_DOMAIN)
    assert explore(other) == {"flights": [], "tours": []}
    with schema_context(OTHER_SCHEMA):
        assert Tour.objects.count() == 0
    assert len(explore(APIClient())["tours"]) == 1
