"""Confirming availability with changes, and the customer accepting or declining them (step 20)."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone

from bookings import tasks
from bookings.models import Booking, BookingEvent, BookingStop
from core.models import AppSettings
from core.tests.helpers import html_part

pytestmark = pytest.mark.django_db

Status = Booking.Status


@pytest.fixture(autouse=True)
def payment_instructions(db):
    AppSettings.objects.filter(pk=1).update(payment_instructions="M-Pesa paybill 123456.")


@pytest.fixture
def booking(customer, make_offer, airports):
    offer = make_offer()
    offer.set_stops([{"airport": airports["DXB"], "duration_minutes": 135}])
    booking = Booking.objects.create(user=customer, offer=offer, passenger_count=2, unit_price=offer.price)
    BookingStop.objects.create(booking=booking, position=1, airport=airports["DXB"], duration_minutes=135)
    return booking


def confirm(admin_api, booking, body=None):
    return admin_api.post(f"/api/admin/bookings/{booking.id}/confirm-availability", body or {}, format="json")


def stop(code, minutes):
    return {"airport": code, "duration_minutes": minutes}


def test_confirm_without_body_records_no_changes(admin_api, booking):
    response = confirm(admin_api, booking)
    assert response.status_code == 200, response.data
    assert response.data["status"] == "availability_confirmed"
    assert response.data["changes"] is None
    assert response.data["changes_accepted"] is False


def test_confirm_with_the_same_values_records_no_changes(admin_api, booking):
    response = confirm(admin_api, booking, {"unit_price": "650.00", "stops": [stop("DXB", 135)]})
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
    # The offer is untouched.
    assert booking.offer.price == Decimal("650.00")


def test_confirm_with_new_stops(admin_api, booking):
    response = confirm(admin_api, booking, {"stops": [stop("MBA", 1500), stop("DXB", 60)]})
    assert response.status_code == 200, response.data
    assert response.data["changes"] == {
        "stops": {
            "old": [{"code": "DXB", "city": "Dubai", "duration_minutes": 135}],
            "new": [
                {"code": "MBA", "city": "Mombasa", "duration_minutes": 1500},
                {"code": "DXB", "city": "Dubai", "duration_minutes": 60},
            ],
        }
    }
    assert [(s["airport"]["code"], s["kind"]) for s in response.data["stops"]] == [
        ("MBA", "stopover"),
        ("DXB", "layover"),
    ]
    assert [(s.position, s.airport.code) for s in booking.stops.all()] == [(1, "MBA"), (2, "DXB")]
    assert booking.offer.stops.count() == 1


def test_confirm_can_remove_all_stops(admin_api, booking):
    response = confirm(admin_api, booking, {"stops": []})
    assert response.data["changes"]["stops"]["new"] == []
    assert response.data["stop_count"] == 0


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"unit_price": "0"}, "unit_price"),
        ({"unit_price": "abc"}, "unit_price"),
        ({"stops": [stop("NBO", 60)]}, "stops"),
        ({"stops": [stop("DXB", 60), stop("DXB", 60)]}, "stops"),
        ({"stops": [stop("XXX", 60)]}, "stops"),
        ({"stops": [stop("DXB", 0)]}, "stops"),
    ],
)
def test_confirm_validates_changes(admin_api, booking, body, field):
    response = confirm(admin_api, booking, body)
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
        confirm(admin_api, booking, {"unit_price": "700", "stops": []})
    [email] = mail.outbox
    for text in (
        "Price per person: USD 650.00 → USD 700.00",
        "Stops: Dubai (DXB), 2 h 15 min layover → Direct",
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
    assert "changes" not in email.body
    assert "Review the changes" not in html_part(email)


def test_declined_is_a_booking_status_filter(admin_api, customer_api, booking):
    confirm(admin_api, booking, {"unit_price": "700"})
    customer_api.post(f"/api/bookings/{booking.id}/decline-changes")
    results = admin_api.get("/api/admin/bookings", {"status": "declined"}).data["results"]
    assert [b["id"] for b in results] == [str(booking.id)]
