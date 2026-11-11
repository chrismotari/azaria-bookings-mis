import uuid
from collections import defaultdict
from datetime import date

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole

from . import services
from .models import Fare, Integration, Route, SearchRun
from .providers import ProviderError, provider_for
from .serializers import (
    IntegrationSerializer,
    PublishSerializer,
    RouteSerializer,
    RunSerializer,
    fares_data,
)


class IntegrationListView(generics.ListCreateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = IntegrationSerializer
    queryset = Integration.objects.all()
    pagination_class = None


class IntegrationDetailView(generics.RetrieveUpdateAPIView):
    """Integrations are disabled (is_active false), never deleted."""

    permission_classes = [IsAdminRole]
    serializer_class = IntegrationSerializer
    queryset = Integration.objects.all()
    http_method_names = ["get", "patch", "head", "options"]


class IntegrationTestView(APIView):
    """Tries the integration's credentials at its provider and records the outcome."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        integration = get_object_or_404(Integration, pk=pk)
        try:
            message = provider_for(integration).test()
            ok = True
        except ProviderError as exc:
            message, ok = str(exc), False
        integration.last_tested_at = timezone.now()
        integration.last_test_ok = ok
        integration.last_test_message = message[:300]
        integration.save(update_fields=["last_tested_at", "last_test_ok", "last_test_message"])
        return Response(IntegrationSerializer(integration).data)


def routes():
    return (
        Route.objects.select_related("origin", "destination")
        .prefetch_related("airlines", "integrations")
        .annotate(new_fares=Count("fares", filter=Q(fares__status=Fare.Status.NEW, fares__picked=True)))
    )


class RouteListView(generics.ListCreateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = RouteSerializer

    def get_queryset(self):
        return routes()

    def perform_create(self, serializer):
        serializer.instance = routes().get(pk=serializer.save().pk)


class RouteDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = RouteSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return routes()

    def perform_update(self, serializer):
        serializer.instance = routes().get(pk=serializer.save().pk)


class RouteSearchView(APIView):
    """Search now: queues a run over the route's window."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        route = get_object_or_404(Route.objects.select_related("origin", "destination"), pk=pk)
        run = services.start_search(route, request.user)
        run.refresh_from_db()
        return Response(RunSerializer(run).data, status=status.HTTP_201_CREATED)


class RouteRunListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = RunSerializer

    def get_queryset(self):
        route = get_object_or_404(Route, pk=self.kwargs["pk"])
        return route.runs.select_related("started_by")


class SearchUsageView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response(services.search_usage())


def uuid_param(params, name, required=False):
    value = params.get(name, "")
    if not value:
        if required:
            raise serializers.ValidationError({name: "This parameter is required."})
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise serializers.ValidationError({name: "Not a valid id."}) from None


class FareListView(APIView):
    """A route's fares from one run (by default the latest one that searched the route), grouped per departure date
    and sorted by USD amount.

    Filters: run, status (dismissed fares only when asked for), picked.
    """

    permission_classes = [IsAdminRole]

    def get(self, request):
        params = request.query_params
        route = get_object_or_404(Route, pk=uuid_param(params, "route", required=True))
        run_id = uuid_param(params, "run")
        runs = route.runs.select_related("started_by")
        if run_id:
            run = get_object_or_404(runs, pk=run_id)
        else:
            # Skipped runs searched nothing; booking re-checks store no fares.
            run = (
                runs.exclude(status=SearchRun.Status.SKIPPED)
                .exclude(trigger=SearchRun.Trigger.RECHECK)
                .order_by("-created_at")
                .first()
            )
        if run is None:
            return Response({"run": None, "dates": []})

        fares = run.fares.select_related("integration", "airline")
        if params.get("status") in Fare.Status.values:
            fares = fares.filter(status=params["status"])
        else:
            fares = fares.exclude(status=Fare.Status.DISMISSED)
        if params.get("picked") in ("true", "false"):
            fares = fares.filter(picked=params["picked"] == "true")

        grouped = defaultdict(list)
        for fare in fares_data(fares, {"request": request}):
            grouped[fare["departure_date"]].append(fare)
        dates = [
            {
                "departure_date": day,
                # Fares without a rate last.
                "fares": sorted(items, key=lambda fare: (fare["net_usd"] is None, float(fare["net_usd"] or 0))),
            }
            for day, items in sorted(grouped.items())
        ]
        return Response({"run": RunSerializer(run).data, "dates": dates})


class FareHistoryView(APIView):
    """The cheapest USD fare of each run for a route and departure date, oldest first."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        params = request.query_params
        route = get_object_or_404(Route, pk=uuid_param(params, "route", required=True))
        try:
            departure_date = date.fromisoformat(params.get("departure_date", ""))
        except ValueError:
            raise serializers.ValidationError({"departure_date": "Enter a date as YYYY-MM-DD."}) from None
        return Response(
            [
                {
                    "run": str(fare.run_id),
                    "searched_at": fare.run.created_at,
                    "net_usd": f"{fare.net_usd:.2f}",
                    "net_amount": str(fare.net_amount),
                    "net_currency": fare.net_currency,
                }
                for fare in services.price_history(route, departure_date)
            ]
        )


def fare_response(request, fare):
    fare = Fare.objects.select_related("integration", "airline").get(pk=fare.pk)
    return Response(fares_data([fare], {"request": request})[0])


class FarePublishView(APIView):
    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        get_object_or_404(Fare, pk=pk)
        serializer = PublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fare = services.publish(pk, **serializer.validated_data)
        return fare_response(request, fare)


class FareDismissView(APIView):
    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        get_object_or_404(Fare, pk=pk)
        return fare_response(request, services.dismiss(pk))
