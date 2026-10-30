from django.db.models import Case, IntegerField, Q, Value, When
from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole

from .filters import AdminOfferFilter, OfferFilter
from .models import Airport, Offer
from .serializers import AdminOfferSerializer, AirportSerializer, OfferSerializer

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


class OfferListView(generics.ListAPIView):
    """Browse: bookable public offers only."""

    permission_classes = [AllowAny]
    serializer_class = OfferSerializer
    filterset_class = OfferFilter

    def get_queryset(self):
        return Offer.objects.publicly_visible().bookable().select_related("origin", "destination")


class OfferDetailView(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    serializer_class = OfferSerializer

    def get_queryset(self):
        return Offer.objects.visible_to(self.request.user).select_related("origin", "destination")


class AdminOfferListView(generics.ListCreateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminOfferSerializer
    filterset_class = AdminOfferFilter
    queryset = Offer.objects.select_related("origin", "destination")


class AdminOfferDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminOfferSerializer
    queryset = Offer.objects.select_related("origin", "destination")
    http_method_names = ["get", "patch", "head", "options"]
