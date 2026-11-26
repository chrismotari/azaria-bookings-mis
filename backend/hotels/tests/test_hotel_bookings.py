from datetime import timedelta
from decimal import Decimal

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from freezegun import freeze_time

from accounts.models import User
from bookings import tasks as booking_tasks
from bookings.models import Traveller
from core.tests.helpers import OTHER_SCHEMA, TEST_SCHEMA, html_part
from hotels import services, tasks
from hotels.models import Hotel, HotelBooking, HotelBookingRoom, RatePeriod, RoomRate, RoomType
from hotels.tests.conftest import booking_body, booking_data, days, rate_of, room
from tenants.models import Tenant
from tenants.tests.test_modules import patch_modules, set_modules
from tenants.tests.test_platform import owner, platform  # noqa: F401 (fixtures)
from tours.models import Tour, TourBooking, TourBookingLine, TourPriceOption
from tours.tests.conftest import tour_fields

pytestmark = pytest.mark.django_db

Status = HotelBooking.Status


def request_booking(client, hotel, *rooms, **extra):
    return client.post("/api/hotel-bookings", booking_body(hotel, *rooms, **extra), format="json")


def stay(check_in, nights):
    return {"check_in": days(check_in).isoformat(), "check_out": days(check_in + nights).isoformat()}


@pytest.fixture
def booked(make_hotel, customer):
    """A requested booking of one Deluxe Double for 2 adults, 3 nights from the day after tomorrow ($390)."""

    def make(status=Status.REQUESTED, **extra):
        hotel = make_hotel()
        booking = services.create_booking(customer, booking_data(hotel, room(rate_of(hotel)), **extra))
        HotelBooking.objects.filter(pk=booking.pk).update(status=status)
        return HotelBooking.objects.get(pk=booking.pk)

    return make


def pdf(name="voucher.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 voucher", content_type="application/pdf")


# Pricing


def test_nights_across_two_periods_and_the_per_adult_charge(api, make_hotel):
    hotel = make_hotel(
        rates=[
            {"name": "Bed & breakfast", "per_adult_per_night": "15"},
            {"name": "Room only", "per_adult_per_night": "0"},
        ]
    )
    # Two nights at $100 and one at $150.
    data = api.get(f"/api/hotels/{hotel.pk}", stay(28, 3)).data
    breakfast, room_only = data["room_types"][0]["rates"]
    assert breakfast["nights"] == 3
    assert breakfast["room_price"] == "350.00"
    # The adults priced: the rate's max_adults (2) without adults.
    assert breakfast["stay_price"] == "440.00"
    assert room_only["stay_price"] == "350.00"
    assert data["from_price"] == "350.00"
    one = api.get(f"/api/hotels/{hotel.pk}", {**stay(28, 3), "adults": 1}).data["room_types"][0]["rates"][0]
    assert one["stay_price"] == "395.00"
    # Adults above the rate's max are capped.
    three = api.get(f"/api/hotels/{hotel.pk}", {**stay(28, 3), "adults": 3}).data["room_types"][0]["rates"][0]
    assert three["stay_price"] == "440.00"


def test_a_night_not_covered_is_not_offered(api, make_hotel):
    hotel = make_hotel(rates=[{"name": "B&B", "periods": [(0, 9, "100"), (11, 20, "100")]}])
    rate = api.get(f"/api/hotels/{hotel.pk}", stay(8, 4)).data["room_types"][0]["rates"][0]
    assert rate["available"] is False
    assert rate["stay_price"] is None
    assert api.get("/api/hotels", stay(8, 4)).data["results"] == []
    assert api.get("/api/hotels", stay(11, 4)).data["count"] == 1
    without_dates = api.get(f"/api/hotels/{hotel.pk}").data["room_types"][0]["rates"][0]
    assert without_dates["available"] is None
    assert without_dates["stay_price"] is None


def test_from_price_with_and_without_dates(api, make_hotel):
    make_hotel(rates=[{"name": "B&B", "per_adult_per_night": "10", "periods": [(-10, -1, "50"), (0, 9, "100")]}])
    # Without dates: the lowest night of periods not ended, for 2 adults.
    assert api.get("/api/hotels").data["results"][0]["from_price"] == "120.00"
    assert api.get("/api/hotels", {"adults": 1}).data["results"][0]["from_price"] == "110.00"
    assert api.get("/api/hotels", stay(1, 2)).data["results"][0]["from_price"] == "240.00"


def test_inactive_hotel_room_type_or_rate_is_not_offered(api, make_hotel):
    hotel = make_hotel()
    rate = rate_of(hotel)
    assert api.get("/api/hotels").data["count"] == 1
    RoomRate.objects.filter(pk=rate.pk).update(is_active=False)
    assert api.get("/api/hotels").data["count"] == 0
    RoomRate.objects.filter(pk=rate.pk).update(is_active=True)
    RoomType.objects.filter(pk=rate.room_type_id).update(is_active=False)
    assert api.get("/api/hotels").data["count"] == 0
    RoomType.objects.filter(pk=rate.room_type_id).update(is_active=True)
    Hotel.objects.filter(pk=hotel.pk).update(is_active=False)
    assert api.get("/api/hotels").data["count"] == 0
    assert api.get(f"/api/hotels/{hotel.pk}").status_code == 404


def test_a_hotel_whose_periods_have_ended_is_not_listed(api, make_hotel):
    make_hotel(rates=[{"name": "B&B", "periods": [(-10, -1, "50")]}])
    assert api.get("/api/hotels").data["count"] == 0


# Filters and ordering


def test_public_filters_and_ordering(api, make_hotel):
    make_hotel(
        name="Budget Inn", destination="Nairobi", star_rating=2, rates=[{"name": "R", "periods": [(0, 30, "40")]}]
    )
    make_hotel(
        name="Acacia Lodge",
        destination="Maasai Mara",
        star_rating=None,
        rates=[{"name": "R", "periods": [(0, 30, "90")]}],
    )
    make_hotel(
        name="Coral Palace", destination="Diani", star_rating=5, rates=[{"name": "R", "periods": [(0, 30, "300")]}]
    )
    make_hotel(
        name="Zebra Camp",
        rates=[{"name": "Family", "max_adults": 2, "max_children": 1, "periods": [(0, 5, "150")]}],
    )

    def names(**params):
        return [row["name"] for row in api.get("/api/hotels", params).data["results"]]

    assert names() == ["Budget Inn", "Acacia Lodge", "Zebra Camp", "Coral Palace"]
    assert names(ordering="-star_rating") == ["Coral Palace", "Zebra Camp", "Budget Inn", "Acacia Lodge"]
    assert names(ordering="name") == ["Acacia Lodge", "Budget Inn", "Coral Palace", "Zebra Camp"]
    assert names(destination="mara") == ["Acacia Lodge"]
    assert names(name="PALACE") == ["Coral Palace"]
    assert names(destination="diani", name="coral") == ["Coral Palace"]
    assert names(destination="mara", name="coral") == []
    assert names(stars=4) == ["Zebra Camp", "Coral Palace"]
    assert names(price_min="100") == ["Zebra Camp", "Coral Palace"]
    assert names(price_max="100") == ["Budget Inn", "Acacia Lodge"]
    assert names(**stay(10, 2)) == ["Budget Inn", "Acacia Lodge", "Coral Palace"]
    assert names(children=2) == []
    assert names(adults=3) == []
    assert names(adults=2, children=1) == ["Budget Inn", "Acacia Lodge", "Zebra Camp", "Coral Palace"]


def test_stay_parameters_are_checked(api, make_hotel):
    make_hotel()
    assert api.get("/api/hotels", {"check_in": days(1).isoformat()}).status_code == 400
    assert api.get("/api/hotels", stay(-1, 2)).status_code == 400
    assert api.get("/api/hotels", stay(1, 31)).status_code == 400
    assert (
        api.get("/api/hotels", {"check_in": days(2).isoformat(), "check_out": days(2).isoformat()}).status_code == 400
    )
    assert api.get("/api/hotels", stay(1, 30)).status_code == 200


# Creating bookings


def test_customer_requests_two_rooms(customer_api, make_hotel, django_capture_on_commit_callbacks):
    hotel = make_hotel()
    rate = rate_of(hotel)
    with django_capture_on_commit_callbacks(execute=True):
        response = request_booking(
            customer_api,
            hotel,
            room(rate, adults=2, children=1, guests=[{"full_name": "Wanjiru Kamau"}, {"full_name": "Baraka Kamau"}]),
            room(rate, adults=1),
            special_requests="Sea view",
            notes="Late arrival",
        )
    assert response.status_code == 201, response.data
    data = response.data
    assert data["status"] == "requested"
    assert data["nights"] == 3
    # 3 × $100 + 3 × 2 × $15 = $390; 3 × $100 + 3 × $15 = $345.
    rooms = sorted(data["rooms"], key=lambda item: item["price"])
    assert [r["price"] for r in rooms] == ["345.00", "390.00"]
    assert data["total"] == "735.00"
    assert [g["full_name"] for g in rooms[1]["guests"]] == ["Wanjiru Kamau", "Baraka Kamau"]
    assert data["can_cancel"] is True
    assert data["can_edit_guests"] is True
    assert data["events"][0]["to_status"] == "requested"
    [email] = mail.outbox
    assert email.to == ["desk@agency.test"]
    assert email.subject == "New hotel booking from Cara Customer: Diani Reef"


def test_admin_books_for_a_customer_without_an_admin_email(
    admin_api, admin_user, customer, make_hotel, django_capture_on_commit_callbacks
):
    hotel = make_hotel()
    body = {**booking_body(hotel, room(rate_of(hotel))), "user": str(customer.pk)}
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post("/api/admin/hotel-bookings", body, format="json")
    assert response.status_code == 201, response.data
    assert response.data["status"] == "requested"
    assert response.data["created_by"] == admin_user.full_name
    assert response.data["user"]["email"] == customer.email
    assert mail.outbox == []
    inactive = User.objects.create_user(email="gone@example.com", password="x", full_name="Gone", is_active=False)
    response = admin_api.post("/api/admin/hotel-bookings", {**body, "user": str(inactive.pk)}, format="json")
    assert response.data == {"user": ["Choose an active customer."]}


@pytest.mark.parametrize(
    ("make_room", "status_code"),
    [
        (lambda rate: room(rate, adults=3), 400),
        (lambda rate: room(rate, children=2), 400),
        (lambda rate: room(rate, adults=0), 400),
        (lambda rate: room(rate, guests=[]), 400),
        (lambda rate: room(rate, adults=1, guests=[{"full_name": "A B"}, {"full_name": "C D"}]), 400),
        (lambda rate: room(rate, guests=[{"full_name": "X"}]), 400),
    ],
)
def test_occupancy_and_guests_are_checked(customer_api, make_hotel, make_room, status_code):
    hotel = make_hotel()
    assert request_booking(customer_api, hotel, make_room(rate_of(hotel))).status_code == status_code
    assert not HotelBooking.objects.exists()


def test_rooms_nights_and_check_in_are_checked(customer_api, make_hotel):
    hotel = make_hotel()
    rate = rate_of(hotel)
    assert request_booking(customer_api, hotel).data == {"rooms": ["Choose from 1 to 9 rooms."]}
    assert request_booking(customer_api, hotel, *[room(rate)] * 10).data == {"rooms": ["Choose from 1 to 9 rooms."]}
    assert request_booking(customer_api, hotel, *[room(rate)] * 9).status_code == 201
    assert request_booking(customer_api, hotel, room(rate), nights=0).status_code == 400
    response = request_booking(customer_api, hotel, room(rate), check_in=0, nights=31)
    assert response.data == {"check_out": ["A stay is from 1 to 30 nights."]}
    response = request_booking(customer_api, hotel, room(rate), check_in=-1)
    assert response.data == {"check_in": ["Check-in cannot be in the past."]}
    assert request_booking(customer_api, hotel, room(rate), check_in=0, nights=30).status_code == 201


def test_the_booker_needs_a_phone(customer, customer_api, make_hotel):
    hotel = make_hotel()
    customer.phone = ""
    customer.save(update_fields=["phone"])
    response = request_booking(customer_api, hotel, room(rate_of(hotel)))
    assert response.data == {"phone": ["Add a phone number so the agency can reach you."]}
    assert request_booking(customer_api, hotel, room(rate_of(hotel)), phone="+254711000000").status_code == 201
    assert User.objects.get(pk=customer.pk).phone == "+254711000000"


def test_a_rate_that_stopped_covering_the_dates_answers_409(customer_api, make_hotel):
    hotel = make_hotel()
    rate = rate_of(hotel)
    RatePeriod.objects.filter(rate=rate, start_date=days(0)).update(end_date=days(2))
    response = request_booking(customer_api, hotel, room(rate), check_in=2, nights=3)
    assert response.status_code == 409
    assert response.data == {"detail": "Deluxe Double is not available for these dates."}
    RoomRate.objects.filter(pk=rate.pk).update(is_active=False)
    assert request_booking(customer_api, hotel, room(rate), check_in=0, nights=2).status_code == 409


def test_a_rate_of_another_room_type_or_hotel_is_refused(customer_api, make_hotel):
    hotel, other = make_hotel(), make_hotel(name="Other")
    response = request_booking(customer_api, hotel, room(rate_of(other)))
    assert response.status_code == 400
    assert "rooms" in response.data
    mixed = {**room(rate_of(hotel)), "room_type": str(rate_of(other).room_type_id)}
    assert request_booking(customer_api, hotel, mixed).status_code == 400


def test_prices_are_copied_and_unchanged_by_later_edits(customer, make_hotel):
    hotel = make_hotel()
    rate = rate_of(hotel)
    booking = services.create_booking(customer, booking_data(hotel, room(rate)))
    RatePeriod.objects.filter(rate=rate).update(price_per_night=999)
    RoomRate.objects.filter(pk=rate.pk).update(per_adult_per_night=50, name="Renamed")
    stored = HotelBookingRoom.objects.get(booking=booking)
    assert (stored.price, stored.per_adult_per_night, stored.rate_name) == (
        Decimal("390.00"),
        Decimal("15.00"),
        "Bed & breakfast",
    )
    assert HotelBooking.objects.get(pk=booking.pk).total == Decimal("390.00")


def test_admins_cannot_book_on_the_customer_endpoint(admin_api, make_hotel):
    hotel = make_hotel()
    assert request_booking(admin_api, hotel, room(rate_of(hotel))).status_code == 403


# Transitions


def confirm(admin_api, booking, **body):
    return admin_api.post(f"/api/admin/hotel-bookings/{booking.pk}/confirm-availability", body, format="json")


def test_the_whole_flow_with_a_new_total(
    admin_api, customer_api, booked, private_media, django_capture_on_commit_callbacks
):
    booking = booked()
    with django_capture_on_commit_callbacks(execute=True):
        response = confirm(admin_api, booking, new_total="420.00", note="Sea view rooms only")
    assert response.status_code == 200, response.data
    assert response.data["changes"] == {"total": {"old": "390.00", "new": "420.00"}, "note": "Sea view rooms only"}
    assert response.data["total"] == "390.00"
    [confirmed] = mail.outbox
    assert confirmed.subject == "Rooms confirmed: please complete your payment for Diani Reef"
    for expected in ("USD 390.00", "USD 420.00", "Sea view rooms only", "M-Pesa paybill 123456."):
        assert expected in confirmed.body

    # Not paid while the new total awaits acceptance.
    assert admin_api.post(f"/api/admin/hotel-bookings/{booking.pk}/mark-paid").status_code == 409
    response = customer_api.post(f"/api/hotel-bookings/{booking.pk}/accept-changes")
    assert response.data["total"] == "420.00"
    assert response.data["changes_accepted"] is True
    assert customer_api.post(f"/api/hotel-bookings/{booking.pk}/accept-changes").status_code == 409

    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.post(f"/api/admin/hotel-bookings/{booking.pk}/mark-paid").status_code == 200
    assert mail.outbox[0].subject == "Payment received: Diani Reef"

    # Send voucher needs a voucher and the confirmation number.
    complete = f"/api/admin/hotel-bookings/{booking.pk}/complete"
    assert admin_api.post(complete, {"hotel_confirmation": "DR-1"}, format="json").status_code == 409
    upload = admin_api.post(f"/api/admin/hotel-bookings/{booking.pk}/vouchers", {"file": pdf()}, format="multipart")
    assert upload.status_code == 201, upload.data
    assert admin_api.post(complete, {"hotel_confirmation": " "}, format="json").status_code == 400
    assert admin_api.post(complete, {}, format="json").status_code == 400
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(complete, {"hotel_confirmation": "DR-12345"}, format="json")
    assert response.status_code == 200
    assert response.data["hotel_confirmation"] == "DR-12345"
    [voucher] = mail.outbox
    assert voucher.subject == "Your hotel voucher: Diani Reef"
    assert "DR-12345" in voucher.body
    assert "Free cancellation until 7 days before." in voucher.body
    assert [attachment[0] for attachment in voucher.attachments] == ["voucher.pdf"]
    # The customer opens it once completed.
    voucher_id = response.data["vouchers"][0]["id"]
    customer_view = customer_api.get(f"/api/hotel-bookings/{booking.pk}").data
    assert customer_view["vouchers"][0]["id"] == voucher_id
    assert customer_api.get(f"/api/hotel-vouchers/{voucher_id}/download").status_code == 200


def test_confirm_without_a_new_total_and_the_note_rule(admin_api, booked):
    booking = booked()
    assert confirm(admin_api, booking, note="Why").data == {"new_total": ["Enter the new total the note explains."]}
    response = confirm(admin_api, booking, new_total="390.00")
    assert response.data["changes"] is None
    assert response.data["payment_deadline"] is not None


def test_confirm_needs_payment_instructions(admin_api, booked):
    from core.models import AppSettings

    AppSettings.objects.update(payment_instructions="")
    assert confirm(admin_api, booked()).status_code == 409


def test_customer_declines_a_new_total_without_an_email(
    admin_api, customer_api, booked, django_capture_on_commit_callbacks
):
    booking = booked()
    assert customer_api.post(f"/api/hotel-bookings/{booking.pk}/decline-changes").status_code == 409
    confirm(admin_api, booking, new_total="500")
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = customer_api.post(f"/api/hotel-bookings/{booking.pk}/decline-changes")
    assert response.data["status"] == "declined"
    assert mail.outbox == []


@pytest.mark.parametrize("status", [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED])
def test_customer_cancels_without_an_email(customer_api, booked, status, django_capture_on_commit_callbacks):
    booking = booked(status)
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = customer_api.post(f"/api/hotel-bookings/{booking.pk}/cancel")
    assert response.data["status"] == "cancelled"
    assert response.data["can_cancel"] is False
    assert mail.outbox == []


def test_unavailable_with_a_message(admin_api, booked, django_capture_on_commit_callbacks):
    booking = booked()
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(
            f"/api/admin/hotel-bookings/{booking.pk}/mark-unavailable",
            {"message": "Fully booked that week."},
            format="json",
        )
    assert response.data["status"] == "unavailable"
    assert response.data["unavailable_message"] == "Fully booked that week."
    [email] = mail.outbox
    assert "Fully booked that week." in email.body
    assert "Fully booked that week." in html_part(email)


@pytest.mark.parametrize(
    ("status", "path", "who"),
    [
        (Status.PAID, "cancel", "customer"),
        (Status.COMPLETED, "cancel", "customer"),
        (Status.REQUESTED, "mark-paid", "admin"),
        (Status.PAID, "confirm-availability", "admin"),
        (Status.COMPLETED, "mark-unavailable", "admin"),
        (Status.CANCELLED, "confirm-availability", "admin"),
        (Status.REQUESTED, "complete", "admin"),
    ],
)
def test_moves_the_state_machine_refuses(admin_api, customer_api, booked, status, path, who):
    booking = booked(status)
    if who == "customer":
        response = customer_api.post(f"/api/hotel-bookings/{booking.pk}/{path}")
    else:
        response = admin_api.post(
            f"/api/admin/hotel-bookings/{booking.pk}/{path}", {"hotel_confirmation": "X"}, format="json"
        )
    assert response.status_code == 409
    assert HotelBooking.objects.get(pk=booking.pk).status == status


def test_only_the_right_actor_moves_a_booking(booked, customer, other_customer, admin_user):
    booking = booked()
    with pytest.raises(services.InvalidTransition):
        services.transition(booking.pk, Status.AVAILABILITY_CONFIRMED, customer)
    with pytest.raises(services.InvalidTransition):
        services.transition(booking.pk, Status.CANCELLED, other_customer)
    with pytest.raises(services.InvalidTransition):
        services.transition(booking.pk, Status.CANCELLED, admin_user)
    with pytest.raises(services.InvalidTransition):
        services.transition(booking.pk, Status.EXPIRED, admin_user)


def test_mark_paid_is_refused_after_the_deadline(admin_api, booked):
    booking = booked()
    confirm(admin_api, booking)
    with freeze_time(timezone.now() + timedelta(hours=25)):
        response = admin_api.post(f"/api/admin/hotel-bookings/{booking.pk}/mark-paid")
    assert response.status_code == 409


# Scheduled tasks


def test_unpaid_bookings_expire_after_the_deadline(admin_api, booked, django_capture_on_commit_callbacks):
    booking = booked()
    confirm(admin_api, booking)
    mail.outbox.clear()
    with freeze_time(timezone.now() + timedelta(hours=23)):
        assert booking_tasks.expire_unpaid_bookings() == 0
    with freeze_time(timezone.now() + timedelta(hours=25)), django_capture_on_commit_callbacks(execute=True):
        assert booking_tasks.expire_unpaid_bookings() == 1
    stored = HotelBooking.objects.get(pk=booking.pk)
    assert stored.status == "expired"
    assert stored.events.last().actor is None
    [email] = mail.outbox
    assert email.subject == "Your hotel booking has expired: Diani Reef"
    assert "did not receive your payment" in email.body


def test_requests_expire_on_the_check_in_day(booked, django_capture_on_commit_callbacks):
    booking = booked()
    with freeze_time(timezone.now() + timedelta(days=1)):
        assert booking_tasks.expire_stale_requests() == 0
    with freeze_time(timezone.now() + timedelta(days=2)), django_capture_on_commit_callbacks(execute=True):
        assert booking_tasks.expire_stale_requests() == 1
    assert HotelBooking.objects.get(pk=booking.pk).status == "expired"
    assert "before the check-in day" in mail.outbox[-1].body


def test_one_payment_reminder(admin_api, booked, django_capture_on_commit_callbacks):
    booking = booked()
    confirm(admin_api, booking)
    mail.outbox.clear()
    with freeze_time(timezone.now() + timedelta(hours=19)):
        assert booking_tasks.send_payment_reminders() == 0
    with freeze_time(timezone.now() + timedelta(hours=21)), django_capture_on_commit_callbacks(execute=True):
        assert booking_tasks.send_payment_reminders() == 1
        assert booking_tasks.send_payment_reminders() == 0
    [email] = mail.outbox
    assert email.subject == "Reminder: your payment for Diani Reef is due soon"
    assert HotelBooking.objects.get(pk=booking.pk).reminder_sent_at is not None


def test_queued_emails_recheck_the_booking(booked):
    booking = booked(Status.CANCELLED)
    mail.outbox.clear()
    for task in (
        tasks.notify_admin_new_hotel_booking,
        tasks.notify_customer_hotel_availability_confirmed,
        tasks.notify_customer_hotel_unavailable,
        tasks.notify_customer_hotel_payment_received,
        tasks.notify_customer_hotel_booking_expired,
        tasks.notify_customer_hotel_payment_reminder,
        tasks.notify_customer_hotel_voucher,
    ):
        task.delay(TEST_SCHEMA, booking.pk)
    assert mail.outbox == []


def test_emails_show_the_stay(booked):
    booking = booked(special_requests="Ground floor please")
    mail.outbox.clear()
    tasks.notify_admin_new_hotel_booking.delay(TEST_SCHEMA, booking.pk)
    [email] = mail.outbox
    for expected in (
        "Diani Reef",
        "Beach Road, Diani Beach, Kenya",
        "(3 nights)",
        "Check-in from 14:00, check-out by 10:00",
        "Deluxe Double, Bed & breakfast (2 adults; lead guest Wanjiru Kamau): USD 390.00",
        "Ground floor please",
        "USD 390.00",
        f"/admin/hotels/{booking.pk}",
    ):
        assert expected in email.body, expected
    assert "Wanjiru Kamau" in html_part(email)


# Vouchers


def test_voucher_upload_rules(admin_api, booked, private_media, django_capture_on_commit_callbacks):
    booking = booked(Status.AVAILABILITY_CONFIRMED)
    path = f"/api/admin/hotel-bookings/{booking.pk}/vouchers"
    assert admin_api.post(path, {"file": pdf()}, format="multipart").status_code == 409
    HotelBooking.objects.filter(pk=booking.pk).update(status=Status.PAID)
    gif = SimpleUploadedFile("a.gif", b"GIF89a", content_type="image/gif")
    assert admin_api.post(path, {"file": gif}, format="multipart").status_code == 400
    fake = SimpleUploadedFile("a.pdf", b"not a pdf", content_type="application/pdf")
    assert admin_api.post(path, {"file": fake}, format="multipart").status_code == 400
    ids = [admin_api.post(path, {"file": pdf()}, format="multipart").data["id"] for _ in range(10)]
    response = admin_api.post(path, {"file": pdf()}, format="multipart")
    assert response.data == {"file": ["A booking can have at most 10 vouchers."]}
    stored = booking.vouchers.get(pk=ids[0])
    assert stored.file.name.startswith(f"hotel_vouchers/test/{booking.pk}/")
    file_path = private_media / stored.file.name
    assert file_path.exists()
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.delete(f"/api/admin/hotel-vouchers/{ids[0]}").status_code == 204
    assert not file_path.exists()
    HotelBooking.objects.filter(pk=booking.pk).update(status=Status.COMPLETED)
    assert admin_api.delete(f"/api/admin/hotel-vouchers/{ids[1]}").status_code == 409


def test_vouchers_are_hidden_from_customers_until_completed(admin_api, customer_api, other_customer_api, booked):
    booking = booked(Status.PAID)
    voucher = admin_api.post(
        f"/api/admin/hotel-bookings/{booking.pk}/vouchers", {"file": pdf()}, format="multipart"
    ).data["id"]
    assert customer_api.get(f"/api/hotel-bookings/{booking.pk}").data["vouchers"] == []
    assert customer_api.get(f"/api/hotel-vouchers/{voucher}/download").status_code == 404
    assert admin_api.get(f"/api/hotel-vouchers/{voucher}/download").status_code == 200
    HotelBooking.objects.filter(pk=booking.pk).update(status=Status.COMPLETED)
    assert customer_api.get(f"/api/hotel-vouchers/{voucher}/download").status_code == 200
    assert other_customer_api.get(f"/api/hotel-vouchers/{voucher}/download").status_code == 404


# Guests


def test_guests_up_to_the_room_limit_and_the_lead_guest_stays(customer_api, booked):
    booking = booked()
    room_id = booking.rooms.get().pk
    lead = booking.rooms.get().travellers.get()
    path = f"/api/hotel-bookings/{booking.pk}/rooms/{room_id}/guests"
    added = customer_api.post(path, {"full_name": "Baraka Kamau"}, format="json")
    assert added.status_code == 201
    # 2 adults and no children: full.
    assert customer_api.post(path, {"full_name": "Third Guest"}, format="json").data == {
        "room": ["This room holds at most 2 guests."]
    }
    edited = customer_api.patch(
        f"/api/hotel-bookings/{booking.pk}/guests/{lead.pk}", {"nationality": "ke"}, format="json"
    )
    assert edited.data["nationality"] == "KE"
    assert customer_api.delete(f"/api/hotel-bookings/{booking.pk}/guests/{lead.pk}").status_code == 409
    assert customer_api.delete(f"/api/hotel-bookings/{booking.pk}/guests/{added.data['id']}").status_code == 204
    assert (
        customer_api.patch(
            f"/api/hotel-bookings/{booking.pk}/guests/{lead.pk}", {"full_name": "X"}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.parametrize(
    ("status", "customer_code", "admin_code"),
    [
        (Status.REQUESTED, 200, 200),
        (Status.AVAILABILITY_CONFIRMED, 409, 200),
        (Status.PAID, 409, 200),
        (Status.COMPLETED, 409, 409),
        (Status.CANCELLED, 409, 409),
    ],
)
def test_who_edits_guests_when(customer_api, admin_api, booked, status, customer_code, admin_code):
    booking = booked(status)
    lead = booking.rooms.get().travellers.get()
    body = {"special_requests": "Vegetarian"}
    assert (
        customer_api.patch(f"/api/hotel-bookings/{booking.pk}/guests/{lead.pk}", body, format="json").status_code
        == customer_code
    )
    assert (
        admin_api.patch(f"/api/admin/hotel-bookings/{booking.pk}/guests/{lead.pk}", body, format="json").status_code
        == admin_code
    )
    response = admin_api.get(f"/api/admin/hotel-bookings/{booking.pk}")
    assert response.data["can_edit_guests"] is (admin_code == 200)
    assert customer_api.get(f"/api/hotel-bookings/{booking.pk}").data["can_edit_guests"] is (customer_code == 200)


def test_guests_are_never_visible_to_other_customers(customer_api, other_customer_api, booked):
    booking = booked()
    lead = booking.rooms.get().travellers.get()
    assert other_customer_api.get(f"/api/hotel-bookings/{booking.pk}").status_code == 404
    assert other_customer_api.get("/api/hotel-bookings").data["results"] == []
    assert (
        other_customer_api.patch(
            f"/api/hotel-bookings/{booking.pk}/guests/{lead.pk}", {"full_name": "Hacker"}, format="json"
        ).status_code
        == 404
    )
    assert customer_api.get("/api/hotel-bookings").data["count"] == 1


def test_the_traveller_check_allows_exactly_one_of_three_owners(booked, customer):
    hotel_room = booked().rooms.get()
    tour = Tour.objects.create(**tour_fields())
    option = TourPriceOption.objects.create(tour=tour, name="Regular", price=100)
    tour_booking = TourBooking.objects.create(tour=tour, user=customer, people=1)
    line = TourBookingLine.objects.create(
        booking=tour_booking, option=option, option_name="Regular", unit_price=100, people_per_unit=1, quantity=1
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        Traveller.objects.create(full_name="Nobody")
    with pytest.raises(IntegrityError), transaction.atomic():
        Traveller.objects.create(full_name="Two Owners", hotel_room=hotel_room, tour_line=line)
    assert Traveller.objects.create(full_name="Room Guest", hotel_room=hotel_room).hotel_room == hotel_room


# Modules and isolation


@pytest.mark.parametrize(
    ("who", "method", "url"),
    [
        ("api", "get", "/api/hotels"),
        ("api", "get", "/api/hotels/{hotel}"),
        ("customer_api", "get", "/api/hotel-bookings"),
        ("customer_api", "get", "/api/hotel-bookings/{booking}"),
        ("customer_api", "post", "/api/hotel-bookings/{booking}/cancel"),
        ("customer_api", "post", "/api/hotel-bookings/{booking}/rooms/{room}/guests"),
        ("admin_api", "get", "/api/admin/hotels"),
        ("admin_api", "get", "/api/admin/hotels/{hotel}"),
        ("admin_api", "get", "/api/admin/hotel-bookings"),
        ("admin_api", "post", "/api/admin/hotel-bookings/{booking}/mark-paid"),
    ],
)
def test_hotel_endpoints_answer_module_off_when_hotels_is_off(request, booked, who, method, url):
    booking = booked()
    url = url.format(hotel=booking.hotel_id, booking=booking.pk, room=booking.rooms.get().pk)
    client = request.getfixturevalue(who)
    assert getattr(client, method)(url).status_code != 404
    set_modules("flights")
    response = getattr(client, method)(url)
    assert response.status_code == 404
    assert response.json() == {"detail": "This part of the site isn't available.", "code": "module_off"}


def test_hotel_emails_and_tasks_skip_an_agency_without_hotels(admin_api, booked):
    booking = booked()
    confirm(admin_api, booking)
    mail.outbox.clear()
    set_modules("flights")
    tasks.notify_customer_hotel_availability_confirmed.delay(TEST_SCHEMA, booking.pk)
    assert mail.outbox == []
    with freeze_time(timezone.now() + timedelta(days=3)):
        assert booking_tasks.expire_unpaid_bookings() == 0
        assert booking_tasks.send_payment_reminders() == 0
    assert HotelBooking.objects.get(pk=booking.pk).status == "availability_confirmed"


@pytest.mark.parametrize("status", [Status.REQUESTED, Status.AVAILABILITY_CONFIRMED, Status.PAID])
def test_hotels_cannot_be_turned_off_with_open_hotel_bookings(booked, platform, status):  # noqa: F811
    connection.set_schema(TEST_SCHEMA)
    booking = booked(status)
    response = patch_modules(platform, ["flights"])
    assert response.status_code == 409
    assert response.data == {"detail": "Hotels can't be turned off: 1 open hotel booking."}
    HotelBooking.objects.filter(pk=booking.pk).update(status=Status.COMPLETED)
    response = patch_modules(platform, ["flights"])
    assert response.status_code == 200, response.data
    assert Tenant.objects.get(schema_name=TEST_SCHEMA).modules == ["flights"]


def test_hotels_are_isolated_between_agencies(api, booked):
    booking = booked()
    Tenant.objects.filter(schema_name=OTHER_SCHEMA).update(hotels_enabled=True)
    other = api.get("/api/hotels", HTTP_HOST="other.localhost")
    assert other.status_code == 200
    assert other.data["results"] == []
    assert api.get(f"/api/hotels/{booking.hotel_id}", HTTP_HOST="other.localhost").status_code == 404
