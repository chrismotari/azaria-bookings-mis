from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from bookings import tasks
from bookings.models import Booking, BookingStop
from bookings.services import transition
from core.emails import format_duration, format_stops
from core.models import AppSettings
from core.tests.helpers import TEST_SCHEMA, html_part

pytestmark = pytest.mark.django_db


@pytest.fixture
def offer_with_stops(make_offer, airports):
    offer = make_offer()
    offer.set_stops(
        [{"airport": airports["DXB"], "duration_minutes": 135}, {"airport": airports["MBA"], "duration_minutes": 1560}]
    )
    return offer


def book(customer_api, offer, capture=None):
    data = {"offer": str(offer.id), "passenger_count": 1}
    if capture is None:
        response = customer_api.post("/api/bookings", data, format="json")
    else:
        with capture(execute=True):
            response = customer_api.post("/api/bookings", data, format="json")
    assert response.status_code == 201, response.data
    return Booking.objects.get(pk=response.data["id"])


def test_booking_copies_the_offer_stops(customer_api, offer_with_stops):
    booking = book(customer_api, offer_with_stops)
    assert [(s.position, s.airport.code, s.duration_minutes) for s in booking.stops.all()] == [
        (1, "DXB", 135),
        (2, "MBA", 1560),
    ]


def test_booking_keeps_its_stops_when_the_offer_changes(customer_api, admin_api, offer_with_stops, airports):
    booking = book(customer_api, offer_with_stops)
    response = admin_api.patch(
        f"/api/admin/offers/{offer_with_stops.id}",
        {"stops": [{"airport": "DXB", "duration_minutes": 45}]},
        format="json",
    )
    assert response.status_code == 200, response.data

    for data in (
        customer_api.get(f"/api/bookings/{booking.id}").data,
        customer_api.get("/api/bookings").data["results"][0],
        admin_api.get(f"/api/admin/bookings/{booking.id}").data,
        admin_api.get("/api/admin/bookings").data["results"][0],
    ):
        assert data["stop_count"] == 2
        assert [(s["airport"]["code"], s["duration_minutes"], s["kind"]) for s in data["stops"]] == [
            ("DXB", 135, "layover"),
            ("MBA", 1560, "stopover"),
        ]
        # The nested offer shows its current stops.
        assert data["offer"]["stop_count"] == 1


def test_direct_booking_has_no_stops(customer_api, make_offer):
    booking = book(customer_api, make_offer())
    assert not BookingStop.objects.filter(booking=booking).exists()
    data = customer_api.get(f"/api/bookings/{booking.id}").data
    assert data["stops"] == []
    assert data["stop_count"] == 0


@pytest.mark.parametrize(("minutes", "text"), [(45, "45 min"), (60, "1 h"), (135, "2 h 15 min"), (1560, "26 h")])
def test_format_duration(minutes, text):
    assert format_duration(minutes) == text


def test_emails_show_the_booking_stops(
    customer_api, admin_user, offer_with_stops, django_capture_on_commit_callbacks
):
    booking = book(customer_api, offer_with_stops, django_capture_on_commit_callbacks)
    expected = "Dubai (DXB), 2 h 15 min layover; Mombasa (MBA), 26 h stopover"
    assert format_stops(booking.stops.all()) == expected
    new_booking = mail.outbox[-1]
    assert f"Stops: {expected}" in new_booking.body
    assert expected in html_part(new_booking)

    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    with django_capture_on_commit_callbacks(execute=True):
        transition(booking.pk, Booking.Status.AVAILABILITY_CONFIRMED, admin_user)
    confirmed = mail.outbox[-1]
    assert f"Stops: {expected}" in confirmed.body
    assert expected in html_part(confirmed)


def test_emails_say_direct_without_stops(customer_api, make_offer, django_capture_on_commit_callbacks):
    book(customer_api, make_offer(), django_capture_on_commit_callbacks)
    assert "Stops: Direct" in mail.outbox[-1].body


@pytest.mark.parametrize(
    ("status", "task"),
    [
        (Booking.Status.UNAVAILABLE, tasks.notify_customer_unavailable),
        (Booking.Status.EXPIRED, tasks.notify_customer_booking_expired),
        (Booking.Status.PAID, tasks.notify_customer_payment_received),
        (Booking.Status.AVAILABILITY_CONFIRMED, tasks.notify_customer_payment_reminder),
    ],
)
def test_every_booking_email_shows_stops(customer_api, offer_with_stops, status, task):
    booking = book(customer_api, offer_with_stops)
    Booking.objects.filter(pk=booking.pk).update(status=status, payment_deadline=timezone.now() + timedelta(hours=2))
    mail.outbox.clear()
    task(TEST_SCHEMA, booking.pk)
    assert "Stops: Dubai (DXB), 2 h 15 min layover" in mail.outbox[0].body
    assert "Dubai (DXB), 2 h 15 min layover" in html_part(mail.outbox[0])
