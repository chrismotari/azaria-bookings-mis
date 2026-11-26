from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Offer
from catalog.serializers import OfferSerializer
from catalog.views import OFFER_RELATED, OFFER_SEGMENTS
from hotels import pricing
from hotels.serializers import HotelSerializer
from tenants.models import Theme
from tenants.serializers import ThemeSerializer
from tours.models import Tour
from tours.serializers import TourSerializer
from tours.views import tours

from . import mail_server
from .models import AppSettings
from .permissions import IsAdminRole
from .serializers import AppSettingsSerializer


class AdminSettingsView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AppSettingsSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return AppSettings.get()


class AdminMailServerView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response(mail_server.read())

    def put(self, request):
        return mail_server.save(request.data)

    def delete(self, request):
        return mail_server.remove()


class AdminMailServerTestView(APIView):
    permission_classes = [IsAdminRole]

    def post(self, request):
        return mail_server.send_test(request.user.email)


class AdminThemeListView(generics.ListAPIView):
    """The themes an agency can choose: the active ones, default first."""

    permission_classes = [IsAdminRole]
    serializer_class = ThemeSerializer
    pagination_class = None

    def get_queryset(self):
        return Theme.objects.filter(is_active=True).order_by("-is_default", "name")


EXPLORE_CARDS = 6


def featured_flights(request):
    offers = (
        Offer.objects.publicly_visible()
        .bookable()
        .select_related(*OFFER_RELATED)
        .prefetch_related(*OFFER_SEGMENTS)
        .order_by("-is_featured", "departure_date", "price")[:EXPLORE_CARDS]
    )
    return OfferSerializer(offers, many=True, context={"request": request}).data


def featured_tours(request):
    listed = Tour.objects.listed().values("pk")
    cards = tours().filter(pk__in=listed).order_by("-is_featured", "start_date", "title")[:EXPLORE_CARDS]
    return TourSerializer(cards, many=True, context={"request": request}).data


def featured_hotels(request):
    hotels = []
    for hotel in pricing.public_hotels():
        hotel.listed_price = pricing.from_price(hotel)
        if hotel.listed_price is not None:
            hotels.append(hotel)
    hotels.sort(key=lambda hotel: (not hotel.is_featured, hotel.listed_price, hotel.name.lower()))
    return HotelSerializer(hotels[:EXPLORE_CARDS], many=True, context={"request": request}).data


FEATURED = {"flights": featured_flights, "tours": featured_tours, "hotels": featured_hotels}


class ExploreView(APIView):
    """Up to six cards per module on: featured items first, then the rest of what customers can see."""

    permission_classes = [AllowAny]

    def get(self, request):
        tenant = request.tenant
        return Response({module: cards(request) for module, cards in FEATURED.items() if tenant.has_module(module)})
