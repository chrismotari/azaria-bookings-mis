from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from core.models import AppSettings
from tenants.models import Tenant
from tours.models import Tour, TourPriceOption


@pytest.fixture(autouse=True)
def tours_on(db):
    """The test agency has flights and tours."""
    Tenant.objects.filter(schema_name="test").update(tours_enabled=True)
    AppSettings.objects.update(
        payment_instructions="M-Pesa paybill 123456.", admin_notification_email="desk@agency.test"
    )


def tour_fields(**overrides):
    today = timezone.localdate()
    start = today + timedelta(days=30)
    return {
        "title": "Maasai Mara, 3 days",
        "destination": "Maasai Mara, Kenya",
        "start_date": start,
        "end_date": start + timedelta(days=2),
        "slots": 10,
        "booking_deadline": start - timedelta(days=1),
        "cancellation_deadline": start - timedelta(days=1),
        "cancellation_policy": "Full refund until the deadline.",
        "summary": "Three days on safari.",
        "meeting_point": "Nairobi CBD",
        **overrides,
    }


@pytest.fixture
def make_tour(db):
    """A bookable tour with a per-person Regular option ($300) unless told otherwise."""

    def make(options=None, **overrides):
        tour = Tour.objects.create(**tour_fields(**overrides))
        for position, option in enumerate(options or [{"name": "Regular", "price": Decimal("300.00")}]):
            TourPriceOption.objects.create(tour=tour, position=position, **option)
        return tour

    return make


def lines(*items):
    """(option, quantity[, travellers]) tuples as the API takes them."""
    return [
        {"option": str(item[0].pk), "quantity": item[1], "travellers": item[2] if len(item) > 2 else []}
        for item in items
    ]
