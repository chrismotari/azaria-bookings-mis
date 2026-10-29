from django.db.models import Case, IntegerField, Q, Value, When
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Airport
from .serializers import AirportSerializer

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
