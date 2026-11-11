"""The daily exchange-rate feed (public schema)."""

import logging
from decimal import Decimal

import httpx
from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django_tenants.utils import get_public_schema_name, schema_context

from . import USD
from .models import ExchangeRate

logger = logging.getLogger(__name__)

EIGHT_PLACES = Decimal("0.00000001")

# The httpx transport for the feed; None uses the network (tests put an httpx.MockTransport here).
transport = None


def load_feed():
    """{currency: units per USD} from the feed at EXCHANGE_RATES_URL."""
    with httpx.Client(transport=transport, timeout=30) as client:
        response = client.get(settings.EXCHANGE_RATES_URL)
    response.raise_for_status()
    data = response.json()
    if data.get("result") != "success" or data.get("base_code") != USD:
        raise ValueError(f"Unexpected exchange-rate feed response: {data.get('error-type') or data.get('result')}")
    return {code.upper(): Decimal(str(value)).quantize(EIGHT_PLACES) for code, value in data["rates"].items()}


@shared_task
def fetch_exchange_rates():
    """Daily: today's rate (Nairobi date) for every currency in the feed; a manual rate for today is kept."""
    rates = load_feed()
    today = timezone.localdate()
    stored = 0
    with schema_context(get_public_schema_name()), transaction.atomic():
        manual = set(
            ExchangeRate.objects.filter(date=today, source=ExchangeRate.Source.MANUAL).values_list(
                "currency", flat=True
            )
        )
        for currency, units in rates.items():
            if currency == USD or currency in manual or len(currency) != 3 or units <= 0:
                continue
            ExchangeRate.objects.update_or_create(
                currency=currency,
                date=today,
                defaults={"units_per_usd": units, "source": ExchangeRate.Source.FEED, "fetched_at": timezone.now()},
            )
            stored += 1
    logger.info("Stored %d exchange rate(s).", stored)
    return stored
