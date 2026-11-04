from datetime import timedelta

import pytest
from django.utils import timezone

from catalog.models import OfferStop
from customer_requests.models import Query

pytestmark = pytest.mark.django_db


def in_days(days):
    return (timezone.localdate() + timedelta(days=days)).isoformat()


def payload(airports, stops, **overrides):
    return {
        "origin": airports["NBO"].id,
        "destination": airports["LHR"].id,
        "departure_date": in_days(30),
        "ticket_class": "economy",
        "price": "700.00",
        "airline": "Emirates",
        "valid_until": in_days(7),
        "stops": stops,
        **overrides,
    }


def stop(code, minutes):
    return {"airport": code, "duration_minutes": minutes}


def test_admin_creates_offer_with_ordered_stops(admin_api, airports):
    response = admin_api.post(
        "/api/admin/offers", payload(airports, [stop("DXB", 135), stop("MBA", 1500)]), format="json"
    )
    assert response.status_code == 201, response.data
    assert response.data["stop_count"] == 2
    assert response.data["stops"] == [
        {
            "airport": {
                "id": str(airports["DXB"].id),
                "code": "DXB",
                "name": "Dubai International Airport",
                "city": "Dubai",
                "country": "United Arab Emirates",
            },
            "duration_minutes": 135,
            "kind": "layover",
        },
        {
            "airport": {
                "id": str(airports["MBA"].id),
                "code": "MBA",
                "name": "Moi International Airport",
                "city": "Mombasa",
                "country": "Kenya",
            },
            "duration_minutes": 1500,
            "kind": "stopover",
        },
    ]
    stored = OfferStop.objects.filter(offer_id=response.data["id"])
    assert [(s.position, s.airport.code) for s in stored] == [(1, "DXB"), (2, "MBA")]


def test_offer_without_stops_is_direct(admin_api, airports):
    # Omitting stops altogether is allowed.
    data = payload(airports, [])
    del data["stops"]
    response = admin_api.post("/api/admin/offers", data, format="json")
    assert response.status_code == 201, response.data
    assert response.data["stops"] == []
    assert response.data["stop_count"] == 0


@pytest.mark.parametrize(
    ("minutes", "kind"), [(1, "layover"), (1439, "layover"), (1440, "stopover"), (4000, "stopover")]
)
def test_kind_is_derived_from_duration(admin_api, airports, minutes, kind):
    response = admin_api.post("/api/admin/offers", payload(airports, [stop("DXB", minutes)]), format="json")
    assert response.status_code == 201, response.data
    assert response.data["stops"][0]["kind"] == kind


@pytest.mark.parametrize(
    ("stops", "message"),
    [
        ([stop("DXB", 60), stop("MBA", 60), stop("DXB", 60), stop("MBA", 60), stop("DXB", 60)], "at most 4 stops"),
        ([stop("NBO", 60)], "Stop 1: the airport must differ from the origin."),
        ([stop("DXB", 60), stop("LHR", 60)], "Stop 2: the airport must differ from the destination."),
        ([stop("DXB", 60), stop("DXB", 90)], "Stop 2: the airport must differ from the stop before it."),
    ],
)
def test_stop_rules(admin_api, airports, stops, message):
    response = admin_api.post("/api/admin/offers", payload(airports, stops), format="json")
    assert response.status_code == 400
    assert any(message in error for error in response.data["stops"])


def test_same_airport_twice_is_fine_when_not_consecutive(admin_api, airports):
    stops = [stop("DXB", 60), stop("MBA", 60), stop("DXB", 60), stop("MBA", 60)]
    response = admin_api.post("/api/admin/offers", payload(airports, stops), format="json")
    assert response.status_code == 201, response.data
    assert response.data["stop_count"] == 4


@pytest.mark.parametrize("bad", [stop("XXX", 60), stop("DXB", 0), stop("DXB", -5), {"airport": "DXB"}])
def test_stop_input_validation(admin_api, airports, bad):
    response = admin_api.post("/api/admin/offers", payload(airports, [bad]), format="json")
    assert response.status_code == 400
    assert "stops" in response.data


def test_edit_replaces_the_whole_stop_list(admin_api, airports):
    offer_id = admin_api.post(
        "/api/admin/offers", payload(airports, [stop("DXB", 60), stop("MBA", 60)]), format="json"
    ).data["id"]

    response = admin_api.patch(f"/api/admin/offers/{offer_id}", {"stops": [stop("MBA", 200)]}, format="json")
    assert response.status_code == 200, response.data
    assert [(s["airport"]["code"], s["duration_minutes"]) for s in response.data["stops"]] == [("MBA", 200)]
    assert [(s.position, s.airport.code) for s in OfferStop.objects.filter(offer_id=offer_id)] == [(1, "MBA")]

    # An edit without stops leaves them alone.
    response = admin_api.patch(f"/api/admin/offers/{offer_id}", {"airline": "Qatar Airways"}, format="json")
    assert response.data["stop_count"] == 1

    response = admin_api.patch(f"/api/admin/offers/{offer_id}", {"stops": []}, format="json")
    assert response.data["stops"] == []
    assert not OfferStop.objects.filter(offer_id=offer_id).exists()


def test_edit_checks_existing_stops_against_new_route(admin_api, airports):
    offer_id = admin_api.post("/api/admin/offers", payload(airports, [stop("DXB", 60)]), format="json").data["id"]
    response = admin_api.patch(
        f"/api/admin/offers/{offer_id}", {"destination": airports["DXB"].id}, format="json"
    )
    assert response.status_code == 400
    assert "stops" in response.data


def test_public_offer_list_and_detail_return_stops(api, make_offer, airports):
    offer = make_offer()
    offer.set_stops([{"airport": airports["DXB"], "duration_minutes": 95}])
    listed = api.get("/api/offers").data["results"][0]
    detail = api.get(f"/api/offers/{offer.id}").data
    for data in (listed, detail):
        assert data["stop_count"] == 1
        assert data["stops"][0]["airport"]["code"] == "DXB"
        assert data["stops"][0]["kind"] == "layover"
        assert "stopovers" not in data


def test_admin_max_stopovers_filter_counts_all_stops(admin_api, make_offer, airports):
    direct = make_offer()
    layover = make_offer()
    layover.set_stops([{"airport": airports["DXB"], "duration_minutes": 60}])
    stopover = make_offer()
    stopover.set_stops([{"airport": airports["DXB"], "duration_minutes": 2000}])

    def ids(**params):
        return {o["id"] for o in admin_api.get("/api/admin/offers", params).data["results"]}

    assert ids(max_stopovers=0) == {str(direct.id)}
    assert ids(max_stopovers=1) == {str(direct.id), str(layover.id), str(stopover.id)}


def test_respond_creates_custom_offer_with_stops(admin_api, customer, airports):
    query = Query.objects.create(
        user=customer, origin=airports["NBO"], destination=airports["LHR"], date_from=timezone.localdate()
    )
    new_offer = payload(airports, [stop("DXB", 180)])
    response = admin_api.post(
        f"/api/admin/queries/{query.id}/respond", {"new_offers": [new_offer]}, format="json"
    )
    assert response.status_code == 201, response.data
    offer = response.data["responses"][0]["offers"][0]
    assert offer["stop_count"] == 1
    assert offer["stops"][0]["airport"]["code"] == "DXB"
    assert offer["stops"][0]["duration_minutes"] == 180


def test_respond_rejects_custom_offer_with_invalid_stops(admin_api, customer, airports):
    query = Query.objects.create(
        user=customer, origin=airports["NBO"], destination=airports["LHR"], date_from=timezone.localdate()
    )
    response = admin_api.post(
        f"/api/admin/queries/{query.id}/respond",
        {"new_offers": [payload(airports, [stop("LHR", 60)])]},
        format="json",
    )
    assert response.status_code == 400
    assert "new_offers" in response.data
    query.refresh_from_db()
    assert query.status == Query.Status.OPEN


def test_max_stopovers_filter_keeps_the_default_order(api, make_offer, airports):
    later = make_offer(departure_date=timezone.localdate() + timedelta(days=40))
    sooner = make_offer(departure_date=timezone.localdate() + timedelta(days=20))
    with_stop = make_offer()
    with_stop.set_stops([{"airport": airports["DXB"], "duration_minutes": 60}])
    results = api.get("/api/offers", {"max_stopovers": 0}).data["results"]
    assert [o["id"] for o in results] == [str(sooner.id), str(later.id)]
