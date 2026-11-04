from django.db.models import Case, IntegerField, Q, Value, When
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole

from .models import Airline
from .serializers import AirlineSerializer


class AirlineSearchView(APIView):
    """GET /airlines?search=: active airlines for the admin's airline picker; exact code matches first."""

    permission_classes = [IsAdminRole]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        airlines = Airline.objects.filter(is_active=True)
        if search:
            exact = Q(iata_code__iexact=search) | Q(icao_code__iexact=search)
            airlines = (
                airlines.filter(exact | Q(name__icontains=search))
                .annotate(rank=Case(When(exact, then=Value(0)), default=Value(1), output_field=IntegerField()))
                .order_by("rank", "name")
            )
        return Response(AirlineSerializer(airlines[:20], many=True, context={"request": request}).data)
