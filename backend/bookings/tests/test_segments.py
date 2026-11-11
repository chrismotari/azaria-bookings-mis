"""A booking's own itinerary, baggage and fare conditions, and how emails show them."""

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from bookings import tasks
from bookings.models import Booking
from bookings.services import transition
from core.emails import format_baggage, format_duration
from core.models import AppSettings
from core.tests.helpers import TEST_SCHEMA, airline_named, flight, html_part

pytestmark = pytest.mark.django_db


def day(offset):
    return timezone.localdate() + timedelta(days=offset)


def round_trip():
    kq, ek = airline_named("Kenya Airways"), airline_named("Emirates")
    return [
        flight("outbound", kq, "310", "NBO", "DXB", (day(30), "23:50"), (day(31), "05:40")),
        flight("outbound", kq, "6001", "DXB", "LHR", (day(31), "07:55"), (day(31), "12:30"), operating=ek),
        flight("return", kq, "101", "LHR", "NBO", (day(37), "20:00"), (day(38), "07:00")),
    ]


@pytest.fixture
def return_offer(admin_api, airports):
    response = admin_api.post(
        "/api/admin/offers",
        {
            "trip_type": "return",
            "ticket_class": "economy",
            "price": "900.00",
            "airline": str(airline_named("Kenya Airways").id),
            "valid_until": day(7).isoformat(),
            "checked_bags": 1,
            "checked_bag_kg": 23,
            "cabin_bag_kg": 7,
            "refund_policy": "with_fee",
            "change_policy": "free",
            "segments": round_trip(),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    return response.data["id"]


def book(customer_api, offer_id, capture=None):
    data = {"offer": str(offer_id), "passenger_count": 1}
    if capture is None:
        response = customer_api.post("/api/bookings", data, format="json")
    else:
        with capture(execute=True):
            response = customer_api.post("/api/bookings", data, format="json")
    assert response.status_code == 201, response.data
    return Booking.objects.get(pk=response.data["id"])


def test_booking_copies_segments_baggage_and_conditions(customer_api, return_offer):
    booking = book(customer_api, return_offer)
    assert (booking.trip_type, booking.return_date) == ("return", day(37))
    assert (booking.checked_bags, booking.checked_bag_kg, booking.cabin_bag_kg) == (1, 23, 7)
    assert (booking.refund_policy, booking.change_policy) == ("with_fee", "free")
    assert [(s.direction, s.position, s.flight, s.operating_airline and s.operating_airline.name) for s in booking.segments.all()] == [
        ("outbound", 1, f"{airline_named().iata_code} 310", None),
        ("outbound", 2, f"{airline_named().iata_code} 6001", "Emirates"),
        ("return", 1, f"{airline_named().iata_code} 101", None),
    ]


def test_bookings_keep_their_itinerary_when_the_offer_changes(customer_api, admin_api, return_offer):
    booking = book(customer_api, return_offer)
    kq = airline_named("Kenya Airways")
    response = admin_api.patch(
        f"/api/admin/offers/{return_offer}",
        {
            "trip_type": "one_way",
            "checked_bags": 0,
            "checked_bag_kg": None,
            "refund_policy": "free",
            "segments": [flight("outbound", kq, "100", "NBO", "LHR", (day(30), "10:00"), (day(30), "18:00"))],
        },
        format="json",
    )
    assert response.status_code == 200, response.data

    for data in (
        customer_api.get(f"/api/bookings/{booking.id}").data,
        customer_api.get("/api/bookings").data["results"][0],
        admin_api.get(f"/api/admin/bookings/{booking.id}").data,
        admin_api.get("/api/admin/bookings").data["results"][0],
    ):
        assert data["trip_type"] == "return"
        assert data["return_date"] == day(37).isoformat()
        assert (data["checked_bags"], data["refund_policy"]) == (1, "with_fee")
        assert data["itinerary"]["outbound"]["stop_count"] == 1
        assert data["itinerary"]["outbound"]["connections"][0]["wait_minutes"] == 135
        assert data["itinerary"]["return"]["segments"][0]["flight_number"] == "101"
        # The nested offer shows its current itinerary.
        assert data["offer"]["trip_type"] == "one_way"
        assert data["offer"]["itinerary"]["return"] is None


@pytest.mark.parametrize(("minutes", "text"), [(45, "45 min"), (60, "1 h"), (135, "2 h 15 min"), (1560, "26 h")])
def test_format_duration(minutes, text):
    assert format_duration(minutes) == text


@pytest.mark.parametrize(
    ("bags", "kg", "cabin", "text"),
    [
        (1, 23, 7, "1 × 23 kg checked, 7 kg cabin"),
        (2, 23, None, "2 × 23 kg checked"),
        (2, None, None, "2 checked bags"),
        (1, None, 8, "1 checked bag, 8 kg cabin"),
        (0, None, 7, "Cabin bag only (7 kg)"),
        (0, None, None, "Cabin bag only"),
    ],
)
def test_format_baggage(bags, kg, cabin, text):
    assert format_baggage(Booking(checked_bags=bags, checked_bag_kg=kg, cabin_bag_kg=cabin)) == text


def expected_lines():
    code = airline_named().iata_code
    date = f"{day(30):%a}, {day(30).day} {day(30):%b %Y}"
    back = f"{day(37):%a}, {day(37).day} {day(37):%b %Y}"
    return [
        f"{date} · {code} 310 · 23:50 Nairobi (NBO) → 05:40 +1 Dubai (DXB)",
        "2 h 15 min layover in Dubai (DXB)",
        f"{code} 6001 (operated by Emirates)",
        "07:55 Dubai (DXB) → 12:30 London (LHR)",
        f"{back} · {code} 101 · 20:00 London (LHR) → 07:00 +1 Nairobi (NBO)",
        "Baggage: 1 × 23 kg checked, 7 kg cabin",
        "Fare conditions: Refundable for a fee, free changes",
    ]


def test_emails_show_both_directions_baggage_and_conditions(
    customer_api, admin_user, return_offer, django_capture_on_commit_callbacks
):
    booking = book(customer_api, return_offer, django_capture_on_commit_callbacks)
    AppSettings.objects.update(payment_instructions="M-Pesa paybill 123456.")
    with django_capture_on_commit_callbacks(execute=True):
        transition(booking.pk, Booking.Status.AVAILABILITY_CONFIRMED, admin_user)
    new_booking, confirmed = mail.outbox
    for email in (new_booking, confirmed):
        assert "Outbound:" in email.body and "Return:" in email.body
        assert "⇄" in email.body
        html = html_part(email)
        for line in expected_lines():
            assert line in email.body
            # The HTML shows the same values; the labels are table cells there.
            assert line.split(": ", 1)[-1] in html


def test_one_way_emails_have_no_return_part(customer_api, make_offer, django_capture_on_commit_callbacks):
    book(customer_api, make_offer().id, django_capture_on_commit_callbacks)
    body = mail.outbox[-1].body
    assert "Outbound:" in body and "Return:" not in body
    assert "Baggage: Cabin bag only" in body
    assert "Fare conditions: Non-refundable, no changes" in body


@pytest.mark.parametrize(
    ("status", "task"),
    [
        (Booking.Status.UNAVAILABLE, tasks.notify_customer_unavailable),
        (Booking.Status.EXPIRED, tasks.notify_customer_booking_expired),
        (Booking.Status.PAID, tasks.notify_customer_payment_received),
        (Booking.Status.AVAILABILITY_CONFIRMED, tasks.notify_customer_payment_reminder),
    ],
)
def test_every_booking_email_shows_the_itinerary(customer_api, return_offer, status, task):
    booking = book(customer_api, return_offer)
    Booking.objects.filter(pk=booking.pk).update(status=status, payment_deadline=timezone.now() + timedelta(hours=2))
    mail.outbox.clear()
    task(TEST_SCHEMA, booking.pk)
    [email] = mail.outbox
    for line in expected_lines():
        assert line in email.body
    assert "2 h 15 min layover in Dubai (DXB)" in html_part(email)
