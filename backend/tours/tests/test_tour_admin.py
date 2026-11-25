from datetime import timedelta
from decimal import Decimal
from io import BytesIO

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from tours.models import Tour, TourBooking, TourNotice, TourPhoto, TourPriceOption
from tours.tests.conftest import lines, tour_fields

pytestmark = pytest.mark.django_db


def body(**overrides):
    data = {key: value.isoformat() if hasattr(value, "isoformat") else value for key, value in tour_fields().items()}
    data["options"] = [{"name": "Regular", "price": "300.00"}]
    return {**data, **overrides}


def book(customer_api, tour, *items):
    return customer_api.post("/api/tour-bookings", {"tour": str(tour.pk), "lines": lines(*items)}, format="json")


# Creating and validating


def test_admin_creates_a_tour_with_options(admin_api):
    response = admin_api.post(
        "/api/admin/tours",
        body(
            description="<p>Hello <script>alert(1)</script><strong>there</strong></p>",
            included=["Park fees", "  ", "Meals"],
            options=[
                {"name": "Regular", "price": "300.00"},
                {"name": "Couple", "price": "500.00", "people_per_unit": 2, "units_available": 4},
            ],
        ),
        format="json",
    )
    assert response.status_code == 201, response.data
    data = response.data
    assert data["description"] == "<p>Hello <strong>there</strong></p>"
    assert data["included"] == ["Park fees", "Meals"]
    assert [option["name"] for option in data["options"]] == ["Regular", "Couple"]
    assert data["from_price"] == "250.00"
    assert data["slots_left"] == 10
    assert data["duration_days"] == 3
    assert data["bookable"] is True
    assert data["options"][1]["units_left"] == 4


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"end_date": "2000-01-01"}, "end_date"),
        ({"booking_deadline": "2999-01-01"}, "booking_deadline"),
        ({"cancellation_deadline": "2999-01-01"}, "cancellation_deadline"),
        ({"slots": 0}, "slots"),
        ({"slots": 501}, "slots"),
        ({"cancellation_policy": " "}, "cancellation_policy"),
        ({"title": "x" * 121}, "title"),
        ({"summary": "x" * 301}, "summary"),
        ({"included": ["x" * 201]}, "included"),
        ({"not_included": ["line"] * 31}, "not_included"),
        ({"description": "<p>" + "x" * 10001 + "</p>"}, "description"),
        ({"options": []}, "options"),
        ({"options": [{"name": "A", "price": "10", "is_active": False}]}, "options"),
        ({"options": [{"name": "A", "price": "10"}, {"name": "a", "price": "12"}]}, "options"),
        ({"options": [{"name": "A", "price": "0"}]}, "options"),
        ({"options": [{"name": "A", "price": "10", "people_per_unit": 21}]}, "options"),
    ],
)
def test_tour_validation(admin_api, overrides, field):
    response = admin_api.post("/api/admin/tours", body(**overrides), format="json")
    assert response.status_code == 400
    assert field in response.data


def test_deadlines_may_fall_on_the_start_date(admin_api):
    start = tour_fields()["start_date"].isoformat()
    response = admin_api.post(
        "/api/admin/tours", body(booking_deadline=start, cancellation_deadline=start), format="json"
    )
    assert response.status_code == 201


def test_slots_cannot_go_below_the_people_booked(admin_api, customer_api, make_tour):
    tour = make_tour()
    assert book(customer_api, tour, (tour.options.get(), 4)).status_code == 201
    response = admin_api.patch(f"/api/admin/tours/{tour.pk}", {"slots": 3}, format="json")
    assert response.status_code == 400
    assert response.data == {"slots": ["4 people are already booked: slots cannot be fewer."]}
    assert admin_api.patch(f"/api/admin/tours/{tour.pk}", {"slots": 4}, format="json").status_code == 200


def option_list(tour, **changes):
    return [
        {
            "id": str(option.pk),
            "name": option.name,
            "price": str(option.price),
            "people_per_unit": option.people_per_unit,
            "units_available": option.units_available,
            "is_active": option.is_active,
            **changes.get(option.name, {}),
        }
        for option in tour.options.all()
    ]


def test_booked_options_cannot_be_removed_only_deactivated(admin_api, customer_api, make_tour):
    tour = make_tour(options=[{"name": "Regular", "price": "300"}, {"name": "VIP", "price": "600"}])
    regular, vip = tour.options.all()
    assert book(customer_api, tour, (vip, 1)).status_code == 201
    response = admin_api.patch(f"/api/admin/tours/{tour.pk}", {"options": option_list(tour)[:1]}, format="json")
    assert response.status_code == 400
    assert response.data == {"options": ["VIP has been booked: deactivate it instead of removing it."]}
    response = admin_api.patch(
        f"/api/admin/tours/{tour.pk}", {"options": option_list(tour, VIP={"is_active": False})}, format="json"
    )
    assert response.status_code == 200
    assert [option["name"] for option in response.data["options"]] == ["Regular", "VIP"]
    # An unbooked option can go.
    response = admin_api.patch(
        f"/api/admin/tours/{tour.pk}",
        {"options": option_list(tour)[1:] + [{"name": "Kids", "price": "100"}]},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert list(tour.options.values_list("name", "position")) == [("VIP", 0), ("Kids", 1)]
    assert not TourPriceOption.objects.filter(pk=regular.pk).exists()


def test_units_cannot_go_below_the_units_booked(admin_api, customer_api, make_tour):
    tour = make_tour(options=[{"name": "VIP", "price": "600", "units_available": 5}])
    assert book(customer_api, tour, (tour.options.get(), 3)).status_code == 201
    response = admin_api.patch(
        f"/api/admin/tours/{tour.pk}", {"options": option_list(tour, VIP={"units_available": 2})}, format="json"
    )
    assert response.status_code == 400
    assert response.data == {"options": ["3 VIP already booked: units cannot be fewer."]}


def test_options_can_swap_names(admin_api, make_tour):
    tour = make_tour(options=[{"name": "A", "price": "10"}, {"name": "B", "price": "20"}])
    response = admin_api.patch(
        f"/api/admin/tours/{tour.pk}", {"options": option_list(tour, A={"name": "B"}, B={"name": "A"})}, format="json"
    )
    assert response.status_code == 200, response.data
    assert [(o["name"], o["price"]) for o in response.data["options"]] == [("B", "10.00"), ("A", "20.00")]


def test_an_option_of_another_tour_is_refused(admin_api, make_tour):
    tour, other = make_tour(), make_tour()
    options = [{"id": str(other.options.get().pk), "name": "Regular", "price": "1"}]
    assert admin_api.patch(f"/api/admin/tours/{tour.pk}", {"options": options}, format="json").status_code == 400


def test_edits_after_booking_keep_the_booked_prices(admin_api, customer_api, make_tour):
    tour = make_tour()
    booking = book(customer_api, tour, (tour.options.get(), 2)).data
    response = admin_api.patch(
        f"/api/admin/tours/{tour.pk}", {"options": option_list(tour, Regular={"price": "450.00"})}, format="json"
    )
    assert response.status_code == 200
    again = customer_api.get(f"/api/tour-bookings/{booking['id']}").data
    assert again["lines"][0]["unit_price"] == "300.00"
    assert again["total_price"] == "600.00"


def test_a_cancelled_tour_refuses_edits(admin_api, make_tour):
    tour = make_tour()
    assert (
        admin_api.post(f"/api/admin/tours/{tour.pk}/cancel", {"message": "Floods."}, format="json").status_code == 200
    )
    assert admin_api.patch(f"/api/admin/tours/{tour.pk}", {"title": "New"}, format="json").status_code == 409
    assert admin_api.patch(f"/api/admin/tours/{tour.pk}", {"is_active": True}, format="json").status_code == 409
    assert admin_api.post(f"/api/admin/tours/{tour.pk}/cancel", {"message": "Again"}, format="json").status_code == 409


def test_from_price_is_the_lowest_per_person_rounded_half_up(make_tour, api):
    tour = make_tour(
        options=[
            {"name": "Regular", "price": Decimal("100.00")},
            {"name": "Trio", "price": Decimal("100.00"), "people_per_unit": 3},
            {"name": "Off", "price": Decimal("1.00"), "is_active": False},
        ]
    )
    assert api.get(f"/api/tours/{tour.pk}").data["from_price"] == "33.33"
    TourPriceOption.objects.filter(tour=tour, name="Trio").update(price=Decimal("100.01"))
    # 33.336666 → 33.34
    assert api.get(f"/api/tours/{tour.pk}").data["from_price"] == "33.34"
    TourPriceOption.objects.filter(tour=tour, name="Trio").update(price=Decimal("0.05"), people_per_unit=2)
    # 0.025 → 0.03
    assert api.get(f"/api/tours/{tour.pk}").data["from_price"] == "0.03"


def test_admin_list_filters(admin_api, make_tour):
    today = timezone.localdate()
    upcoming = make_tour(title="Upcoming")
    inactive = make_tour(title="Inactive", is_active=False)
    past = make_tour(
        title="Past",
        start_date=today - timedelta(days=5),
        end_date=today - timedelta(days=3),
        booking_deadline=today - timedelta(days=6),
        cancellation_deadline=today - timedelta(days=6),
    )
    cancelled = make_tour(title="Cancelled")
    admin_api.post(f"/api/admin/tours/{cancelled.pk}/cancel", {"message": "No"}, format="json")

    def titles(status=None):
        params = {"status": status} if status else {}
        return {row["title"] for row in admin_api.get("/api/admin/tours", params).data["results"]}

    assert titles() == {"Upcoming", "Inactive", "Past", "Cancelled"}
    assert titles("upcoming") == {upcoming.title}
    assert titles("inactive") == {inactive.title}
    assert titles("past") == {past.title}
    assert titles("cancelled") == {cancelled.title}


def test_admin_features_a_tour_and_filters_featured(admin_api, make_tour):
    tour, other = make_tour(title="Featured"), make_tour(title="Plain")
    response = admin_api.patch(f"/api/admin/tours/{tour.pk}", {"is_featured": True}, format="json")
    assert response.status_code == 200 and response.data["is_featured"] is True
    created = admin_api.post("/api/admin/tours", body(title="New", is_featured=True), format="json")
    assert created.status_code == 201 and created.data["is_featured"] is True

    def titles(featured):
        return {row["title"] for row in admin_api.get("/api/admin/tours", {"featured": featured}).data["results"]}

    assert titles("true") == {"Featured", "New"}
    assert titles("false") == {other.title}


def test_admin_tours_need_the_admin_role(api, customer_api, make_tour):
    tour = make_tour()
    for client, code in [(api, 401), (customer_api, 403)]:
        assert client.get("/api/admin/tours").status_code == code
        assert client.post("/api/admin/tours", body(), format="json").status_code == code
        assert client.patch(f"/api/admin/tours/{tour.pk}", {"title": "X"}, format="json").status_code == code
        assert client.post(f"/api/admin/tours/{tour.pk}/cancel", {"message": "X"}, format="json").status_code == code
        assert client.get("/api/admin/tour-bookings").status_code == code


def test_tours_are_never_deleted(admin_api, make_tour):
    tour = make_tour()
    assert admin_api.delete(f"/api/admin/tours/{tour.pk}").status_code == 405
    assert Tour.objects.filter(pk=tour.pk).exists()


# Photos


def png(name="photo.png", size=None):
    content = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    if size:
        content += b"0" * (size - len(content))
    return SimpleUploadedFile(name, content, content_type="image/png")


def upload(admin_api, tour, file):
    return admin_api.post(f"/api/admin/tours/{tour.pk}/photos", {"image": file}, format="multipart")


def test_photos_upload_order_and_delete(admin_api, make_tour, public_media, django_capture_on_commit_callbacks):
    tour = make_tour()
    ids = [upload(admin_api, tour, png()).data["id"] for _ in range(3)]
    stored = list(TourPhoto.objects.filter(tour=tour))
    assert [str(photo.pk) for photo in stored] == ids
    assert stored[0].image.name.startswith(f"tours/test/{tour.pk}/")
    assert stored[0].image.name != f"tours/test/{tour.pk}/photo.png"

    moved = admin_api.patch(f"/api/admin/tours/{tour.pk}/photos/{ids[2]}", {"position": 0}, format="json")
    assert moved.status_code == 200
    assert [photo["id"] for photo in moved.data] == [ids[2], ids[0], ids[1]]
    assert admin_api.get(f"/api/admin/tours/{tour.pk}").data["photos"][0]["id"] == ids[2]

    path = public_media / TourPhoto.objects.get(pk=ids[0]).image.name
    assert path.exists()
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.delete(f"/api/admin/tours/{tour.pk}/photos/{ids[0]}").status_code == 204
    assert not path.exists()
    assert list(TourPhoto.objects.filter(tour=tour).values_list("position", flat=True)) == [0, 1]


def test_photo_type_size_and_content_are_checked(admin_api, make_tour):
    tour = make_tour()
    assert upload(admin_api, tour, SimpleUploadedFile("a.gif", b"GIF89a", content_type="image/gif")).status_code == 400
    fake = SimpleUploadedFile("a.jpg", b"\x89PNG\r\n\x1a\n000", content_type="image/jpeg")
    assert upload(admin_api, tour, fake).data == {"image": ["The file's content does not match its type."]}
    assert upload(admin_api, tour, png(size=2 * 1024 * 1024 + 1)).data == {"image": ["The photo is larger than 2 MB."]}
    webp = SimpleUploadedFile("a.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ", content_type="image/webp")
    assert upload(admin_api, tour, webp).status_code == 201
    jpeg = SimpleUploadedFile("a.jpeg", BytesIO(b"\xff\xd8\xff\xe0rest").read(), content_type="image/jpeg")
    assert upload(admin_api, tour, jpeg).status_code == 201


def test_at_most_eight_photos(admin_api, make_tour):
    tour = make_tour()
    for _ in range(8):
        assert upload(admin_api, tour, png()).status_code == 201
    assert upload(admin_api, tour, png()).data == {"image": ["A tour can have at most 8 photos."]}


def test_photo_changes_never_send_a_notice(admin_api, customer_api, make_tour):
    tour = make_tour()
    book(customer_api, tour, (tour.options.get(), 1))
    mail.outbox.clear()
    photo = upload(admin_api, tour, png()).data["id"]
    admin_api.patch(f"/api/admin/tours/{tour.pk}/photos/{photo}", {"position": 0}, format="json")
    admin_api.delete(f"/api/admin/tours/{tour.pk}/photos/{photo}")
    assert mail.outbox == []
    assert not TourNotice.objects.exists()


def test_public_photo_urls_and_cover(api, admin_api, make_tour):
    tour = make_tour()
    upload(admin_api, tour, png())
    photo = api.get(f"/api/tours/{tour.pk}").data["photos"][0]
    assert photo["url"].startswith("http://testserver/media/tours/test/")


# Notices and cancelling a tour


def test_a_save_with_a_notice_emails_each_confirmed_booking_once(
    admin_api, customer_api, other_customer_api, make_tour, django_capture_on_commit_callbacks
):
    tour = make_tour()
    option = tour.options.get()
    book(customer_api, tour, (option, 1))
    book(other_customer_api, tour, (option, 2))
    cancelled = book(other_customer_api, tour, (option, 1)).data
    other_customer_api.post(f"/api/tour-bookings/{cancelled['id']}/cancel")
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.patch(
            f"/api/admin/tours/{tour.pk}",
            {"meeting_point": "Westlands", "notice": "We now meet in Westlands."},
            format="json",
        )
    assert response.status_code == 200
    assert sorted(m.to[0] for m in mail.outbox) == ["customer@example.com", "other@example.com"]
    assert all("We now meet in Westlands." in m.body and "Westlands" in m.body for m in mail.outbox)
    notice = TourNotice.objects.get()
    assert (notice.kind, notice.recipients, notice.message) == ("change", 2, "We now meet in Westlands.")
    notices = admin_api.get(f"/api/admin/tours/{tour.pk}/notices").data
    assert notices[0]["sent_by"] == "Owner"


def test_a_save_without_a_notice_emails_nobody(admin_api, customer_api, make_tour, django_capture_on_commit_callbacks):
    tour = make_tour()
    book(customer_api, tour, (tour.options.get(), 1))
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.patch(f"/api/admin/tours/{tour.pk}", {"title": "Mara"}, format="json").status_code == 200
    assert mail.outbox == []
    assert not TourNotice.objects.exists()


def test_cancel_tour_cancels_every_confirmed_booking_and_emails_each(
    admin_api, customer_api, make_tour, django_capture_on_commit_callbacks
):
    tour = make_tour()
    option = tour.options.get()
    first = book(customer_api, tour, (option, 1)).data
    second = book(customer_api, tour, (option, 2)).data
    mail.outbox.clear()
    assert admin_api.post(f"/api/admin/tours/{tour.pk}/cancel", {"message": " "}, format="json").status_code == 400
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.post(f"/api/admin/tours/{tour.pk}/cancel", {"message": "Floods."}, format="json")
    assert response.status_code == 200
    assert response.data["is_active"] is False
    assert response.data["cancelled_by"] == "Owner"
    assert response.data["not_bookable_reason"] == "cancelled"
    for booking_id in (first["id"], second["id"]):
        booking = TourBooking.objects.get(pk=booking_id)
        assert (booking.status, booking.cancelled_by, booking.cancel_reason) == ("cancelled", "admin", "Floods.")
        assert list(booking.events.values_list("from_status", "to_status")) == [
            (None, "confirmed"),
            ("confirmed", "cancelled"),
        ]
    assert len(mail.outbox) == 2
    assert all(m.subject == "Tour cancelled: Maasai Mara, 3 days" and "Floods." in m.body for m in mail.outbox)
    notice = TourNotice.objects.get()
    assert (notice.kind, notice.recipients) == ("cancellation", 2)
