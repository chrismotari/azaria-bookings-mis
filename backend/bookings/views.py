from django.http import FileResponse, Http404
from rest_framework import generics, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from customer_requests.models import Query

from .models import BoardingPass, Booking
from .serializers import (
    AdminBookingDetailSerializer,
    AdminBookingSerializer,
    BoardingPassSerializer,
    BoardingPassUploadSerializer,
    BookingCreateSerializer,
    BookingDetailSerializer,
    BookingSerializer,
)
from .services import add_boarding_pass, create_booking, delete_boarding_pass, transition

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
    queryset = Booking.objects.select_related("user", *BOOKING_RELATED).prefetch_related("events", "boarding_passes")


class AdminBookingTransitionView(APIView):
    """POST /admin/bookings/{id}/<action>; the URL conf sets to_status."""

    permission_classes = [IsAdminRole]
    to_status = None

    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk)
        booking = transition(pk, self.to_status, request.user)
        return Response(AdminBookingDetailSerializer(booking).data)


class AdminBoardingPassUploadView(APIView):
    """POST /admin/bookings/{id}/boarding-passes: one file per request, field "file"."""

    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk)
        serializer = BoardingPassUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        boarding_pass = add_boarding_pass(pk, serializer.validated_data["file"])
        return Response(BoardingPassSerializer(boarding_pass).data, status=status.HTTP_201_CREATED)


class AdminBoardingPassDeleteView(APIView):
    permission_classes = [IsAdminRole]

    def delete(self, request, pk):
        delete_boarding_pass(generics.get_object_or_404(BoardingPass, pk=pk))
        return Response(status=status.HTTP_204_NO_CONTENT)


class BoardingPassDownloadView(APIView):
    """The admin may download any pass; a customer only their own, once the booking is completed."""

    def get(self, request, pk):
        boarding_pass = generics.get_object_or_404(BoardingPass.objects.select_related("booking"), pk=pk)
        booking = boarding_pass.booking
        is_admin = request.user.role == request.user.Role.ADMIN
        if not is_admin and (booking.user_id != request.user.pk or booking.status != Booking.Status.COMPLETED):
            raise Http404
        return FileResponse(boarding_pass.file.open("rb"), as_attachment=True, filename=boarding_pass.original_name)


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
