"""Itineraries: segments per direction, derived connections, trip types, baggage and fare conditions."""

from datetime import timedelta

import pytest
from django.utils import timezone

from catalog.models import Offer, OfferSegment
from core.tests.helpers import airline_named, flight
from customer_requests.models import Query

pytestmark = pytest.mark.django_db


def day(offset):
    return timezone.localdate() + timedelta(days=offset)


@pytest.fixture
def kq(db):
    return airline_named("Kenya Airways")


@pytest.fixture
def ek(db):
    return airline_named("Emirates")


def one_way(kq):
    """NBO → LHR direct."""
    return [flight("outbound", kq, "100", "NBO", "LHR", (day(30), "10:00"), (day(30), "18:00"))]


def round_trip(kq, ek):
    """NBO → DXB (overnight) → LHR, the second flight a codeshare operated by Emirates; LHR → NBO direct back."""
    return [
        flight("outbound", kq, "310", "NBO", "DXB", (day(30), "23:50"), (day(31), "05:40")),
        flight("outbound", kq, "6001", "DXB", "LHR", (day(31), "07:55"), (day(31), "12:30"), operating=ek),
        flight("return", kq, "101", "LHR", "NBO", (day(37), "20:00"), (day(38), "07:00")),
    ]


def payload(segments, **overrides):
    return {
        "trip_type": "one_way",
        "ticket_class": "economy",
        "price": "700.00",
        "airline": str(airline_named("Kenya Airways").id),
        "valid_until": day(7).isoformat(),
        "segments": segments,
        **overrides,
    }


def create(admin_api, segments, **overrides):
    return admin_api.post("/api/admin/offers", payload(segments, **overrides), format="json")


def test_one_way_offer_shape(admin_api, airports, kq):
    response = create(admin_api, one_way(kq), checked_bags=1, checked_bag_kg=23, cabin_bag_kg=7)
    assert response.status_code == 201, response.data
    data = response.data
    assert (data["origin"]["code"], data["destination"]["code"]) == ("NBO", "LHR")
    assert data["departure_date"] == day(30).isoformat()
    assert data["trip_type"] == "one_way"
    assert data["return_date"] is None
    assert (data["checked_bags"], data["checked_bag_kg"], data["cabin_bag_kg"]) == (1, 23, 7)
    assert (data["refund_policy"], data["change_policy"]) == ("not_allowed", "not_allowed")
    assert data["itinerary"]["return"] is None
    outbound = data["itinerary"]["outbound"]
    assert outbound["stop_count"] == 0
    assert outbound["connections"] == []
    [segment] = outbound["segments"]
    assert segment["airline"]["name"] == "Kenya Airways"
    assert segment["operating_airline"] is None
    assert segment["flight_number"] == "100"
    assert segment["origin"]["code"] == "NBO" and segment["destination"]["city"] == "London"
    assert (segment["departure_time"], segment["arrival_time"]) == ("10:00", "18:00")
    assert "stops" not in data and "stop_count" not in data


def test_return_offer_shape_with_connection_and_codeshare(admin_api, airports, kq, ek):
    response = create(
        admin_api, round_trip(kq, ek), trip_type="return", refund_policy="with_fee", change_policy="free"
    )
    assert response.status_code == 201, response.data
    data = response.data
    assert data["trip_type"] == "return"
    assert data["return_date"] == day(37).isoformat()
    assert (data["origin"]["code"], data["destination"]["code"]) == ("NBO", "LHR")
    outbound, inbound = data["itinerary"]["outbound"], data["itinerary"]["return"]
    assert outbound["stop_count"] == 1
    assert outbound["connections"] == [
        {
            "airport": {
                "id": str(airports["DXB"].id),
                "code": "DXB",
                "name": "Dubai International Airport",
                "city": "Dubai",
                "country": "United Arab Emirates",
                "country_code": "AE",
            },
            "wait_minutes": 135,
            "kind": "layover",
        }
    ]
    assert outbound["segments"][1]["operating_airline"]["name"] == "Emirates"
    assert outbound["segments"][0]["arrival_date"] == day(31).isoformat()
    assert inbound["stop_count"] == 0
    assert [s["flight_number"] for s in inbound["segments"]] == ["101"]
    stored = OfferSegment.objects.filter(offer_id=data["id"])
    assert [(s.direction, s.position, s.origin.code) for s in stored] == [
        ("outbound", 1, "NBO"),
        ("outbound", 2, "DXB"),
        ("return", 1, "LHR"),
    ]


def test_a_wait_of_24_hours_is_a_stopover(admin_api, airports, kq):
    segments = [
        flight("outbound", kq, "310", "NBO", "DXB", (day(30), "08:00"), (day(30), "14:00")),
        flight("outbound", kq, "312", "DXB", "LHR", (day(31), "14:00"), (day(31), "18:00")),
    ]
    data = create(admin_api, segments).data
    assert data["itinerary"]["outbound"]["connections"][0]["kind"] == "stopover"
    assert data["itinerary"]["outbound"]["connections"][0]["wait_minutes"] == 24 * 60

    segments[1]["departure_time"] = "13:59"
    data = create(admin_api, segments).data
    assert data["itinerary"]["outbound"]["connections"][0]["kind"] == "layover"


def test_flight_number_is_stored_upper_case_and_a_self_codeshare_is_dropped(admin_api, airports, kq):
    segments = one_way(kq)
    segments[0].update(flight_number="12a", operating_airline=str(kq.id))
    response = create(admin_api, segments)
    assert response.status_code == 201, response.data
    segment = response.data["itinerary"]["outbound"]["segments"][0]
    assert (segment["flight_number"], segment["operating_airline"]) == ("12A", None)


def connected(kq, second_from="DXB", second_departs="08:00"):
    return [
        flight("outbound", kq, "310", "NBO", "DXB", (day(30), "01:00"), (day(30), "07:00")),
        flight("outbound", kq, "311", second_from, "LHR", (day(30), second_departs), (day(30), "12:00")),
    ]


@pytest.mark.parametrize(
    ("segments_for", "message"),
    [
        (lambda kq, ek: [], "Add the outbound flights."),
        (lambda kq, ek: connected(kq, second_from="MBA"), "Outbound flight 2: must leave from DXB, where flight 1 arrives."),
        (lambda kq, ek: connected(kq, second_departs="07:00"), "Outbound flight 2: must leave after flight 1 arrives."),
        (lambda kq, ek: connected(kq, second_departs="06:00"), "Outbound flight 2: must leave after flight 1 arrives."),
        (
            lambda kq, ek: [flight("outbound", kq, "1", "NBO", "NBO", (day(30), "10:00"), (day(30), "11:00"))],
            "Outbound flight 1: From and To must differ.",
        ),
        (
            lambda kq, ek: [flight("outbound", kq, "1", "NBO", "LHR", (day(30), "10:00"), (day(33), "11:00"))],
            "Outbound flight 1: the arrival date must be between one day before and two days after the departure.",
        ),
        (
            lambda kq, ek: [flight("outbound", kq, "1", "NBO", "LHR", (day(30), "10:00"), (day(28), "11:00"))],
            "Outbound flight 1: the arrival date must be between one day before and two days after the departure.",
        ),
        (
            lambda kq, ek: [
                flight("outbound", kq, "1", "NBO", "DXB", (day(30), "10:00"), (day(30), "11:00")),
                flight("outbound", kq, "2", "DXB", "NBO", (day(30), "12:00"), (day(30), "13:00")),
            ],
            "The outbound flights must end somewhere other than where they start.",
        ),
        (
            lambda kq, ek: [
                flight("outbound", kq, str(n), a, b, (day(30), f"0{n}:00"), (day(30), f"0{n}:30"))
                for n, (a, b) in enumerate([("NBO", "DXB"), ("DXB", "MBA"), ("MBA", "DXB"), ("DXB", "MBA"),
                                            ("MBA", "DXB"), ("DXB", "LHR")], start=1)
            ],
            "Outbound: at most 5 flights (4 connections).",
        ),
        (lambda kq, ek: round_trip(kq, ek), "A one-way trip has no return flights."),
    ],
)
def test_itinerary_rules(admin_api, airports, kq, ek, segments_for, message):
    response = create(admin_api, segments_for(kq, ek))
    assert response.status_code == 400
    assert message in response.data["segments"]


def test_five_flights_are_allowed(admin_api, airports, kq):
    route = [("NBO", "DXB"), ("DXB", "MBA"), ("MBA", "DXB"), ("DXB", "MBA"), ("MBA", "LHR")]
    segments = [
        flight("outbound", kq, str(n), a, b, (day(30), f"0{n}:00"), (day(30), f"0{n}:30"))
        for n, (a, b) in enumerate(route, start=1)
    ]
    response = create(admin_api, segments)
    assert response.status_code == 201, response.data
    assert response.data["itinerary"]["outbound"]["stop_count"] == 4


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda segments: segments.pop(), "Add the return flights."),
        (lambda segments: segments[2].update(origin="DXB"), "Return flight 1: must leave from LHR, where the outbound flights arrive."),
        (lambda segments: segments[2].update(destination="MBA"), "Return flight 1: must arrive at NBO, where the outbound flights start."),
        (
            lambda segments: segments[2].update(
                departure_date=day(31).isoformat(), departure_time="12:30", arrival_date=day(32).isoformat()
            ),
            "Return flight 1: must leave after the outbound flights arrive.",
        ),
    ],
)
def test_return_rules(admin_api, airports, kq, ek, change, message):
    segments = round_trip(kq, ek)
    change(segments)
    response = create(admin_api, segments, trip_type="return")
    assert response.status_code == 400
    assert message in response.data["segments"]


def test_inactive_airlines_are_refused_on_create_and_kept_on_edit(admin_api, airports, kq, ek):
    response = create(admin_api, round_trip(kq, ek), trip_type="return")
    assert response.status_code == 201
    offer_id = response.data["id"]
    ek.is_active = False
    ek.save()

    refused = create(admin_api, round_trip(kq, ek), trip_type="return")
    assert refused.status_code == 400
    assert "Outbound flight 2: Emirates is no longer active." in refused.data["segments"]

    # The offer already flies Emirates, so an edit may keep it, but not add another inactive airline.
    kept = admin_api.patch(f"/api/admin/offers/{offer_id}", {"segments": round_trip(kq, ek)}, format="json")
    assert kept.status_code == 200, kept.data
    gone = airline_named("Gone Air")
    gone.is_active = False
    gone.save()
    segments = round_trip(kq, ek)
    segments[2]["airline"] = str(gone.id)
    refused = admin_api.patch(f"/api/admin/offers/{offer_id}", {"segments": segments}, format="json")
    assert "Return flight 1: Gone Air is no longer active." in refused.data["segments"]


@pytest.mark.parametrize(
    "bad",
    [
        {"flight_number": "12345"},
        {"flight_number": "AB12"},
        {"flight_number": ""},
        {"origin": "XXX"},
        {"departure_time": "25:00"},
        {"direction": "sideways"},
        {"airline": "00000000-0000-4000-8000-000000000000"},
    ],
)
def test_segment_input_validation(admin_api, airports, kq, bad):
    segments = one_way(kq)
    segments[0].update(bad)
    response = create(admin_api, segments)
    assert response.status_code == 400
    assert "segments" in response.data


def test_segment_airport_codes_are_accepted_in_any_case(admin_api, airports, kq):
    segments = one_way(kq)
    segments[0].update(origin=" nbo ", destination="lhr")
    response = create(admin_api, segments)
    assert response.status_code == 201, response.data
    assert response.data["itinerary"]["outbound"]["segments"][0]["destination"]["code"] == "LHR"


def test_valid_until_is_checked_against_the_derived_departure(admin_api, airports, kq):
    response = create(admin_api, one_way(kq), valid_until=day(31).isoformat())
    assert response.status_code == 400
    assert "valid_until" in response.data


@pytest.mark.parametrize(
    ("fields", "error"),
    [
        ({"checked_bags": 4}, "checked_bags"),
        ({"checked_bags": -1}, "checked_bags"),
        ({"checked_bags": 0, "checked_bag_kg": 23}, "checked_bag_kg"),
        ({"checked_bags": 1, "checked_bag_kg": 0}, "checked_bag_kg"),
        ({"cabin_bag_kg": 0}, "cabin_bag_kg"),
        ({"refund_policy": "maybe"}, "refund_policy"),
        ({"trip_type": "multi_city"}, "trip_type"),
    ],
)
def test_baggage_and_condition_rules(admin_api, airports, kq, fields, error):
    response = create(admin_api, one_way(kq), **fields)
    assert response.status_code == 400
    assert error in response.data


def test_edit_replaces_segments_and_rederives_fields(admin_api, airports, kq, ek):
    offer_id = create(admin_api, one_way(kq)).data["id"]
    response = admin_api.patch(
        f"/api/admin/offers/{offer_id}",
        {"trip_type": "return", "segments": round_trip(kq, ek)},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["return_date"] == day(37).isoformat()
    assert response.data["itinerary"]["outbound"]["stop_count"] == 1
    assert OfferSegment.objects.filter(offer_id=offer_id).count() == 3

    # Without segments the stored ones stay, and are checked against a changed trip type.
    assert admin_api.patch(f"/api/admin/offers/{offer_id}", {"price": "800"}, format="json").status_code == 200
    response = admin_api.patch(f"/api/admin/offers/{offer_id}", {"trip_type": "one_way"}, format="json")
    assert response.status_code == 400
    assert "A one-way trip has no return flights." in response.data["segments"]


def test_derived_fields_cannot_be_written(admin_api, airports, kq):
    response = create(admin_api, one_way(kq), origin=str(airports["MBA"].id), departure_date=day(40).isoformat())
    assert response.status_code == 201
    assert response.data["origin"]["code"] == "NBO"
    assert response.data["departure_date"] == day(30).isoformat()


def test_public_list_and_detail_return_the_itinerary(api, admin_api, airports, kq, ek):
    offer_id = create(admin_api, round_trip(kq, ek), trip_type="return", checked_bags=2).data["id"]
    listed = api.get("/api/offers").data["results"][0]
    detail = api.get(f"/api/offers/{offer_id}").data
    for data in (listed, detail):
        assert data["trip_type"] == "return"
        assert data["checked_bags"] == 2
        assert data["itinerary"]["outbound"]["stop_count"] == 1
        assert data["itinerary"]["return"]["segments"][0]["flight_number"] == "101"


def test_trip_type_and_return_date_filters(api, admin_api, airports, kq, ek):
    single = create(admin_api, one_way(kq)).data["id"]
    back = create(admin_api, round_trip(kq, ek), trip_type="return").data["id"]

    def ids(**params):
        return {o["id"] for o in api.get("/api/offers", params).data["results"]}

    assert ids(trip_type="one_way") == {single}
    assert ids(trip_type="return") == {back}
    assert ids() == {single, back}
    assert ids(return_from=day(37).isoformat(), return_to=day(37).isoformat()) == {back}
    assert ids(return_from=day(38).isoformat()) == set()
    assert ids(return_to=day(36).isoformat()) == set()


def test_max_stopovers_counts_the_busier_direction(api, admin_api, airports, kq, ek):
    direct = create(admin_api, one_way(kq)).data["id"]
    # One connection out, none back.
    one_out = create(admin_api, round_trip(kq, ek), trip_type="return").data["id"]
    # None out, two back.
    two_back = create(
        admin_api,
        [
            flight("outbound", kq, "100", "NBO", "LHR", (day(30), "10:00"), (day(30), "18:00")),
            flight("return", kq, "1", "LHR", "DXB", (day(37), "08:00"), (day(37), "16:00")),
            flight("return", kq, "2", "DXB", "MBA", (day(37), "18:00"), (day(37), "22:00")),
            flight("return", kq, "3", "MBA", "NBO", (day(37), "23:00"), (day(38), "00:30")),
        ],
        trip_type="return",
    ).data["id"]

    def ids(value):
        return {o["id"] for o in api.get("/api/offers", {"max_stopovers": value}).data["results"]}

    assert ids(0) == {direct}
    assert ids(1) == {direct, one_out}
    assert ids(2) == {direct, one_out, two_back}


def test_max_stopovers_keeps_the_default_order(api, make_offer, admin_api, airports, kq, ek):
    later = make_offer(departure_date=day(40))
    sooner = make_offer(departure_date=day(20))
    create(admin_api, round_trip(kq, ek), trip_type="return")
    results = api.get("/api/offers", {"max_stopovers": 0}).data["results"]
    assert [o["id"] for o in results] == [str(sooner.id), str(later.id)]


def test_respond_creates_a_custom_return_offer(admin_api, customer, airports, kq, ek):
    query = Query.objects.create(
        user=customer, origin=airports["NBO"], destination=airports["LHR"], date_from=timezone.localdate()
    )
    new_offer = payload(round_trip(kq, ek), trip_type="return", checked_bags=1, checked_bag_kg=23)
    response = admin_api.post(f"/api/admin/queries/{query.id}/respond", {"new_offers": [new_offer]}, format="json")
    assert response.status_code == 201, response.data
    offer = response.data["responses"][0]["offers"][0]
    assert offer["trip_type"] == "return"
    assert offer["itinerary"]["outbound"]["connections"][0]["airport"]["code"] == "DXB"
    stored = Offer.objects.get(pk=offer["id"])
    assert (stored.is_public, stored.origin.code, stored.return_date) == (False, "NBO", day(37))


def test_respond_rejects_a_custom_offer_with_a_broken_itinerary(admin_api, customer, airports, kq):
    query = Query.objects.create(user=customer, origin=airports["NBO"], date_from=timezone.localdate())
    response = admin_api.post(
        f"/api/admin/queries/{query.id}/respond",
        {"new_offers": [payload(connected(kq, second_from="MBA"))]},
        format="json",
    )
    assert response.status_code == 400
    assert "new_offers" in response.data
    query.refresh_from_db()
    assert query.status == Query.Status.OPEN
