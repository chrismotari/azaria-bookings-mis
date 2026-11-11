"""Regression tests."""

from datetime import timedelta

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from bookings.admin import BookingAdmin
from bookings.models import Booking
from tenants import services
from core.tests.helpers import airline_named, direct

pytestmark = pytest.mark.django_db

Status = Booking.Status


def test_throttles_ignore_a_forged_forwarded_for_header(customer):
    client = APIClient()
    codes = [
        client.post(
            "/api/auth/login",
            {"email": customer.email, "password": "wrong"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.0.0.{n}",
        ).status_code
        for n in range(12)
    ]
    assert 429 in codes


@pytest.mark.parametrize("slug", ["information-schema", "pg-catalog"])
def test_addresses_that_collide_with_existing_schemas_are_refused(slug):
    with pytest.raises(ValidationError):
        services.validate_slug(slug)


def test_tenant_tasks_never_run_in_the_platform_schema():
    from accounts.tasks import send_password_reset_email

    assert send_password_reset_email("public", "00000000-0000-4000-8000-000000000000") is None


def test_only_customers_book_through_the_customer_endpoint(admin_api, make_offer):
    response = admin_api.post("/api/bookings", {"offer": str(make_offer().id), "passenger_count": 1}, format="json")
    assert response.status_code == 403
    assert not Booking.objects.exists()


def test_a_refused_move_is_409_even_with_an_invalid_body(admin_api, customer, make_offer):
    offer = make_offer()
    booking = Booking.objects.create(
        user=customer, offer=offer, passenger_count=1, unit_price=offer.price, status=Status.PAID
    )
    url = f"/api/admin/bookings/{booking.id}"
    assert admin_api.post(f"{url}/confirm-availability", {"unit_price": "-1"}, format="json").status_code == 409
    body = {"offer_ids": ["00000000-0000-4000-8000-000000000000"]}
    assert admin_api.post(f"{url}/mark-unavailable", body, format="json").status_code == 409


def test_segment_airport_codes_are_accepted_in_any_case(admin_api, airports):
    segments = direct(" nbo ", "dxb", timezone.localdate() + timedelta(days=30))
    body = {
        "ticket_class": "economy",
        "price": "500",
        "airline": str(airline_named("Emirates").id),
        "valid_until": (timezone.localdate() + timedelta(days=5)).isoformat(),
        "segments": segments,
    }
    response = admin_api.post("/api/admin/offers", body, format="json")
    assert response.status_code == 201, response.data
    assert response.data["itinerary"]["outbound"]["segments"][0]["destination"]["code"] == "DXB"


def test_a_customer_can_open_a_private_offer_the_admin_booked_for_them(
    admin_api, customer_api, customer, make_offer
):
    private = make_offer(is_public=False)
    assert customer_api.get(f"/api/offers/{private.id}").status_code == 404
    body = {"user": str(customer.id), "offer": str(private.id), "passenger_count": 1}
    assert admin_api.post("/api/admin/bookings", body, format="json").status_code == 201
    assert customer_api.get(f"/api/offers/{private.id}").status_code == 200


def test_the_support_admin_cannot_change_booking_state():
    readonly = BookingAdmin(Booking, admin.site).get_readonly_fields(None)
    for field in ["status", "payment_deadline", "reminder_sent_at", "changes", "changes_accepted"]:
        assert field in readonly


def test_refreshing_a_token_whose_user_is_gone_is_401(customer):
    import uuid

    from accounts.models import User
    from accounts.tokens import TenantRefreshToken

    ghost = TenantRefreshToken.for_user(User(id=uuid.uuid4(), email="ghost@example.com"))
    response = APIClient().post("/api/auth/refresh", {"refresh": str(ghost)}, format="json")
    assert response.status_code == 401
