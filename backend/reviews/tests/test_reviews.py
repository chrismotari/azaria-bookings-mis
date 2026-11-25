"""Step 51: reviews of flight bookings (the agency's service), tours and hotels."""

from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from django_tenants.utils import schema_context
from freezegun import freeze_time
from rest_framework.test import APIClient

from accounts.models import User
from bookings.models import Booking, BookingSegment
from core.models import AppSettings
from core.tests.helpers import OTHER_DOMAIN, OTHER_SCHEMA, TEST_SCHEMA, html_part
from hotels.models import HotelBooking, HotelBookingRoom
from hotels.tests.conftest import make_hotel, rate_of  # noqa: F401
from reviews import tasks
from reviews.models import Review
from tenants.tests.test_modules import set_modules
from tours.models import TourBooking, TourBookingLine
from tours.tests.conftest import make_tour  # noqa: F401

pytestmark = pytest.mark.django_db

FlightStatus = Booking.Status
NO_RATING = {"average": None, "count": 0, "by_rating": {str(n): 0 for n in range(1, 6)}}


@pytest.fixture(autouse=True)
def all_modules(db):
    set_modules("flights", "tours", "hotels")
    AppSettings.objects.update(admin_notification_email="desk@agency.test")


def today():
    return timezone.localdate()


@pytest.fixture
def flight(customer, make_offer):
    """A flight booking whose (only) flight left days ago."""

    def make(status=FlightStatus.COMPLETED, days_ago=1, user=customer, segments=True):
        departure = today() - timedelta(days=days_ago)
        offer = make_offer(departure_date=departure, valid_until=departure)
        booking = Booking.objects.create(
            user=user, offer=offer, status=status, passenger_count=1, unit_price=offer.price
        )
        if segments:
            data = [segment.as_data() for segment in offer.segments.all()]
            BookingSegment.objects.bulk_create(BookingSegment.build(data, booking=booking))
        return booking

    return make


@pytest.fixture
def tour_booking(customer, make_tour):
    """A booking on a tour that ended days ago."""

    def make(status=TourBooking.Status.COMPLETED, user=customer, tour=None, ended_days_ago=1):
        end = today() - timedelta(days=ended_days_ago)
        tour = tour or make_tour(
            start_date=end - timedelta(days=2),
            end_date=end,
            booking_deadline=end - timedelta(days=3),
            cancellation_deadline=end - timedelta(days=3),
        )
        option = tour.options.first()
        booking = TourBooking.objects.create(tour=tour, user=user, people=1, status=status)
        TourBookingLine.objects.create(
            booking=booking,
            option=option,
            option_name=option.name,
            unit_price=option.price,
            people_per_unit=1,
            quantity=1,
        )
        return booking

    return make


@pytest.fixture
def hotel_booking(customer, make_hotel):
    """A stay of two nights that checked out days ago."""

    def make(status=HotelBooking.Status.COMPLETED, check_out_days_ago=0, user=customer, hotel=None):
        hotel = hotel or make_hotel()
        check_out = today() - timedelta(days=check_out_days_ago)
        booking = HotelBooking.objects.create(
            hotel=hotel,
            user=user,
            check_in=check_out - timedelta(days=2),
            check_out=check_out,
            status=status,
            total=Decimal("300.00"),
        )
        rate = rate_of(hotel)
        HotelBookingRoom.objects.create(
            booking=booking,
            room_type=rate.room_type,
            rate=rate,
            room_name="Deluxe Double",
            rate_name=rate.name,
            per_adult_per_night=rate.per_adult_per_night,
            price=Decimal("300.00"),
            adults=2,
        )
        return booking

    return make


def review(client, booking, rating=5, comment="Lovely."):
    field = {Booking: "booking", TourBooking: "tour_booking", HotelBooking: "hotel_booking"}[type(booking)]
    return client.post("/api/reviews", {field: str(booking.pk), "rating": rating, "comment": comment}, format="json")


def made(user, booking, rating=5, **fields):
    """A review saved directly, as the service would."""
    kind, field = {
        Booking: ("flight", "booking"),
        TourBooking: ("tour", "tour_booking"),
        HotelBooking: ("hotel", "hotel_booking"),
    }[type(booking)]
    return Review.objects.create(
        **{field: booking},
        kind=kind,
        tour_id=getattr(booking, "tour_id", None),
        hotel_id=getattr(booking, "hotel_id", None),
        user=user,
        rating=rating,
        **fields,
    )


def customer_named(name, email):
    return User.objects.create_user(email=email, password="Str0ng-pass!", full_name=name, phone="+254700000009")


# The model


def test_a_review_has_exactly_one_booking(customer, flight, tour_booking):
    booking, on_tour = flight(), tour_booking()
    for fields in ({}, {"booking": booking, "tour_booking": on_tour}):
        with pytest.raises(IntegrityError), transaction.atomic():
            Review.objects.create(kind="flight", user=customer, rating=4, **fields)


def test_one_review_per_booking(customer, flight):
    booking = flight()
    made(customer, booking)
    with pytest.raises(IntegrityError), transaction.atomic():
        made(customer, booking)


@pytest.mark.parametrize(
    ("full_name", "shown"),
    [("Wanjiru Kamau", "Wanjiru K."), ("Mary Ann  wambui", "Mary W."), ("Cher", "Cher")],
)
def test_reviewer_name_is_the_first_name_and_last_initial(full_name, shown):
    assert Review(user=User(full_name=full_name)).reviewer_name == shown


# Who can review and when


def test_a_flight_can_be_reviewed_the_day_after_its_last_flight(customer_api, flight):
    left_today = flight(days_ago=0)
    assert customer_api.get(f"/api/bookings/{left_today.pk}").data["can_review"] is False
    assert review(customer_api, left_today).status_code == 409

    booking = flight(days_ago=1)
    data = customer_api.get(f"/api/bookings/{booking.pk}").data
    assert (data["can_review"], data["review"]) == (True, None)
    response = review(customer_api, booking, rating=4, comment="  Quick and clear.  ")
    assert response.status_code == 201
    assert response.data["kind"] == "flight"
    assert response.data["comment"] == "Quick and clear."
    assert response.data["booking"] == {"kind": "flight", "id": str(booking.pk), "title": "NBO → LHR"}

    listed = customer_api.get("/api/bookings").data["results"]
    row = next(row for row in listed if row["id"] == str(booking.pk))
    assert row["can_review"] is False
    assert row["review"]["rating"] == 4


def test_a_return_flight_counts_its_last_segment(customer_api, flight):
    booking = flight(days_ago=5)
    outbound = booking.segments.get()
    BookingSegment.objects.create(
        booking=booking,
        direction="return",
        position=1,
        airline=outbound.airline,
        flight_number="101",
        origin=outbound.destination,
        destination=outbound.origin,
        departure_date=today(),
        departure_time=outbound.departure_time,
        arrival_date=today() + timedelta(days=1),
        arrival_time=outbound.arrival_time,
    )
    assert review(customer_api, booking).status_code == 409


def test_a_hotel_stay_can_be_reviewed_from_the_check_out_day(customer_api, hotel_booking):
    tomorrow = hotel_booking(check_out_days_ago=-1)
    assert customer_api.get(f"/api/hotel-bookings/{tomorrow.pk}").data["can_review"] is False
    assert review(customer_api, tomorrow).status_code == 409

    booking = hotel_booking(check_out_days_ago=0)
    assert customer_api.get(f"/api/hotel-bookings/{booking.pk}").data["can_review"] is True
    assert review(customer_api, booking).status_code == 201
    data = customer_api.get(f"/api/hotel-bookings/{booking.pk}").data
    assert data["can_review"] is False
    assert data["review"]["booking"]["title"] == "Diani Reef"
    assert Review.objects.get().hotel_id == booking.hotel_id


def test_a_tour_can_be_reviewed_once_its_booking_is_completed(customer_api, tour_booking):
    confirmed = tour_booking(status=TourBooking.Status.CONFIRMED)
    assert customer_api.get(f"/api/tour-bookings/{confirmed.pk}").data["can_review"] is False
    assert review(customer_api, confirmed).status_code == 409

    booking = tour_booking()
    assert customer_api.get(f"/api/tour-bookings/{booking.pk}").data["can_review"] is True
    assert review(customer_api, booking).status_code == 201
    assert Review.objects.get().tour_id == booking.tour_id


@pytest.mark.parametrize("status", [FlightStatus.CANCELLED, FlightStatus.UNAVAILABLE, FlightStatus.PAID])
def test_unfinished_cancelled_and_unavailable_flights_cannot_be_reviewed(customer_api, flight, status):
    response = review(customer_api, flight(status=status, days_ago=10))
    assert response.status_code == 409
    assert Review.objects.count() == 0


@pytest.mark.parametrize("status", [HotelBooking.Status.CANCELLED, HotelBooking.Status.UNAVAILABLE])
def test_cancelled_and_unavailable_stays_cannot_be_reviewed(customer_api, hotel_booking, status):
    assert review(customer_api, hotel_booking(status=status, check_out_days_ago=5)).status_code == 409


def test_a_cancelled_tour_booking_cannot_be_reviewed(customer_api, tour_booking):
    assert review(customer_api, tour_booking(status=TourBooking.Status.CANCELLED)).status_code == 409


def test_only_once_and_only_the_bookings_customer(customer_api, other_customer_api, admin_api, flight):
    booking = flight()
    assert review(other_customer_api, booking).status_code == 404
    assert review(admin_api, booking).status_code == 403
    assert review(customer_api, booking).status_code == 201
    response = review(customer_api, booking)
    assert response.status_code == 409
    assert response.data["detail"] == "You have already reviewed this booking."


def test_the_review_input_is_checked(customer_api, flight, tour_booking):
    booking = flight()
    assert review(customer_api, booking, rating=6).status_code == 400
    assert review(customer_api, booking, rating=0).status_code == 400
    assert review(customer_api, booking, comment="x" * 2001).status_code == 400
    both = {"booking": str(booking.pk), "tour_booking": str(tour_booking().pk), "rating": 5}
    assert customer_api.post("/api/reviews", both, format="json").status_code == 400
    assert customer_api.post("/api/reviews", {"rating": 5}, format="json").status_code == 400
    assert review(customer_api, booking, comment="").status_code == 201


# Editing and deleting


def test_the_author_edits_keeping_the_reply(customer, customer_api, other_customer_api, flight, admin_user):
    mine = made(customer, flight(), rating=3, reply="Thank you.", replied_by=admin_user, replied_at=timezone.now())
    assert other_customer_api.patch(f"/api/reviews/{mine.pk}", {"rating": 1}, format="json").status_code == 404
    response = customer_api.patch(f"/api/reviews/{mine.pk}", {"rating": 4, "comment": "Better now."}, format="json")
    assert response.status_code == 200
    assert (response.data["rating"], response.data["comment"], response.data["reply"]) == (
        4,
        "Better now.",
        "Thank you.",
    )
    assert customer_api.patch(f"/api/reviews/{mine.pk}", {"rating": 9}, format="json").status_code == 400
    assert len(mail.outbox) == 0


def test_the_author_deletes_with_the_reply(customer, customer_api, other_customer_api, flight):
    booking = flight()
    mine = made(customer, booking, reply="Thank you.")
    assert other_customer_api.delete(f"/api/reviews/{mine.pk}").status_code == 404
    assert customer_api.delete(f"/api/reviews/{mine.pk}").status_code == 204
    assert not Review.objects.exists()
    assert customer_api.get(f"/api/bookings/{booking.pk}").data["can_review"] is True


# Hiding, replying and what the public sees


def test_a_hidden_review_leaves_public_lists_but_still_counts(
    customer, customer_api, admin_api, api, tour_booking, make_tour
):
    tour = make_tour(title="Mara")
    other = customer_named("Wanjiru Kamau", "w@example.com")
    hidden = made(customer, tour_booking(tour=tour), rating=1, comment="Rude driver.")
    made(other, tour_booking(tour=tour, user=other), rating=5, comment="Wonderful.")

    response = admin_api.post(f"/api/admin/reviews/{hidden.pk}/hide")
    assert response.status_code == 200
    assert (response.data["is_hidden"], response.data["hidden_by"]) == (True, "Owner")

    data = api.get("/api/reviews", {"tour": str(tour.pk)}).data
    assert [row["reviewer_name"] for row in data["results"]] == ["Wanjiru K."]
    assert data["summary"] == {"average": 3.0, "count": 2, "by_rating": {"1": 1, "2": 0, "3": 0, "4": 0, "5": 1}}
    assert api.get(f"/api/tours/{tour.pk}").data["rating"] == {"average": 3.0, "count": 2}

    own = customer_api.get("/api/reviews").data["results"]
    assert [(row["id"], row["is_hidden"]) for row in own] == [(str(hidden.pk), True)]

    response = admin_api.post(f"/api/admin/reviews/{hidden.pk}/show")
    assert (response.data["is_hidden"], response.data["hidden_by"], response.data["hidden_at"]) == (False, None, None)
    assert api.get("/api/reviews", {"tour": str(tour.pk)}).data["count"] == 2
    assert len(mail.outbox) == 0


def test_replies(customer, admin_api, api, flight):
    mine = made(customer, flight(), rating=4)
    response = admin_api.post(f"/api/admin/reviews/{mine.pk}/reply", {"reply": "  Thanks!  "}, format="json")
    assert (response.data["reply"], response.data["replied_by"]) == ("Thanks!", "Owner")
    assert response.data["replied_at"] is not None
    row = api.get("/api/reviews", {"kind": "flight"}).data["results"][0]
    assert (row["reply"], row["replied_at"] is not None) == ("Thanks!", True)

    admin_api.post(f"/api/admin/reviews/{mine.pk}/reply", {"reply": "Thank you, Cara."}, format="json")
    assert Review.objects.get().reply == "Thank you, Cara."
    assert (
        admin_api.post(f"/api/admin/reviews/{mine.pk}/reply", {"reply": "x" * 2001}, format="json").status_code == 400
    )

    # A reply on a hidden review stays hidden with it.
    admin_api.post(f"/api/admin/reviews/{mine.pk}/hide")
    assert admin_api.post(f"/api/admin/reviews/{mine.pk}/reply", {"reply": "Sorry."}, format="json").status_code == 200
    assert api.get("/api/reviews", {"kind": "flight"}).data["results"] == []

    response = admin_api.post(f"/api/admin/reviews/{mine.pk}/reply", {"reply": " "}, format="json")
    assert (response.data["reply"], response.data["replied_by"], response.data["replied_at"]) == ("", None, None)


def test_averages_and_by_rating(customer, api, hotel_booking, make_hotel):
    hotel = make_hotel()
    for rating in (5, 4, 4):
        made(customer, hotel_booking(hotel=hotel), rating=rating)
    made(customer, hotel_booking(), rating=1)  # another hotel

    data = api.get("/api/reviews", {"hotel": str(hotel.pk)}).data
    assert data["summary"] == {"average": 4.3, "count": 3, "by_rating": {"1": 0, "2": 0, "3": 0, "4": 2, "5": 1}}
    assert api.get(f"/api/hotels/{hotel.pk}").data["rating"] == {"average": 4.3, "count": 3}


def test_public_lists_are_newest_first_ten_a_page(customer, api, flight):
    with freeze_time(timezone.now() - timedelta(days=1)):
        oldest = made(customer, flight(), rating=2)
    for _ in range(10):
        made(customer, flight(), rating=5)
    first = api.get("/api/reviews", {"kind": "flight"}).data
    assert (first["count"], len(first["results"])) == (11, 10)
    assert set(first["results"][0]) == {
        "id",
        "rating",
        "comment",
        "reviewer_name",
        "created_at",
        "reply",
        "replied_at",
    }
    second = api.get("/api/reviews", {"kind": "flight", "page": 2}).data
    assert [row["id"] for row in second["results"]] == [str(oldest.pk)]


def test_public_lists_take_exactly_one_scope(api, customer_api, make_tour, make_hotel):
    tour, hotel = make_tour(), make_hotel()
    assert api.get("/api/reviews").status_code == 401
    assert api.get("/api/reviews", {"tour": str(tour.pk), "hotel": str(hotel.pk)}).status_code == 400
    assert api.get("/api/reviews", {"kind": "tour"}).status_code == 400
    assert api.get("/api/reviews", {"tour": "nope"}).status_code == 400
    assert api.get("/api/reviews", {"tour": str(tour.pk)}).data["summary"] == NO_RATING
    assert customer_api.get("/api/reviews").data["results"] == []


def test_rating_fields_on_tours_hotels_explore_and_offers(
    customer, api, tour_booking, hotel_booking, flight, make_tour, make_offer
):
    unrated = make_tour(title="Unrated")
    rated = make_tour(title="Rated")
    made(customer, tour_booking(tour=rated), rating=5)
    made(customer, tour_booking(tour=rated), rating=4, is_hidden=True)
    made(customer, hotel_booking(), rating=3)
    open_offer = make_offer()
    assert api.get("/api/offers").data["service_rating"] is None
    assert api.get(f"/api/offers/{open_offer.pk}").data["service_rating"] is None
    made(customer, flight(), rating=5)
    made(customer, flight(), rating=2, is_hidden=True)

    tours = {row["title"]: row["rating"] for row in api.get("/api/tours").data["results"]}
    assert tours == {"Unrated": None, "Rated": {"average": 4.5, "count": 2}}
    assert api.get(f"/api/tours/{unrated.pk}").data["rating"] is None
    assert api.get("/api/hotels").data["results"][0]["rating"] == {"average": 3.0, "count": 1}
    explore = api.get("/api/explore").data
    assert {row["title"]: row["rating"] for row in explore["tours"]}["Rated"] == {"average": 4.5, "count": 2}
    assert explore["hotels"][0]["rating"] == {"average": 3.0, "count": 1}
    assert api.get("/api/offers").data["service_rating"] == {"average": 3.5, "count": 2}
    assert api.get(f"/api/offers/{open_offer.pk}").data["service_rating"] == {"average": 3.5, "count": 2}


# Admin


def test_admin_list_filters_and_fields(customer, admin_api, flight, tour_booking, hotel_booking, admin_user):
    with freeze_time(timezone.now() - timedelta(hours=2)):
        on_flight = made(customer, flight(), rating=5, reply="Thanks", replied_by=admin_user)
    with freeze_time(timezone.now() - timedelta(hours=1)):
        on_tour = made(customer, tour_booking(), rating=2, is_hidden=True)
    on_hotel = made(customer, hotel_booking(), rating=4)

    def ids(**params):
        return [row["id"] for row in admin_api.get("/api/admin/reviews", params).data["results"]]

    assert ids() == [str(on_hotel.pk), str(on_tour.pk), str(on_flight.pk)]
    assert ids(kind="tour") == [str(on_tour.pk)]
    assert ids(tour=str(on_tour.tour_id)) == [str(on_tour.pk)]
    assert ids(hotel=str(on_hotel.hotel_id)) == [str(on_hotel.pk)]
    assert ids(rating=5) == [str(on_flight.pk)]
    assert ids(hidden="true") == [str(on_tour.pk)]
    assert ids(hidden="false") == [str(on_hotel.pk), str(on_flight.pk)]
    assert ids(replied="true") == [str(on_flight.pk)]
    assert ids(replied="false") == [str(on_hotel.pk), str(on_tour.pk)]

    data = admin_api.get(f"/api/admin/reviews/{on_flight.pk}").data
    assert data["customer"] == {"id": str(customer.pk), "full_name": "Cara Customer", "email": "customer@example.com"}
    assert data["booking"] == {"kind": "flight", "id": str(on_flight.booking_id), "title": "NBO → LHR"}
    assert data["item"] is None
    assert admin_api.get(f"/api/admin/reviews/{on_tour.pk}").data["item"]["title"] == "Maasai Mara, 3 days"


def test_admin_endpoints_are_for_admins(customer, customer_api, api, flight):
    mine = made(customer, flight())
    for client in (customer_api, api):
        assert client.get("/api/admin/reviews").status_code in (401, 403)
        assert client.get(f"/api/admin/reviews/{mine.pk}").status_code in (401, 403)
        assert client.post(f"/api/admin/reviews/{mine.pk}/hide").status_code in (401, 403)
        assert client.post(f"/api/admin/reviews/{mine.pk}/reply", {"reply": "x"}, format="json").status_code in (
            401,
            403,
        )
    assert Review.objects.get().is_hidden is False


# Emails and the daily task


def test_a_new_review_emails_the_agency_admin(customer_api, tour_booking, django_capture_on_commit_callbacks):
    booking = tour_booking()
    with django_capture_on_commit_callbacks(execute=True):
        response = review(customer_api, booking, rating=4, comment="Great guide.")
    [email] = mail.outbox
    assert email.to == ["desk@agency.test"]
    assert email.subject == "New 4★ review: Maasai Mara, 3 days"
    assert "★★★★☆ (4/5)" in email.body
    assert "Great guide." in email.body
    assert f"/admin/reviews/{response.data['id']}" in email.body
    assert "Great guide." in html_part(email)

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        customer_api.patch(f"/api/reviews/{response.data['id']}", {"comment": "Edited."}, format="json")
    assert mail.outbox == []


@freeze_time("2026-05-10 09:00:00+03:00")
def test_request_reviews_once_per_booking_when_reviewable(
    flight, tour_booking, hotel_booking, django_capture_on_commit_callbacks
):
    left = flight(days_ago=1)
    flight(days_ago=0)  # last flight today
    flight(status=FlightStatus.CANCELLED, days_ago=3)
    toured = tour_booking()
    tour_booking(status=TourBooking.Status.CONFIRMED)
    stayed = hotel_booking(check_out_days_ago=0)
    hotel_booking(check_out_days_ago=-1)

    with django_capture_on_commit_callbacks(execute=True):
        assert tasks.request_reviews() == 3
    assert sorted(email.to[0] for email in mail.outbox) == ["customer@example.com"] * 3
    assert {email.subject for email in mail.outbox} == {"How was your trip?"}
    flight_email = next(email for email in mail.outbox if f"/bookings/{left.pk}" in email.body)
    assert "not the airline or the flight itself" in flight_email.body
    assert "Leave a review" in html_part(flight_email)
    tour_email = next(email for email in mail.outbox if f"/bookings?tour={toured.pk}" in email.body)
    assert "not the airline" not in tour_email.body
    assert any(f"/bookings?hotel={stayed.pk}" in email.body for email in mail.outbox)
    for booking in (left, toured, stayed):
        booking.refresh_from_db()
        assert booking.review_requested_at == timezone.now()

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert tasks.request_reviews() == 0
    with freeze_time("2026-05-11 09:00:00+03:00"), django_capture_on_commit_callbacks(execute=True):
        assert tasks.request_reviews() == 2  # the flight and the stay that ended a day later
    assert len(mail.outbox) == 2


@freeze_time("2026-05-10 09:00:00+03:00")
def test_request_reviews_skips_reviewed_bookings_and_modules_off(
    customer, flight, tour_booking, django_capture_on_commit_callbacks
):
    made(customer, flight())
    booking = tour_booking()
    set_modules("flights")
    with django_capture_on_commit_callbacks(execute=True):
        assert tasks.request_reviews() == 0
        # Queued before the module was turned off: dropped.
        tasks.notify_customer_review_request.delay(TEST_SCHEMA, "tour", str(booking.pk))
    assert mail.outbox == []


# Modules and agencies


def test_reviews_answer_module_off_for_a_module_that_is_off(
    customer, customer_api, admin_api, api, tour_booking, flight
):
    booking = tour_booking()
    mine = made(customer, booking)
    on_flight = made(customer, flight())
    set_modules("flights", "hotels")
    off = {"detail": "This part of the site isn't available.", "code": "module_off"}
    for response in (
        api.get("/api/reviews", {"tour": str(booking.tour_id)}),
        review(customer_api, tour_booking()),
        customer_api.patch(f"/api/reviews/{mine.pk}", {"rating": 1}, format="json"),
        customer_api.delete(f"/api/reviews/{mine.pk}"),
        admin_api.get("/api/admin/reviews", {"kind": "tour"}),
        admin_api.get("/api/admin/reviews", {"tour": str(booking.tour_id)}),
        admin_api.get(f"/api/admin/reviews/{mine.pk}"),
        admin_api.post(f"/api/admin/reviews/{mine.pk}/hide"),
    ):
        assert response.status_code == 404
        assert response.json() == off
    assert [row["id"] for row in admin_api.get("/api/admin/reviews").data["results"]] == [str(on_flight.pk)]
    assert [row["id"] for row in customer_api.get("/api/reviews").data["results"]] == [str(on_flight.pk)]
    set_modules("tours")
    assert api.get("/api/reviews", {"kind": "flight"}).status_code == 404
    set_modules("flights", "tours")
    assert Review.objects.count() == 2


def test_reviews_stay_in_their_agency(customer, flight):
    made(customer, flight(), rating=1)
    with schema_context(OTHER_SCHEMA):
        admin = User.objects.create_user(
            email="other-admin@example.com", password="Str0ng-pass!", full_name="Other", role=User.Role.ADMIN
        )
    other = APIClient(HTTP_HOST=OTHER_DOMAIN)
    assert other.get("/api/reviews", {"kind": "flight"}).data["summary"] == NO_RATING
    other.force_authenticate(admin)
    assert other.get("/api/admin/reviews").data["results"] == []
    assert APIClient().get("/api/reviews", {"kind": "flight"}).data["summary"]["count"] == 1
