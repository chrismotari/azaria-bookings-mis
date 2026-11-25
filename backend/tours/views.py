import django_filters
from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.models import Traveller
from bookings.serializers import TravellerSerializer
from core.permissions import IsAdminRole

from . import services
from .models import Tour, TourBooking, TourNotice, TourPhoto, TourPriceOption
from .serializers import (
    AdminCancelSerializer,
    AdminTourBookingCreateSerializer,
    AdminTourBookingSerializer,
    AdminTourSerializer,
    CancelTourSerializer,
    TourBookingCreateSerializer,
    TourBookingSerializer,
    TourInputSerializer,
    TourNoticeSerializer,
    TourPhotoSerializer,
    TourPhotoUploadSerializer,
    TourSerializer,
    TravellerAddSerializer,
)


def tours():
    return Tour.objects.with_figures().prefetch_related(
        "photos", Prefetch("options", queryset=TourPriceOption.objects.with_sold(), to_attr="all_options")
    )


def admin_tours():
    return (
        tours()
        .select_related("cancelled_by")
        .annotate(confirmed_bookings=Count("bookings", filter=Q(bookings__status=TourBooking.Status.CONFIRMED)))
    )


def tour_bookings():
    return TourBooking.objects.select_related("tour", "user", "created_by").prefetch_related(
        "tour__photos", "lines__travellers", "events"
    )


class TourFilter(django_filters.FilterSet):
    search = django_filters.CharFilter(method="filter_search")
    date_from = django_filters.DateFilter(field_name="start_date", lookup_expr="gte")
    date_to = django_filters.DateFilter(field_name="start_date", lookup_expr="lte")
    price_min = django_filters.NumberFilter(field_name="from_price", lookup_expr="gte")
    price_max = django_filters.NumberFilter(field_name="from_price", lookup_expr="lte")
    ordering = django_filters.OrderingFilter(fields=["start_date", "from_price"])

    class Meta:
        model = Tour
        fields = []

    def filter_search(self, queryset, name, value):
        value = value.strip()
        if not value:
            return queryset
        return queryset.filter(Q(title__icontains=value) | Q(destination__icontains=value))


class TourListView(generics.ListAPIView):
    """Bookable tours, soonest first."""

    permission_classes = [AllowAny]
    serializer_class = TourSerializer
    filterset_class = TourFilter

    def get_queryset(self):
        bookable = Tour.objects.bookable().values("pk")
        return tours().filter(pk__in=bookable).order_by("start_date", "title")


class TourDetailView(generics.RetrieveAPIView):
    """A bookable tour, or any tour the signed-in customer has booked."""

    permission_classes = [AllowAny]
    serializer_class = TourSerializer

    def get_queryset(self):
        visible = Q(pk__in=Tour.objects.bookable().values("pk"))
        user = self.request.user
        if user.is_authenticated:
            visible |= Q(pk__in=TourBooking.objects.filter(user=user).values("tour"))
        return tours().filter(visible)


# Customers


class TourBookingListCreateView(generics.ListAPIView):
    serializer_class = TourBookingSerializer

    def get_queryset(self):
        return tour_bookings().filter(user=self.request.user)

    def post(self, request):
        if request.user.role != request.user.Role.CUSTOMER:
            raise PermissionDenied("Only customers can book here.")
        serializer = TourBookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        booking = services.book_tour(data["tour"], request.user, data)
        return Response(
            TourBookingSerializer(tour_bookings().get(pk=booking.pk), context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class TourBookingDetailView(generics.RetrieveAPIView):
    serializer_class = TourBookingSerializer

    def get_queryset(self):
        return tour_bookings().filter(user=self.request.user)


class TourBookingCancelView(APIView):
    def post(self, request, pk):
        generics.get_object_or_404(TourBooking, pk=pk, user=request.user)
        services.cancel_by_customer(pk, request.user)
        return Response(TourBookingSerializer(tour_bookings().get(pk=pk), context={"request": request}).data)


class TravellersView(APIView):
    """POST {line, ...the traveller}: the booker's (or, with admin, any) booking."""

    admin = False

    def get_permissions(self):
        return [IsAdminRole()] if self.admin else super().get_permissions()

    def booking(self, request, pk):
        bookings = TourBooking.objects.all() if self.admin else TourBooking.objects.filter(user=request.user)
        return generics.get_object_or_404(bookings, pk=pk)

    def post(self, request, pk):
        booking = self.booking(request, pk)
        serializer = TravellerAddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        line = data.pop("line")
        traveller = services.add_traveller(booking.pk, line, data)
        return Response(TravellerSerializer(traveller).data, status=status.HTTP_201_CREATED)


class TravellerDetailView(TravellersView):
    def traveller(self, request, pk, traveller_id):
        booking = self.booking(request, pk)
        return generics.get_object_or_404(
            Traveller.objects.select_related("tour_line"), pk=traveller_id, tour_line__booking=booking
        )

    def patch(self, request, pk, traveller_id):
        traveller = self.traveller(request, pk, traveller_id)
        serializer = TravellerSerializer(traveller, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        traveller = services.change_traveller(traveller, serializer.validated_data)
        return Response(TravellerSerializer(traveller).data)

    def delete(self, request, pk, traveller_id):
        services.remove_traveller(self.traveller(request, pk, traveller_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


# Admins


class AdminTourFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(
        choices=[(value, value) for value in ("upcoming", "past", "inactive", "cancelled")], method="filter_status"
    )

    class Meta:
        model = Tour
        fields = []

    def filter_status(self, queryset, name, value):
        today = timezone.localdate()
        if value == "cancelled":
            return queryset.filter(cancelled_at__isnull=False)
        queryset = queryset.filter(cancelled_at__isnull=True)
        if value == "past":
            return queryset.filter(end_date__lt=today)
        return queryset.filter(end_date__gte=today, is_active=value == "upcoming")


def _tour_input(request, instance=None):
    serializer = TourInputSerializer(instance, data=request.data, partial=instance is not None)
    serializer.is_valid(raise_exception=True)
    fields = dict(serializer.validated_data)
    options = fields.pop("options", None)
    notice = fields.pop("notice", "").strip()
    return fields, options, notice


class AdminTourListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminTourSerializer
    filterset_class = AdminTourFilter

    def get_queryset(self):
        return admin_tours().order_by("start_date", "title")

    def post(self, request):
        fields, options, _ = _tour_input(request)
        tour = services.save_tour(None, fields, options, request.user)
        return Response(
            AdminTourSerializer(admin_tours().get(pk=tour.pk), context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class AdminTourDetailView(generics.RetrieveAPIView):
    """PATCH: fields, options (the whole list) and an optional notice. No delete."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminTourSerializer

    def get_queryset(self):
        return admin_tours()

    def patch(self, request, pk):
        tour = generics.get_object_or_404(Tour, pk=pk)
        fields, options, notice = _tour_input(request, tour)
        services.save_tour(pk, fields, options, request.user, notice)
        return Response(AdminTourSerializer(admin_tours().get(pk=pk), context={"request": request}).data)


class AdminTourCancelView(APIView):
    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        generics.get_object_or_404(Tour, pk=pk)
        serializer = CancelTourSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.cancel_tour(pk, request.user, serializer.validated_data["message"])
        return Response(AdminTourSerializer(admin_tours().get(pk=pk), context={"request": request}).data)


class AdminTourNoticesView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = TourNoticeSerializer
    pagination_class = None

    def get_queryset(self):
        tour = generics.get_object_or_404(Tour, pk=self.kwargs["pk"])
        return TourNotice.objects.filter(tour=tour).select_related("sent_by")


class AdminTourPhotosView(APIView):
    """POST: one image per request, field "image"."""

    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        generics.get_object_or_404(Tour, pk=pk)
        serializer = TourPhotoUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        photo = services.add_photo(pk, serializer.validated_data["image"])
        return Response(TourPhotoSerializer(photo, context={"request": request}).data, status=status.HTTP_201_CREATED)


class AdminTourPhotoDetailView(APIView):
    """PATCH {position} moves the photo there (0 is the cover); DELETE removes it and its file."""

    permission_classes = [IsAdminRole]

    def photo(self, pk, photo_id):
        return generics.get_object_or_404(TourPhoto.objects.select_related("tour"), pk=photo_id, tour_id=pk)

    def patch(self, request, pk, photo_id):
        photo = self.photo(pk, photo_id)
        position = request.data.get("position")
        if not isinstance(position, int) or isinstance(position, bool) or position < 0:
            return Response({"position": ["Enter a position from 0."]}, status=status.HTTP_400_BAD_REQUEST)
        services.move_photo(photo, position)
        photos = TourPhoto.objects.filter(tour_id=pk)
        return Response(TourPhotoSerializer(photos, many=True, context={"request": request}).data)

    def delete(self, request, pk, photo_id):
        services.delete_photo(self.photo(pk, photo_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminTourBookingFilter(django_filters.FilterSet):
    class Meta:
        model = TourBooking
        fields = ["status", "tour"]


class AdminTourBookingListView(generics.ListAPIView):
    """Also POST: the admin books for a customer."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminTourBookingSerializer
    filterset_class = AdminTourBookingFilter

    def get_queryset(self):
        return tour_bookings()

    def post(self, request):
        serializer = AdminTourBookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        booking = services.book_tour(data["tour"], data["user"], data, admin=request.user)
        return Response(
            AdminTourBookingSerializer(tour_bookings().get(pk=booking.pk), context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class AdminTourBookingsView(generics.ListAPIView):
    """The bookings on one tour."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminTourBookingSerializer

    def get_queryset(self):
        tour = generics.get_object_or_404(Tour, pk=self.kwargs["pk"])
        return tour_bookings().filter(tour=tour)


class AdminTourBookingDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminTourBookingSerializer

    def get_queryset(self):
        return tour_bookings()


class AdminTourBookingCancelView(APIView):
    """Body: message (optional), emailed to the customer when given."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        generics.get_object_or_404(TourBooking, pk=pk)
        serializer = AdminCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.cancel_by_admin(pk, request.user, serializer.validated_data["message"].strip())
        return Response(AdminTourBookingSerializer(tour_bookings().get(pk=pk), context={"request": request}).data)
