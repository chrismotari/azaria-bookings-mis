"""Converting provider amounts to USD with the stored exchange rates."""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

USD = "USD"
CENT = Decimal("0.01")
# A rate older than this (in days, before the date asked for) is still used, but reported as stale.
STALE_AFTER_DAYS = 3


class NoRate(Exception):
    """There is no rate for the currency on or before the date."""


@dataclass(frozen=True)
class Conversion:
    usd: Decimal
    # Units of the currency per US dollar.
    rate: Decimal
    rate_date: date
    stale: bool


def is_stale(rate_date, on):
    return (on - rate_date).days > STALE_AFTER_DAYS


def convert(amount, currency, on):
    """amount in currency as USD, with the latest rate on or before the date `on`. Raises NoRate without one."""
    from .models import ExchangeRate

    amount = Decimal(amount)
    currency = currency.upper()
    if currency == USD:
        return Conversion(amount.quantize(CENT, ROUND_HALF_UP), Decimal(1), on, False)
    rate = ExchangeRate.objects.filter(currency=currency, date__lte=on).order_by("-date").first()
    if rate is None:
        raise NoRate(currency)
    usd = (amount / rate.units_per_usd).quantize(CENT, ROUND_HALF_UP)
    return Conversion(usd, rate.units_per_usd, rate.date, is_stale(rate.date, on))
