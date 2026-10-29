from datetime import date, timedelta
from decimal import Decimal

import pytest
from freezegun import freeze_time

from catalog.models import Offering

pytestmark = pytest.mark.django_db

TODAY = date(2026, 3, 10)


@pytest.fixture(autouse=True)
def _frozen():
    # Noon in Nairobi.
    with freeze_time("2026-03-10 09:00:00"):
        yield


def make_offering(airports, origin="NBO", destination="LHR", **kwargs):
    fields = {
        "departure_date": TODAY + timedelta(days=30),
        "ticket_class": "economy",
        "price": Decimal("650.00"),
        "airline": "Kenya Airways",
        "valid_until": TODAY + timedelta(days=10),
        **kwargs,
    }
    return Offering.objects.create(origin=airports[origin], destination=airports[destination], **fields)


def ids(response):
    return [o["id"] for o in response.data["results"]]


# Browse


def test_guest_can_list_and_view_public_offerings(api, airports):
    offering = make_offering(airports)
    response = api.get("/api/offerings")
    assert response.status_code == 200
    assert ids(response) == [offering.id]
    item = response.data["results"][0]
    assert item["origin"]["code"] == "NBO"
    assert item["price"] == "650.00"
    assert "is_public" not in item and "is_active" not in item

    detail = api.get(f"/api/offerings/{offering.id}")
    assert detail.status_code == 200
    assert detail.data["destination"]["city"] == "London"
    assert detail.data["is_bookable"] is True


def test_browse_lists_only_bookable_public_offerings(api, airports):
    visible = make_offering(airports)
    make_offering(airports, is_public=False)
    make_offering(airports, is_active=False)
    with freeze_time("2026-02-01"):
        make_offering(airports, valid_until=TODAY - timedelta(days=1))
        make_offering(airports, departure_date=TODAY - timedelta(days=1), valid_until=TODAY - timedelta(days=2))
    valid_today = make_offering(airports, valid_until=TODAY)
    assert sorted(ids(api.get("/api/offerings"))) == sorted([visible.id, valid_today.id])


def test_valid_until_is_inclusive_in_nairobi_time(api, airports):
    offering = make_offering(airports, valid_until=TODAY)
    # 23:30 in Nairobi on the valid_until day is still valid.
    with freeze_time("2026-03-10 20:30:00"):
        assert ids(api.get("/api/offerings")) == [offering.id]
    # 00:30 the next day in Nairobi (still 21:30 UTC on the 10th) is not.
    with freeze_time("2026-03-10 21:30:00"):
        assert ids(api.get("/api/offerings")) == []


def test_non_public_offering_hidden_from_guests_and_customers(api, customer_api, airports):
    hidden = make_offering(airports, is_public=False)
    assert api.get(f"/api/offerings/{hidden.id}").status_code == 404
    assert customer_api.get(f"/api/offerings/{hidden.id}").status_code == 404
    assert ids(customer_api.get("/api/offerings")) == []


def test_inactive_offering_detail_is_hidden(api, airports):
    offering = make_offering(airports, is_active=False)
    assert api.get(f"/api/offerings/{offering.id}").status_code == 404


def test_public_detail_of_lapsed_offering_is_not_bookable(api, airports):
    with freeze_time("2026-02-01"):
        offering = make_offering(airports, valid_until=TODAY - timedelta(days=1))
    response = api.get(f"/api/offerings/{offering.id}")
    assert response.status_code == 200
    assert response.data["is_bookable"] is False


def test_public_offerings_are_read_only(api, customer_api, airports):
    offering = make_offering(airports)
    assert customer_api.post("/api/offerings", {}, format="json").status_code == 405
    assert customer_api.patch(f"/api/offerings/{offering.id}", {}, format="json").status_code == 405


# Filters


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("destination", "LHR", ["london"]),
        ("destination", "lhr", ["london"]),
        ("destination", "lond", ["london"]),
        ("destination", "kingdom", ["london"]),
        ("destination", "heathrow", ["london"]),
        ("destination", "emirates", ["dubai"]),
        ("origin", "kenya", ["london", "dubai", "mombasa_nbo"]),
        ("origin", "MBA", []),
        ("origin", "nairobi", ["london", "dubai", "mombasa_nbo"]),
        ("destination", "mombasa", ["mombasa_nbo"]),
    ],
)
def test_airport_text_filters(api, airports, field, value, expected):
    offerings = {
        "london": make_offering(airports, destination="LHR"),
        "dubai": make_offering(airports, destination="DXB"),
        "mombasa_nbo": make_offering(airports, destination="MBA"),
    }
    response = api.get("/api/offerings", {field: value})
    assert sorted(ids(response)) == sorted(offerings[name].id for name in expected)


def test_airport_code_matches_exactly_not_partially(api, airports):
    # "NB" is part of "NBO" but codes only match exactly, and no name, city or country contains it.
    make_offering(airports)
    assert ids(api.get("/api/offerings", {"origin": "NB"})) == []


def test_date_price_class_and_stopover_filters(api, airports):
    early_cheap = make_offering(airports, departure_date=TODAY + timedelta(days=20), price=Decimal("300"))
    mid_business = make_offering(
        airports, departure_date=TODAY + timedelta(days=40), price=Decimal("2500"), ticket_class="business"
    )
    late_stops = make_offering(
        airports, departure_date=TODAY + timedelta(days=60), price=Decimal("800"), stopovers=2
    )

    def get(**params):
        return sorted(ids(api.get("/api/offerings", params)))

    assert get(date_from=(TODAY + timedelta(days=40)).isoformat()) == sorted([mid_business.id, late_stops.id])
    assert get(date_to=(TODAY + timedelta(days=40)).isoformat()) == sorted([early_cheap.id, mid_business.id])
    assert get(
        date_from=(TODAY + timedelta(days=21)).isoformat(), date_to=(TODAY + timedelta(days=59)).isoformat()
    ) == [mid_business.id]
    assert get(price_min="800") == sorted([mid_business.id, late_stops.id])
    assert get(price_max="800") == sorted([early_cheap.id, late_stops.id])
    assert get(price_min="301", price_max="2499.99") == [late_stops.id]
    assert get(ticket_class="business") == [mid_business.id]
    assert get(max_stopovers="0") == sorted([early_cheap.id, mid_business.id])
    assert get(max_stopovers="2") == sorted([early_cheap.id, mid_business.id, late_stops.id])


def test_invalid_filter_value_returns_400(api, airports):
    assert api.get("/api/offerings", {"ticket_class": "cargo"}).status_code == 400
    assert api.get("/api/offerings", {"date_from": "not-a-date"}).status_code == 400


def test_default_order_and_ordering_param(api, airports):
    a = make_offering(airports, departure_date=TODAY + timedelta(days=20), price=Decimal("900"))
    b = make_offering(airports, departure_date=TODAY + timedelta(days=20), price=Decimal("500"))
    c = make_offering(airports, departure_date=TODAY + timedelta(days=15), price=Decimal("700"))
    assert ids(api.get("/api/offerings")) == [c.id, b.id, a.id]
    assert ids(api.get("/api/offerings", {"ordering": "price"})) == [b.id, c.id, a.id]
    assert ids(api.get("/api/offerings", {"ordering": "-price"})) == [a.id, c.id, b.id]
    assert ids(api.get("/api/offerings", {"ordering": "departure_date"}))[0] == c.id


def test_list_is_paginated_by_20(api, airports):
    for _ in range(25):
        make_offering(airports)
    response = api.get("/api/offerings")
    assert response.data["count"] == 25
    assert len(response.data["results"]) == 20


# Admin endpoints


def payload(airports, **overrides):
    return {
        "origin": airports["NBO"].id,
        "destination": airports["LHR"].id,
        "departure_date": (TODAY + timedelta(days=30)).isoformat(),
        "ticket_class": "business",
        "price": "1999.50",
        "stopovers": 1,
        "airline": "Qatar Airways",
        "valid_until": (TODAY + timedelta(days=7)).isoformat(),
        **overrides,
    }


def test_admin_offering_endpoints_reject_customers_and_guests(api, customer_api, airports):
    offering = make_offering(airports)
    for client, code in [(api, 401), (customer_api, 403)]:
        assert client.get("/api/admin/offerings").status_code == code
        assert client.post("/api/admin/offerings", payload(airports), format="json").status_code == code
        assert client.get(f"/api/admin/offerings/{offering.id}").status_code == code
        assert client.patch(f"/api/admin/offerings/{offering.id}", {}, format="json").status_code == code


def test_admin_creates_offering(admin_api, airports):
    response = admin_api.post("/api/admin/offerings", payload(airports), format="json")
    assert response.status_code == 201, response.data
    offering = Offering.objects.get(pk=response.data["id"])
    assert offering.price == Decimal("1999.50")
    assert offering.is_public and offering.is_active
    assert response.data["origin"] == {
        "id": airports["NBO"].id,
        "code": "NBO",
        "name": "Jomo Kenyatta International Airport",
        "city": "Nairobi",
        "country": "Kenya",
    }


def test_admin_can_create_non_public_offering(admin_api, api, airports):
    response = admin_api.post("/api/admin/offerings", payload(airports, is_public=False), format="json")
    assert response.status_code == 201
    assert ids(api.get("/api/offerings")) == []


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"price": "0"}, "price"),
        ({"price": "-5"}, "price"),
        ({"valid_until": (TODAY + timedelta(days=31)).isoformat()}, "valid_until"),
        ({"valid_until": (TODAY - timedelta(days=1)).isoformat()}, "valid_until"),
        ({"ticket_class": "cargo"}, "ticket_class"),
        ({"stopovers": -1}, "stopovers"),
        ({"airline": ""}, "airline"),
    ],
)
def test_admin_create_validation(admin_api, airports, overrides, field):
    response = admin_api.post("/api/admin/offerings", payload(airports, **overrides), format="json")
    assert response.status_code == 400
    assert field in response.data


def test_admin_create_rejects_same_origin_and_destination(admin_api, airports):
    response = admin_api.post(
        "/api/admin/offerings", payload(airports, destination=airports["NBO"].id), format="json"
    )
    assert response.status_code == 400
    assert "destination" in response.data


def test_admin_create_valid_until_today_and_on_departure_day(admin_api, airports):
    today = TODAY.isoformat()
    response = admin_api.post(
        "/api/admin/offerings", payload(airports, valid_until=today, departure_date=today), format="json"
    )
    assert response.status_code == 201, response.data


def test_admin_list_includes_non_public_inactive_and_lapsed(admin_api, airports):
    public = make_offering(airports)
    private = make_offering(airports, is_public=False)
    inactive = make_offering(airports, is_active=False)
    with freeze_time("2026-02-01"):
        lapsed = make_offering(airports, valid_until=TODAY - timedelta(days=1))
    response = admin_api.get("/api/admin/offerings")
    assert sorted(ids(response)) == sorted([public.id, private.id, inactive.id, lapsed.id])
    assert {"is_public", "is_active", "is_bookable"} <= response.data["results"][0].keys()


def test_admin_list_filters(admin_api, airports):
    public = make_offering(airports, destination="DXB")
    private = make_offering(airports, is_public=False)
    inactive = make_offering(airports, is_active=False)

    def get(**params):
        return sorted(ids(admin_api.get("/api/admin/offerings", params)))

    assert get(is_public="false") == [private.id]
    assert get(is_active="false") == [inactive.id]
    assert get(is_active="true", is_public="true") == [public.id]
    assert get(destination="dubai") == [public.id]


def test_admin_patch_deactivates_and_edits(admin_api, api, airports):
    offering = make_offering(airports)
    response = admin_api.patch(f"/api/admin/offerings/{offering.id}", {"is_active": False}, format="json")
    assert response.status_code == 200
    offering.refresh_from_db()
    assert offering.is_active is False
    assert ids(api.get("/api/offerings")) == []

    response = admin_api.patch(f"/api/admin/offerings/{offering.id}", {"price": "720.00"}, format="json")
    assert response.status_code == 200
    offering.refresh_from_db()
    assert offering.price == Decimal("720.00")


def test_admin_patch_validates_against_existing_values(admin_api, airports):
    offering = make_offering(airports)
    late = (offering.departure_date + timedelta(days=1)).isoformat()
    response = admin_api.patch(f"/api/admin/offerings/{offering.id}", {"valid_until": late}, format="json")
    assert response.status_code == 400
    assert "valid_until" in response.data

    response = admin_api.patch(
        f"/api/admin/offerings/{offering.id}", {"origin": airports["LHR"].id}, format="json"
    )
    assert response.status_code == 400
    assert "destination" in response.data


def test_admin_patch_of_lapsed_offering_allowed(admin_api, airports):
    with freeze_time("2026-02-01"):
        offering = make_offering(airports, valid_until=TODAY - timedelta(days=1))
    response = admin_api.patch(f"/api/admin/offerings/{offering.id}", {"airline": "Emirates"}, format="json")
    assert response.status_code == 200


def test_admin_cannot_delete_or_put(admin_api, airports):
    offering = make_offering(airports)
    assert admin_api.delete(f"/api/admin/offerings/{offering.id}").status_code == 405
    assert admin_api.put(f"/api/admin/offerings/{offering.id}", payload(airports), format="json").status_code == 405
    assert Offering.objects.filter(pk=offering.id).exists()
