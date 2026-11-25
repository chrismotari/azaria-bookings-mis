from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from hotels import services
from hotels.models import Hotel, HotelPhoto, RatePeriod, RoomRate, RoomType
from hotels.tests.conftest import booking_data, days, rate_of, room

pytestmark = pytest.mark.django_db


def period(start, end, price):
    return {"start_date": days(start).isoformat(), "end_date": days(end).isoformat(), "price_per_night": price}


def rate_body(**overrides):
    return {
        "name": "Bed & breakfast",
        "inclusions": ["Breakfast included"],
        "max_adults": 2,
        "max_children": 1,
        "per_adult_per_night": "15.00",
        "periods": [period(0, 29, "100.00")],
        **overrides,
    }


def type_body(**overrides):
    return {"name": "Deluxe Double", "max_adults": 2, "max_children": 1, "rates": [rate_body()], **overrides}


def body(**overrides):
    return {
        "name": "Diani Reef",
        "destination": "Diani Beach, Kenya",
        "address": "Beach Road",
        "star_rating": 4,
        "summary": "On the beach.",
        "check_in_time": "14:00",
        "check_out_time": "10:00",
        "cancellation_policy": "Free cancellation until 7 days before.",
        "room_types": [type_body()],
        **overrides,
    }


def admin_room_types(admin_api, hotel):
    """The hotel's room types as the admin API returns them, ready to PATCH back."""
    return admin_api.get(f"/api/admin/hotels/{hotel.pk}").data["room_types"]


def patch_room_types(admin_api, hotel, room_types):
    return admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": room_types}, format="json")


# Creating and validating


def test_admin_creates_a_hotel_with_rooms_rates_and_periods(admin_api):
    response = admin_api.post(
        "/api/admin/hotels",
        body(
            description="<p>Sea <script>alert(1)</script><strong>views</strong></p>",
            amenities=["Pool", "  ", "Wi-Fi"],
            room_types=[
                type_body(
                    rates=[
                        rate_body(periods=[period(30, 59, "150.00"), period(0, 29, "100.00")]),
                        rate_body(name="Single use", max_adults=1, per_adult_per_night="0"),
                    ]
                ),
                type_body(name="Family Tent", max_adults=4, max_children=3, rates=[rate_body(name="Full board")]),
            ],
        ),
        format="json",
    )
    assert response.status_code == 201, response.data
    data = response.data
    assert data["description"] == "<p>Sea <strong>views</strong></p>"
    assert data["amenities"] == ["Pool", "Wi-Fi"]
    assert [t["name"] for t in data["room_types"]] == ["Deluxe Double", "Family Tent"]
    rates = data["room_types"][0]["rates"]
    assert [r["name"] for r in rates] == ["Bed & breakfast", "Single use"]
    assert [p["start_date"] for p in rates[0]["periods"]] == [days(0).isoformat(), days(30).isoformat()]
    assert rates[0]["booked"] is False
    # The lowest night: Single use at $100 for its 1 adult.
    assert data["from_price"] == "100.00"


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"name": "  "}, "name"),
        ({"address": ""}, "address"),
        ({"summary": ""}, "summary"),
        ({"cancellation_policy": " "}, "cancellation_policy"),
        ({"star_rating": 6}, "star_rating"),
        ({"star_rating": 0}, "star_rating"),
        ({"amenities": ["x"] * 31}, "amenities"),
        ({"amenities": ["x" * 101]}, "amenities"),
        ({"check_in_time": "25:00"}, "check_in_time"),
        ({"room_types": [type_body(), type_body(name="deluxe double")]}, "room_types"),
        ({"room_types": [type_body(max_adults=11)]}, "room_types"),
        ({"room_types": [type_body(max_children=7)]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(max_adults=3)])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(max_children=2)])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(), rate_body(name="BED & BREAKFAST")])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(inclusions=["x"] * 11)])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(inclusions=["x" * 81])])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(per_adult_per_night="-1")])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(periods=[period(0, 5, "0")])])]}, "room_types"),
        ({"room_types": [type_body(rates=[rate_body(periods=[period(5, 4, "100")])])]}, "room_types"),
    ],
)
def test_hotel_fields_are_checked(admin_api, overrides, field):
    response = admin_api.post("/api/admin/hotels", body(**overrides), format="json")
    assert response.status_code == 400
    assert field in response.data


def test_overlapping_periods_are_refused(admin_api):
    periods = [period(0, 10, "100"), period(10, 20, "120")]
    response = admin_api.post(
        "/api/admin/hotels", body(room_types=[type_body(rates=[rate_body(periods=periods)])]), format="json"
    )
    assert response.status_code == 400
    message = response.data["room_types"][0]["rates"][0]["periods"][0]
    assert message.startswith("Periods overlap")
    touching = [period(0, 10, "100"), period(11, 20, "120")]
    response = admin_api.post(
        "/api/admin/hotels", body(room_types=[type_body(rates=[rate_body(periods=touching)])]), format="json"
    )
    assert response.status_code == 201


def test_patch_replaces_room_types_rates_and_periods(admin_api, make_hotel):
    hotel = make_hotel()
    room_types = admin_room_types(admin_api, hotel)
    rate = room_types[0]["rates"][0]
    rate["periods"] = [period(0, 9, "80.00")]
    rate["name"] = "Bed and breakfast"
    room_types[0]["rates"].append(rate_body(name="Room only", per_adult_per_night="0"))
    room_types.append(type_body(name="Suite", rates=[]))
    response = admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": room_types}, format="json")
    assert response.status_code == 200, response.data
    deluxe = RoomType.objects.get(hotel=hotel, name="Deluxe Double")
    assert str(deluxe.pk) == room_types[0]["id"]
    assert list(deluxe.rates.values_list("name", flat=True)) == ["Bed and breakfast", "Room only"]
    assert list(RatePeriod.objects.filter(rate_id=rate["id"]).values_list("price_per_night", flat=True)) == [80]
    assert RoomType.objects.filter(hotel=hotel).count() == 2
    # Names can swap between items.
    room_types = admin_room_types(admin_api, hotel)
    rates = room_types[0]["rates"]
    rates[0]["name"], rates[1]["name"] = rates[1]["name"], rates[0]["name"]
    assert (
        admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": room_types}, format="json").status_code == 200
    )
    # Only the fields given change.
    assert admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"name": "Reef"}, format="json").status_code == 200
    assert RoomType.objects.filter(hotel=hotel).count() == 2


def test_booked_room_types_and_rates_are_only_deactivated(admin_api, make_hotel, customer):
    hotel = make_hotel()
    rate = rate_of(hotel)
    services.create_booking(customer, booking_data(hotel, room(rate)))
    room_types = admin_room_types(admin_api, hotel)
    assert room_types[0]["booked"] is True
    assert room_types[0]["rates"][0]["booked"] is True

    without_rate = [{**room_types[0], "rates": []}]
    response = admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": without_rate}, format="json")
    assert response.status_code == 400
    assert response.data == {"room_types": ["Bed & breakfast has been booked: deactivate it instead of removing it."]}
    response = admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": []}, format="json")
    assert response.data["room_types"][0] == "Deluxe Double has been booked: deactivate it instead of removing it."

    room_types[0]["is_active"] = False
    room_types[0]["rates"][0]["is_active"] = False
    assert (
        admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": room_types}, format="json").status_code == 200
    )
    assert not RoomRate.objects.get(pk=rate.pk).is_active


def test_items_of_another_hotel_are_refused(admin_api, make_hotel):
    hotel, other = make_hotel(), make_hotel(name="Other")
    foreign = admin_room_types(admin_api, other)
    response = admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": foreign}, format="json")
    assert response.status_code == 400
    mine = admin_room_types(admin_api, hotel)
    moved = [mine[0], {**type_body(name="Suite"), "rates": [mine[0]["rates"][0]]}]
    mine[0]["rates"] = []
    response = admin_api.patch(f"/api/admin/hotels/{hotel.pk}", {"room_types": moved}, format="json")
    assert response.data == {"room_types": ["A rate cannot move to another room type."]}


def test_admin_list_filters_and_permissions(admin_api, customer_api, api, make_hotel):
    active, inactive = make_hotel(), make_hotel(name="Closed", is_active=False)

    def names(**params):
        return [row["name"] for row in admin_api.get("/api/admin/hotels", params).data["results"]]

    assert names() == ["Closed", "Diani Reef"]
    assert names(status="active") == [active.name]
    assert names(status="inactive") == [inactive.name]
    for client, code in ((customer_api, 403), (api, 401)):
        assert client.get("/api/admin/hotels").status_code == code
        assert client.post("/api/admin/hotels", body(), format="json").status_code == code
        assert client.get("/api/admin/hotel-bookings").status_code == code
    assert admin_api.delete(f"/api/admin/hotels/{active.pk}").status_code == 405
    assert Hotel.objects.filter(pk=active.pk).exists()


# Photos


def png(name="photo.png", size=None):
    content = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    if size:
        content += b"0" * (size - len(content))
    return SimpleUploadedFile(name, content, content_type="image/png")


def upload(admin_api, hotel, file):
    return admin_api.post(f"/api/admin/hotels/{hotel.pk}/photos", {"image": file}, format="multipart")


def test_photos_upload_order_and_delete(admin_api, make_hotel, public_media, django_capture_on_commit_callbacks):
    hotel = make_hotel()
    ids = [upload(admin_api, hotel, png()).data["id"] for _ in range(3)]
    stored = list(HotelPhoto.objects.filter(hotel=hotel))
    assert [str(photo.pk) for photo in stored] == ids
    assert stored[0].image.name.startswith(f"hotels/test/{hotel.pk}/")
    assert stored[0].image.name != f"hotels/test/{hotel.pk}/photo.png"

    moved = admin_api.patch(f"/api/admin/hotels/{hotel.pk}/photos/{ids[2]}", {"position": 0}, format="json")
    assert [photo["id"] for photo in moved.data] == [ids[2], ids[0], ids[1]]

    path = public_media / HotelPhoto.objects.get(pk=ids[0]).image.name
    assert path.exists()
    with django_capture_on_commit_callbacks(execute=True):
        assert admin_api.delete(f"/api/admin/hotels/{hotel.pk}/photos/{ids[0]}").status_code == 204
    assert not path.exists()
    assert list(HotelPhoto.objects.filter(hotel=hotel).values_list("position", flat=True)) == [0, 1]


def test_photo_type_size_content_and_count(admin_api, make_hotel, api):
    hotel = make_hotel()
    assert upload(admin_api, hotel, SimpleUploadedFile("a.gif", b"GIF89a", content_type="image/gif")).status_code == 400
    fake = SimpleUploadedFile("a.jpg", b"\x89PNG\r\n\x1a\n000", content_type="image/jpeg")
    assert upload(admin_api, hotel, fake).data == {"image": ["The file's content does not match its type."]}
    assert upload(admin_api, hotel, png(size=2 * 1024 * 1024 + 1)).data == {"image": ["The photo is larger than 2 MB."]}
    jpeg = SimpleUploadedFile("a.jpeg", BytesIO(b"\xff\xd8\xff\xe0rest").read(), content_type="image/jpeg")
    assert upload(admin_api, hotel, jpeg).status_code == 201
    for _ in range(11):
        assert upload(admin_api, hotel, png()).status_code == 201
    assert upload(admin_api, hotel, png()).data == {"image": ["A hotel can have at most 12 photos."]}
    photo = api.get(f"/api/hotels/{hotel.pk}").data["photos"][0]
    assert photo["url"].startswith("http://testserver/media/hotels/test/")
