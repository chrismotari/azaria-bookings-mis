"""Confirming availability with changes, and the customer accepting or declining them."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from bookings import tasks
from bookings.models import Booking, BookingEvent
from bookings.services import create_booking
from core.models import AppSettings
from core.tests.helpers import TEST_SCHEMA, airline_named, flight, html_part

pytestmark = pytest.mark.django_db

Status = Booking.Status


@pytest.fixture(autouse=True)
def payment_instructions(db):
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")


def day(offset):
    return timezone.localdate() + timedelta(days=offset)


def via_dubai(wait_until="07:55"):
    """NBO → DXB → LHR, both flights on day 30."""
    kq = airline_named("Kenya Airways")
    return [
        flight("outbound", kq, "310", "NBO", "DXB", (day(30), "00:50"), (day(30), "05:40")),
        flight("outbound", kq, "312", "DXB", "LHR", (day(30), wait_until), (day(30), "12:30")),
    ]


def direct():
    kq = airline_named("Kenya Airways")
    return [flight("outbound", kq, "100", "NBO", "LHR", (day(31), "10:00"), (day(31), "18:00"))]


@pytest.fixture
def booking(customer, admin_api, airports):
    response = admin_api.post(
        "/api/admin/offers",
        {
            "ticket_class": "economy",
            "price": "650.00",
            "airline": str(airline_named("Kenya Airways").id),
            "valid_until": day(7).isoformat(),
            "segments": via_dubai(),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    return create_booking(customer, {"offer": response.data["id"], "passenger_count": 2})


def confirm(admin_api, booking, body=None):
    return admin_api.post(f"/api/admin/bookings/{booking.id}/confirm-availability", body or {}, format="json")


def test_confirm_without_body_records_no_changes(admin_api, booking):
    response = confirm(admin_api, booking)
    assert response.status_code == 200, response.data
    assert response.data["status"] == "availability_confirmed"
    assert response.data["changes"] is None
    assert response.data["changes_accepted"] is False


def test_confirm_with_the_same_values_records_no_changes(admin_api, booking):
    response = confirm(admin_api, booking, {"unit_price": "650.00", "segments": via_dubai()})
    assert response.status_code == 200, response.data
    assert response.data["changes"] is None


def test_confirm_with_a_new_price(admin_api, booking):
    response = confirm(admin_api, booking, {"unit_price": "700"})
    assert response.status_code == 200, response.data
    assert response.data["changes"] == {"unit_price": {"old": "650.00", "new": "700.00"}}
    assert response.data["unit_price"] == "700.00"
    assert response.data["total_price"] == "1400.00"
    booking.refresh_from_db()
    assert booking.unit_price == Decimal("700.00")
    assert booking.changes_awaiting_acceptance
    assert booking.offer.price == Decimal("650.00")


def test_confirm_with_new_segments(admin_api, booking):
    code = airline_named().iata_code
    response = confirm(admin_api, booking, {"segments": via_dubai(wait_until="09:00")})
    assert response.status_code == 200, response.data
    date = f"{day(30):%a}, {day(30).day} {day(30):%b %Y}"
    assert response.data["changes"] == {
        "segments": {
            "old": [
                {"direction": "outbound", "flight": f"{code} 310", "route": "NBO → DXB", "departure": f"{date} 00:50", "arrival": "05:40"},
                {"direction": "outbound", "flight": f"{code} 312", "route": "DXB → LHR", "departure": f"{date} 07:55", "arrival": "12:30"},
            ],
            "new": [
                {"direction": "outbound", "flight": f"{code} 310", "route": "NBO → DXB", "departure": f"{date} 00:50", "arrival": "05:40"},
                {"direction": "outbound", "flight": f"{code} 312", "route": "DXB → LHR", "departure": f"{date} 09:00", "arrival": "12:30"},
            ],
        }
    }
    connection = response.data["itinerary"]["outbound"]["connections"][0]
    assert (connection["airport"]["code"], connection["wait_minutes"]) == ("DXB", 200)
    assert [s.departure_time.strftime("%H:%M") for s in booking.segments.all()] == ["00:50", "09:00"]
    # The offer keeps its flights.
    assert [s.departure_time.strftime("%H:%M") for s in booking.offer.segments.all()] == ["00:50", "07:55"]


def test_confirm_can_make_the_flight_direct(admin_api, booking):
    response = confirm(admin_api, booking, {"segments": direct()})
    assert response.status_code == 200, response.data
    assert [line["route"] for line in response.data["changes"]["segments"]["new"]] == ["NBO → LHR"]
    assert response.data["itinerary"]["outbound"]["stop_count"] == 0


def test_changes_are_accepted_like_any_other(admin_api, customer_api, booking):
    confirm(admin_api, booking, {"segments": direct()})
    response = customer_api.post(f"/api/bookings/{booking.id}/accept-changes")
    assert response.status_code == 200
    assert response.data["itinerary"]["outbound"]["segments"][0]["flight_number"] == "100"
    assert admin_api.post(f"/api/admin/bookings/{booking.id}/mark-paid").status_code == 200


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (lambda: {"unit_price": "0"}, "unit_price"),
        (lambda: {"unit_price": "abc"}, "unit_price"),
        (lambda: {"segments": via_dubai(wait_until="05:00")}, "segments"),
        (lambda: {"segments": via_dubai()[:1]}, "segments"),
        (lambda: {"segments": [{**direct()[0], "origin": "MBA"}]}, "segments"),
        (lambda: {"segments": [{**direct()[0], "origin": "XXX"}]}, "segments"),
        (
            lambda: {"segments": [*direct(), {**direct()[0], "direction": "return", "origin": "LHR", "destination": "NBO"}]},
            "segments",
        ),
    ],
)
def test_confirm_validates_changes(admin_api, booking, body, field):
    response = confirm(admin_api, booking, body())
    assert response.status_code == 400
    assert field in response.data
    booking.refresh_from_db()
    assert booking.status == Status.REQUESTED
    assert booking.unit_price == Decimal("650.00")


def test_confirm_from_a_wrong_status_is_409_and_changes_nothing(admin_api, booking):
    Booking.objects.filter(pk=booking.pk).update(status=Status.CANCELLED)
    response = confirm(admin_api, booking, {"unit_price": "700"})
    assert response.status_code == 409
    booking.refresh_from_db()
    assert booking.unit_price == Decimal("650.00")
    assert booking.changes is None


def test_customer_accepts_changes_then_admin_marks_paid(admin_api, customer_api, booking):
    confirm(admin_api, booking, {"unit_price": "700"})
    assert admin_api.post(f"/api/admin/bookings/{booking.id}/mark-paid").status_code == 409

    response = customer_api.post(f"/api/bookings/{booking.id}/accept-changes")
    assert response.status_code == 200
    assert response.data["changes_accepted"] is True
    assert response.data["status"] == "availability_confirmed"
    # Once only.
    assert customer_api.post(f"/api/bookings/{booking.id}/accept-changes").status_code == 409
    assert customer_api.post(f"/api/bookings/{booking.id}/decline-changes").status_code == 409

    assert admin_api.post(f"/api/admin/bookings/{booking.id}/mark-paid").status_code == 200


def test_customer_declines_changes(admin_api, customer_api, booking, django_capture_on_commit_callbacks):
    confirm(admin_api, booking, {"unit_price": "700"})
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        response = customer_api.post(f"/api/bookings/{booking.id}/decline-changes")
    assert response.status_code == 200
    assert response.data["status"] == "declined"
    assert callbacks == []
    event = BookingEvent.objects.filter(booking=booking).order_by("-created_at").first()
    assert (event.from_status, event.to_status) == (Status.AVAILABILITY_CONFIRMED, Status.DECLINED)
    # Terminal.
    assert customer_api.post(f"/api/bookings/{booking.id}/cancel").status_code == 409
    assert admin_api.post(f"/api/admin/bookings/{booking.id}/mark-paid").status_code == 409


def test_accept_and_decline_need_changes_awaiting_acceptance(admin_api, customer_api, booking):
    for path in ("accept-changes", "decline-changes"):
        assert customer_api.post(f"/api/bookings/{booking.id}/{path}").status_code == 409
    confirm(admin_api, booking)
    for path in ("accept-changes", "decline-changes"):
        assert customer_api.post(f"/api/bookings/{booking.id}/{path}").status_code == 409


def test_only_the_bookings_customer_can_accept_or_decline(admin_api, other_customer_api, api, booking):
    confirm(admin_api, booking, {"unit_price": "700"})
    for path in ("accept-changes", "decline-changes"):
        assert other_customer_api.post(f"/api/bookings/{booking.id}/{path}").status_code == 404
        assert api.post(f"/api/bookings/{booking.id}/{path}").status_code == 401
        assert admin_api.post(f"/api/bookings/{booking.id}/{path}").status_code == 404
    booking.refresh_from_db()
    assert booking.changes_awaiting_acceptance


def test_bookings_with_changes_awaiting_acceptance_still_expire(admin_api, booking):
    confirm(admin_api, booking, {"unit_price": "700"})
    Booking.objects.filter(pk=booking.pk).update(payment_deadline=timezone.now() - timedelta(minutes=1))
    assert tasks.expire_unpaid_bookings() == 1
    booking.refresh_from_db()
    assert booking.status == Status.EXPIRED


def test_email_lists_the_changes(admin_api, booking, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        confirm(admin_api, booking, {"unit_price": "700", "segments": direct()})
    [email] = mail.outbox
    code = airline_named().iata_code
    date = f"{day(30):%a}, {day(30).day} {day(30):%b %Y}"
    later = f"{day(31):%a}, {day(31).day} {day(31):%b %Y}"
    for text in (
        "Price per person: USD 650.00 → USD 700.00",
        f"Flights: Outbound {code} 310 NBO → DXB, {date} 00:50 – 05:40; Outbound {code} 312 DXB → LHR, {date} 07:55 – 12:30"
        f" → Outbound {code} 100 NBO → LHR, {later} 10:00 – 18:00",
        "accept or decline these changes in the app before you pay",
        f"/bookings/{booking.id}",
    ):
        assert text in email.body
    html = html_part(email)
    assert "USD 650.00" in html and "USD 700.00" in html
    assert "Review the changes" in html


def test_email_without_changes_does_not_mention_them(admin_api, booking, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        confirm(admin_api, booking)
    [email] = mail.outbox
    assert "accept or decline these changes" not in email.body
    assert "Review the changes" not in html_part(email)


def test_declined_is_a_booking_status_filter(admin_api, customer_api, booking):
    confirm(admin_api, booking, {"unit_price": "700"})
    customer_api.post(f"/api/bookings/{booking.id}/decline-changes")
    results = admin_api.get("/api/admin/bookings", {"status": "declined"}).data["results"]
    assert [b["id"] for b in results] == [str(booking.id)]


# The ticketing airline


def test_bookings_keep_the_offers_ticketing_airline(admin_api, customer_api, booking):
    kq = airline_named("Kenya Airways")
    assert booking.airline == kq
    # Changing the offer's airline later leaves the booking's alone.
    booking.offer.airline = airline_named("Emirates")
    booking.offer.save()
    assert customer_api.get(f"/api/bookings/{booking.id}").data["airline"]["name"] == "Kenya Airways"
    assert admin_api.get(f"/api/admin/bookings/{booking.id}").data["airline"]["id"] == str(kq.id)
    assert customer_api.get("/api/bookings").data["results"][0]["airline"]["name"] == "Kenya Airways"


def test_confirm_with_a_new_airline(admin_api, customer_api, booking):
    emirates = airline_named("Emirates")
    response = confirm(admin_api, booking, {"airline": str(emirates.id)})
    assert response.status_code == 200, response.data
    assert response.data["changes"] == {"airline": {"old": "Kenya Airways", "new": "Emirates"}}
    assert response.data["airline"]["name"] == "Emirates"
    booking.refresh_from_db()
    assert booking.airline == emirates
    assert booking.changes_awaiting_acceptance
    # The offer keeps its airline.
    assert booking.offer.airline.name == "Kenya Airways"
    assert customer_api.post(f"/api/bookings/{booking.id}/accept-changes").status_code == 200


def test_confirm_with_the_same_airline_records_no_change(admin_api, booking):
    response = confirm(admin_api, booking, {"airline": str(airline_named("Kenya Airways").id)})
    assert response.status_code == 200, response.data
    assert response.data["changes"] is None


def test_confirm_refuses_an_inactive_airline_unless_the_booking_has_it(admin_api, booking):
    emirates = airline_named("Emirates")
    emirates.is_active = False
    emirates.save()
    response = confirm(admin_api, booking, {"airline": str(emirates.id)})
    assert response.status_code == 400
    assert response.data["airline"] == ["This airline is no longer active."]
    booking.refresh_from_db()
    assert (booking.status, booking.airline.name) == (Status.REQUESTED, "Kenya Airways")

    # The booking's own airline, deactivated later, may stay.
    kq = booking.airline
    kq.is_active = False
    kq.save()
    response = confirm(admin_api, booking, {"airline": str(kq.id)})
    assert response.status_code == 200, response.data
    assert response.data["changes"] is None


def test_email_lists_the_airline_change(admin_api, booking, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        confirm(admin_api, booking, {"airline": str(airline_named("Emirates").id)})
    [email] = mail.outbox
    assert "Ticketing airline: Kenya Airways → Emirates" in email.body
    html = html_part(email)
    assert "Ticketing airline" in html and "Emirates" in html


def test_new_booking_email_names_the_bookings_airline(booking):
    Booking.objects.filter(pk=booking.pk).update(airline=airline_named("Emirates"))
    tasks.notify_admin_new_booking(TEST_SCHEMA, booking.id)
    [email] = mail.outbox
    assert "Airline: Emirates" in email.body
