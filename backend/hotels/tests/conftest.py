from datetime import time, timedelta

import pytest
from django.utils import timezone

from core.models import AppSettings
from hotels.models import Hotel, RatePeriod, RoomRate, RoomType
from hotels.serializers import HotelBookingCreateSerializer
from tenants.models import Tenant


@pytest.fixture(autouse=True)
def hotels_on(db):
    """The test agency has flights and hotels."""
    Tenant.objects.filter(schema_name="test").update(hotels_enabled=True)
    AppSettings.objects.update(
        payment_instructions="M-Pesa paybill 123456.", admin_notification_email="desk@agency.test"
    )


def days(count):
    return timezone.localdate() + timedelta(days=count)


def hotel_fields(**overrides):
    return {
        "name": "Diani Reef",
        "destination": "Diani Beach, Kenya",
        "address": "Beach Road",
        "star_rating": 4,
        "summary": "On the beach.",
        "check_in_time": time(14, 0),
        "check_out_time": time(10, 0),
        "cancellation_policy": "Free cancellation until 7 days before.",
        **overrides,
    }


@pytest.fixture
def make_hotel(db):
    """A hotel with a Deluxe Double (2 adults, 1 child) whose Bed & breakfast rate costs $100 a night for the
    next 30 nights, then $150 for 30 more, plus $15 per adult per night."""

    def make(rates=None, **overrides):
        hotel = Hotel.objects.create(**hotel_fields(**overrides))
        room_type = RoomType.objects.create(hotel=hotel, name="Deluxe Double", max_adults=2, max_children=1)
        for position, rate in enumerate(rates or [{"name": "Bed & breakfast", "per_adult_per_night": "15"}]):
            periods = rate.pop("periods", [(0, 29, "100"), (30, 59, "150")])
            made = RoomRate.objects.create(
                room_type=room_type,
                position=position,
                **{"max_adults": 2, "max_children": 1, **rate},
            )
            for start, end, price in periods:
                RatePeriod.objects.create(rate=made, start_date=days(start), end_date=days(end), price_per_night=price)
        return hotel

    return make


def rate_of(hotel, name=None):
    rates = RoomRate.objects.filter(room_type__hotel=hotel)
    return rates.get(name=name) if name else rates.first()


def room(rate, adults=2, children=0, guests=None):
    """One room as the API takes it, with a lead guest unless guests are given."""
    return {
        "room_type": str(rate.room_type_id),
        "rate": str(rate.pk),
        "adults": adults,
        "children": children,
        "guests": [{"full_name": "Wanjiru Kamau"}] if guests is None else guests,
    }


def booking_body(hotel, *rooms, check_in=2, nights=3, **extra):
    return {
        "hotel": str(hotel.pk),
        "check_in": days(check_in).isoformat(),
        "check_out": days(check_in + nights).isoformat(),
        "rooms": list(rooms),
        **extra,
    }


def booking_data(hotel, *rooms, **extra):
    """create_booking's validated input."""
    serializer = HotelBookingCreateSerializer(data=booking_body(hotel, *rooms, **extra))
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data
