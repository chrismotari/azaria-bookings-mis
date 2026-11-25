"""Stay prices: a night's price is its period's price_per_night plus the rate's per-adult charge for each adult."""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Prefetch
from django.utils import timezone

from reviews.models import with_rating

from .models import Hotel, RoomRate, RoomType


def nights(check_in, check_out):
    return (check_out - check_in).days


def room_price(rate, check_in, check_out):
    """The nights' room prices summed, or None when a night is in none of the rate's periods."""
    periods = list(rate.periods.all())
    total = Decimal("0")
    day = check_in
    while day < check_out:
        period = next((period for period in periods if period.start_date <= day <= period.end_date), None)
        if period is None:
            return None
        total += period.price_per_night
        day += timedelta(days=1)
    return total


def adults_priced(rate, adults=None):
    """The adults asked for, capped at the rate's max_adults; with none, the rate's max_adults."""
    return min(adults, rate.max_adults) if adults else rate.max_adults


def stay_price(rate, check_in, check_out, adults):
    price = room_price(rate, check_in, check_out)
    if price is None:
        return None
    return price + rate.per_adult_per_night * adults * nights(check_in, check_out)


def fits(rate, adults=None, children=None):
    return (adults or 0) <= rate.max_adults and (children or 0) <= rate.max_children


def with_offered_rates(queryset):
    """Prefetches each hotel's active room types (offered_types) and their active rates (offered_rates) with
    periods."""
    rates = RoomRate.objects.filter(is_active=True).prefetch_related("periods")
    types = RoomType.objects.filter(is_active=True).prefetch_related(
        Prefetch("rates", queryset=rates, to_attr="offered_rates")
    )
    return queryset.prefetch_related(Prefetch("room_types", queryset=types, to_attr="offered_types"))


def public_hotels():
    hotels = with_rating(Hotel.objects.filter(is_active=True), "hotel")
    return with_offered_rates(hotels.prefetch_related("photos"))


def offered_rates(hotel):
    """The active rates of the hotel's active room types (needs with_offered_rates)."""
    return [rate for room_type in hotel.offered_types for rate in room_type.offered_rates]


def current_rates(hotel):
    """Offered rates with a period that has not ended: what the hotel can still sell."""
    today = timezone.localdate()
    return [rate for rate in offered_rates(hotel) if any(p.end_date >= today for p in rate.periods.all())]


def from_price(hotel, check_in=None, check_out=None, adults=None, children=None):
    """The lowest night price (without dates) or stay price (with them) among the rates that fit the guests, for
    the adults priced; None when no rate is offered."""
    today = timezone.localdate()
    prices = []
    for rate in current_rates(hotel):
        if not fits(rate, adults, children):
            continue
        priced = adults_priced(rate, adults)
        if check_in and check_out:
            price = stay_price(rate, check_in, check_out, priced)
            if price is not None:
                prices.append(price)
        else:
            charge = rate.per_adult_per_night * priced
            prices.extend(p.price_per_night + charge for p in rate.periods.all() if p.end_date >= today)
    return min(prices) if prices else None
