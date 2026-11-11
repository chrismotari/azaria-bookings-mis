"""Marking a booking unavailable with suggested options."""

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from bookings.models import Booking
from catalog.models import Offer
from core.tests.helpers import airline_named, direct, flight, html_part
from customer_requests.models import Query

pytestmark = pytest.mark.django_db

Status = Booking.Status


@pytest.fixture
def booking(customer, make_offer):
    offer = make_offer(ticket_class="business")
    return Booking.objects.create(user=customer, offer=offer, passenger_count=1, unit_price=offer.price)


def in_days(days):
    return (timezone.localdate() + timedelta(days=days)).isoformat()


def via_dubai():
    qr = airline_named("Qatar Airways")
    when = timezone.localdate() + timedelta(days=31)
    return [
        flight("outbound", qr, "1340", "NBO", "DXB", (when, "08:00"), (when, "14:00")),
        flight("outbound", qr, "1", "DXB", "LHR", (when, "16:00"), (when, "20:30")),
    ]


def new_offer(airports, **overrides):
    return {
        "ticket_class": "business",
        "price": "900.00",
        "airline": str(airline_named("Qatar Airways").id),
        "valid_until": in_days(5),
        "segments": via_dubai(),
        **overrides,
    }


def mark_unavailable(admin_api, booking, body=None, capture=None):
    def post():
        return admin_api.post(f"/api/admin/bookings/{booking.id}/mark-unavailable", body or {}, format="json")

    if capture is None:
        return post()
    with capture(execute=True) as callbacks:
        response = post()
    return response, callbacks


def test_without_options_the_customer_is_pointed_to_a_new_request(
    admin_api, booking, django_capture_on_commit_callbacks
):
    response, callbacks = mark_unavailable(
        admin_api, booking, {"message": "Sorry"}, django_capture_on_commit_callbacks
    )
    assert response.status_code == 200, response.data
    assert response.data["status"] == "unavailable"
    assert response.data["alternatives"] is None
    assert not Query.objects.exists()
    assert len(callbacks) == 1
    [email] = mail.outbox
    assert "/requests/new" in email.body
    assert "Sorry" not in email.body


def test_with_existing_offers_creates_a_responded_request(
    admin_api, booking, make_offer, django_capture_on_commit_callbacks
):
    other = make_offer(airline="Emirates")
    response, callbacks = mark_unavailable(
        admin_api,
        booking,
        {"message": "These are close.", "offer_ids": [str(other.id)]},
        django_capture_on_commit_callbacks,
    )
    assert response.status_code == 200, response.data
    query = Query.objects.get()
    assert response.json()["alternatives"] == str(query.id)
    booked = booking.offer
    assert (query.user, query.origin, query.destination, query.date_from, query.ticket_class, query.status) == (
        booking.user,
        booked.origin,
        booked.destination,
        booked.departure_date,
        "business",
        Query.Status.RESPONDED,
    )
    [query_response] = query.responses.all()
    assert query_response.message == "These are close."
    assert list(query_response.offers.all()) == [other]

    # Only the customer's "could not be confirmed" email: no "new request" or "responded" email.
    assert len(callbacks) == 1
    [email] = mail.outbox
    assert email.to == ["customer@example.com"]
    assert "could not be confirmed" in email.subject
    for text in ("found 1 other option for you", "These are close.", f"/requests/{query.id}"):
        assert text in email.body
    html = html_part(email)
    assert "View suggested options" in html and "These are close." in html


def test_with_custom_offers(admin_api, booking, airports, django_capture_on_commit_callbacks):
    response, _ = mark_unavailable(
        admin_api,
        booking,
        {"new_offers": [new_offer(airports), new_offer(airports, airline=str(airline_named("Kenya Airways").id), segments=direct("NBO", "LHR", in_days(31)))]},
        django_capture_on_commit_callbacks,
    )
    assert response.status_code == 200, response.data
    offers = list(Query.objects.get().responses.get().offers.order_by("airline__name"))
    assert [(o.airline.name, o.is_public, o.segments.count()) for o in offers] == [
        ("Kenya Airways", False, 1),
        ("Qatar Airways", False, 2),
    ]
    assert "found 2 other options for you" in mail.outbox[0].body


def test_customer_sees_the_suggestions(admin_api, customer_api, booking, make_offer):
    private = make_offer(is_public=False, airline="Emirates")
    response = mark_unavailable(admin_api, booking, {"offer_ids": [str(private.id)]})
    query_id = response.data["alternatives"]

    assert customer_api.get(f"/api/bookings/{booking.id}").data["alternatives"] == query_id
    detail = customer_api.get(f"/api/queries/{query_id}").data
    assert detail["status"] == "responded"
    assert [o["id"] for o in detail["responses"][0]["offers"]] == [str(private.id)]
    # A private offer sent this way can be opened and booked.
    assert customer_api.get(f"/api/offers/{private.id}").status_code == 200
    booked = customer_api.post(
        "/api/bookings", {"offer": str(private.id), "passenger_count": 1, "query": query_id}, format="json"
    )
    assert booked.status_code == 201, booked.data


@pytest.mark.parametrize("from_status", [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED])
def test_from_each_allowed_status(admin_api, booking, make_offer, from_status):
    Booking.objects.filter(pk=booking.pk).update(
        status=from_status, payment_deadline=timezone.now() + timedelta(hours=5)
    )
    response = mark_unavailable(admin_api, booking, {"offer_ids": [str(make_offer().id)]})
    assert response.status_code == 200, response.data
    assert response.data["alternatives"] is not None


@pytest.mark.parametrize(
    "body_for",
    [
        lambda airports, offer: {"offer_ids": ["00000000-0000-4000-8000-000000000000"]},
        lambda airports, offer: {"offer_ids": ["not-a-uuid"]},
        lambda airports, offer: {"offer_ids": [str(offer.id)]},
        lambda airports, offer: {"new_offers": [new_offer(airports, price="0")]},
        lambda airports, offer: {
            "new_offers": [new_offer(airports, segments=via_dubai()[::-1])]
        },
    ],
)
def test_invalid_options_change_nothing(admin_api, booking, airports, make_offer, body_for):
    inactive = make_offer(is_active=False)
    offers_before = Offer.objects.count()
    response = mark_unavailable(admin_api, booking, body_for(airports, inactive))
    assert response.status_code == 400
    booking.refresh_from_db()
    assert booking.status == Status.REQUESTED
    assert not Query.objects.exists()
    assert Offer.objects.count() == offers_before


def test_refused_transition_creates_no_request(admin_api, booking, make_offer):
    Booking.objects.filter(pk=booking.pk).update(status=Status.COMPLETED)
    response = mark_unavailable(admin_api, booking, {"offer_ids": [str(make_offer().id)]})
    assert response.status_code == 409
    assert not Query.objects.exists()


def test_customers_cannot_mark_unavailable(customer_api, booking):
    response = customer_api.post(f"/api/admin/bookings/{booking.id}/mark-unavailable", {}, format="json")
    assert response.status_code == 403


def test_the_suggestions_request_carries_the_trip_type_and_return_date(admin_api, customer, make_offer):
    back = timezone.localdate() + timedelta(days=40)
    offer = make_offer(trip_type="return", return_date=back)
    booking = Booking.objects.create(
        user=customer, offer=offer, passenger_count=1, unit_price=offer.price, trip_type="return", return_date=back
    )
    response = mark_unavailable(admin_api, booking, {"offer_ids": [str(make_offer().id)]})
    assert response.status_code == 200, response.data
    query = Query.objects.get(pk=response.data["alternatives"])
    assert (query.trip_type, query.return_date, query.date_from) == ("return", back, offer.departure_date)


def test_one_way_bookings_suggest_one_way_requests(admin_api, booking, make_offer):
    response = mark_unavailable(admin_api, booking, {"offer_ids": [str(make_offer().id)]})
    query = Query.objects.get(pk=response.data["alternatives"])
    assert (query.trip_type, query.return_date) == ("one_way", None)
