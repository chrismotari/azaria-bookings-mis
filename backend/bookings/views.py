from django.http import FileResponse, Http404
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from customer_requests.models import Query
from customer_requests.serializers import SuggestedOptionsSerializer
from integrations.models import Fare
from integrations.serializers import recheck_data
from integrations.services import recheck_fare

from .models import BoardingPass, Booking
from .serializers import (
    AdminBookingCreateSerializer,
    AdminBookingDetailSerializer,
    AdminBookingSerializer,
    BoardingPassSerializer,
    BoardingPassUploadSerializer,
    BookingCreateSerializer,
    BookingDetailSerializer,
    BookingSerializer,
    ConfirmAvailabilitySerializer,
)
from .services import (
    accept_changes,
    add_boarding_pass,
    check_transition,
    confirm_availability,
    create_booking,
    delete_boarding_pass,
    mark_unavailable,
    transition,
)

BOOKING_RELATED = ["offer__origin", "offer__destination", "offer__airline", "integration"]
BOOKING_SEGMENTS = [
    *(f"segments__{field}" for field in ("airline", "operating_airline", "origin", "destination")),
    *(f"offer__segments__{field}" for field in ("airline", "operating_airline", "origin", "destination")),
]


class BookingListCreateView(generics.ListAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return (
            Booking.objects.filter(user=self.request.user)
            .select_related(*BOOKING_RELATED)
            .prefetch_related(*BOOKING_SEGMENTS)
        )

    def post(self, request):
        # Customers book here; the admin books for a customer through POST /admin/bookings.
        if request.user.role != request.user.Role.CUSTOMER:
            raise PermissionDenied("Only customers can book here.")
        serializer = BookingCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        booking = create_booking(request.user, serializer.validated_data)
        return Response(BookingDetailSerializer(booking, context={"request": request}).data, status=status.HTTP_201_CREATED)


class BookingDetailView(generics.RetrieveAPIView):
    serializer_class = BookingDetailSerializer

    def get_queryset(self):
        return (
            Booking.objects.filter(user=self.request.user)
            .select_related(*BOOKING_RELATED)
            .prefetch_related("events", *BOOKING_SEGMENTS)
        )


class BookingCancelView(APIView):
    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk, user=request.user)
        booking = transition(pk, Booking.Status.CANCELLED, request.user)
        return Response(BookingDetailSerializer(booking, context={"request": request}).data)


class BookingAcceptChangesView(APIView):
    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk, user=request.user)
        booking = accept_changes(pk, request.user)
        return Response(BookingDetailSerializer(booking, context={"request": request}).data)


class BookingDeclineChangesView(APIView):
    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk, user=request.user)
        booking = transition(pk, Booking.Status.DECLINED, request.user)
        return Response(BookingDetailSerializer(booking, context={"request": request}).data)


class AdminBookingListView(generics.ListAPIView):
    """Also POST: the admin books for a customer; the booking then follows the normal flow from requested."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminBookingSerializer
    queryset = Booking.objects.select_related("user", *BOOKING_RELATED).prefetch_related(*BOOKING_SEGMENTS)
    filterset_fields = ["status"]

    def post(self, request):
        serializer = AdminBookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        booking = create_booking(data["user"], data, admin=request.user)
        return Response(AdminBookingDetailSerializer(booking, context={"request": request}).data, status=status.HTTP_201_CREATED)


class AdminBookingDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminBookingDetailSerializer
    queryset = Booking.objects.select_related("user", *BOOKING_RELATED).prefetch_related(
        "events", "boarding_passes", *BOOKING_SEGMENTS
    )


class AdminBookingTransitionView(APIView):
    """POST /admin/bookings/{id}/<action>; the URL conf sets to_status."""

    permission_classes = [IsAdminRole]
    to_status = None

    def post(self, request, pk):
        generics.get_object_or_404(Booking, pk=pk)
        booking = transition(pk, self.to_status, request.user)
        return Response(AdminBookingDetailSerializer(booking, context={"request": request}).data)


class AdminConfirmAvailabilityView(APIView):
    """Body (optional): unit_price and segments; values that differ from the booking's are applied."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        booking = generics.get_object_or_404(Booking.objects.select_related(*BOOKING_RELATED), pk=pk)
        check_transition(booking, Booking.Status.AVAILABILITY_CONFIRMED)
        serializer = ConfirmAvailabilitySerializer(data=request.data, context={"booking": booking})
        serializer.is_valid(raise_exception=True)
        booking = confirm_availability(pk, request.user, **serializer.validated_data)
        return Response(AdminBookingDetailSerializer(booking, context={"request": request}).data)


class AdminRecheckFareView(APIView):
    """Searches a requested GDS booking's flights again and returns their current price, or alternatives; the
    booking itself is not changed."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        booking = generics.get_object_or_404(
            Booking.objects.select_related("integration", "offer__route", "offer__origin", "offer__destination"),
            pk=pk,
        )
        return Response(recheck_data(recheck_fare(booking, request.user), {"request": request}))


class AdminMarkUnavailableView(APIView):
    """Body (optional): message, offer_ids and new_offers, as for responding to a request."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        check_transition(generics.get_object_or_404(Booking, pk=pk), Booking.Status.UNAVAILABLE)
        serializer = SuggestedOptionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        booking = mark_unavailable(pk, request.user, data["message"], data["offer_ids"], data["new_offers"])
        return Response(AdminBookingDetailSerializer(booking, context={"request": request}).data)


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
                "new_fares": Fare.objects.filter(status=Fare.Status.NEW, picked=True).count(),
            }
        )
