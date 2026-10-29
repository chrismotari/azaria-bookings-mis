from django.db.models import Case, IntegerField, Q, Value, When
from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole

from .filters import AdminOfferingFilter, OfferingFilter
from .models import Airport, Offering
from .serializers import AdminOfferingSerializer, AirportSerializer, OfferingSerializer

AIRPORT_SEARCH_LIMIT = 20


class AirportSearchView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        if not search:
            return Response([])
        airports = (
            Airport.objects.filter(
                Q(code__icontains=search)
                | Q(name__icontains=search)
                | Q(city__icontains=search)
                | Q(country__icontains=search)
            )
            .annotate(
                exact=Case(When(code__iexact=search, then=Value(0)), default=Value(1), output_field=IntegerField())
            )
            .order_by("exact", "code")[:AIRPORT_SEARCH_LIMIT]
        )
        return Response(AirportSerializer(airports, many=True).data)


class OfferingListView(generics.ListAPIView):
    """Browse: bookable public offerings only."""

    permission_classes = [AllowAny]
    serializer_class = OfferingSerializer
    filterset_class = OfferingFilter

    def get_queryset(self):
        return Offering.objects.publicly_visible().bookable().select_related("origin", "destination")


class OfferingDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = OfferingSerializer

    def get_queryset(self):
        return Offering.objects.visible_to(self.request.user).select_related("origin", "destination")


class AdminOfferingListView(generics.ListCreateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminOfferingSerializer
    filterset_class = AdminOfferingFilter
    queryset = Offering.objects.select_related("origin", "destination")


class AdminOfferingDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminOfferingSerializer
    queryset = Offering.objects.select_related("origin", "destination")
    http_method_names = ["get", "patch", "head", "options"]
