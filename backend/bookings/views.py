from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from customer_requests.models import Query

from .models import Booking
from .serializers import (
    AdminBookingDetailSerializer,
    AdminBookingSerializer,
    BookingCreateSerializer,
    BookingDetailSerializer,
    BookingSerializer,
)
from .services import create_booking, transition

BOOKING_RELATED = ["offering__origin", "offering__destination"]


class BookingListCreateView(generics.ListAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(user=self.request.user).select_related(*BOOKING_RELATED)

    def post(self, request):
        serializer = BookingCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        booking = create_booking(request.user, serializer.validated_data)
        return Response(BookingDetailSerializer(booking).data, status=status.HTTP_201_CREATED)


class BookingDetailView(generics.RetrieveAPIView):
    serializer_class = BookingDetailSerializer

    def get_queryset(self):
        return (
            Booking.objects.filter(user=self.request.user)
            .select_related(*BOOKING_RELATED)
            .prefetch_related("events")
        )


class BookingCancelView(APIView):
    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk, user=request.user)
        booking = transition(pk, Booking.Status.CANCELLED, request.user)
        return Response(BookingDetailSerializer(booking).data)


class AdminBookingListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminBookingSerializer
    queryset = Booking.objects.select_related("user", *BOOKING_RELATED)
    filterset_fields = ["status"]


class AdminBookingDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminBookingDetailSerializer
    queryset = Booking.objects.select_related("user", *BOOKING_RELATED).prefetch_related("events")


class AdminBookingTransitionView(APIView):
    """POST /admin/bookings/{id}/<action>; the URL conf sets to_status."""

    permission_classes = [IsAdminRole]
    to_status = None

    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk)
        booking = transition(pk, self.to_status, request.user)
        return Response(AdminBookingDetailSerializer(booking).data)


class AdminDashboardView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        counts = {
            status: Booking.objects.filter(status=status).count()
            for status in [Booking.Status.REQUESTED, Booking.Status.AVAILABILITY_CONFIRMED, Booking.Status.PAID]
        }
        return Response(
            {
                "open_queries": Query.objects.filter(status=Query.Status.OPEN).count(),
                "bookings_requested": counts[Booking.Status.REQUESTED],
                "bookings_awaiting_payment": counts[Booking.Status.AVAILABILITY_CONFIRMED],
                "bookings_paid_awaiting_boarding_pass": counts[Booking.Status.PAID],
            }
        )
