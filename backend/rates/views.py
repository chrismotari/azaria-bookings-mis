from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from tenants.permissions import IsPlatformOwner

from . import is_stale
from .models import ExchangeRate
from .serializers import ExchangeRateSerializer, ManualRateSerializer


def latest_rates():
    """The latest rate of every currency, by currency code."""
    today = timezone.localdate()
    rates = ExchangeRate.objects.order_by("currency", "-date").distinct("currency")
    for rate in rates:
        rate.stale = is_stale(rate.date, today)
    return rates


class PlatformExchangeRatesView(APIView):
    """GET the latest rate per currency; POST a manual rate for today, which the feed never overwrites."""

    permission_classes = [IsPlatformOwner]

    def get(self, request):
        return Response(ExchangeRateSerializer(latest_rates(), many=True).data)

    def post(self, request):
        serializer = ManualRateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rate, _ = ExchangeRate.objects.update_or_create(
            currency=serializer.validated_data["currency"],
            date=timezone.localdate(),
            defaults={
                "units_per_usd": serializer.validated_data["units_per_usd"],
                "source": ExchangeRate.Source.MANUAL,
                "fetched_at": timezone.now(),
            },
        )
        rate.stale = False
        return Response(ExchangeRateSerializer(rate).data, status=status.HTTP_201_CREATED)
