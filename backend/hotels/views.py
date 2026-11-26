import django_filters
from django.db.models import Prefetch
from django.http import FileResponse, Http404
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.views import APIView

from bookings.models import Traveller
from bookings.serializers import TravellerSerializer
from core.permissions import IsAdminRole
from reviews.models import with_rating

from . import pricing, services
from .models import Hotel, HotelBooking, HotelBookingRoom, HotelPhoto, HotelVoucher, RoomRate, RoomType
from .serializers import (
    AdminHotelBookingCreateSerializer,
    AdminHotelBookingSerializer,
    AdminHotelSerializer,
    CompleteSerializer,
    ConfirmAvailabilitySerializer,
    HotelBookingCreateSerializer,
    HotelBookingSerializer,
    HotelInputSerializer,
    HotelPhotoSerializer,
    HotelPhotoUploadSerializer,
    HotelSerializer,
    HotelVoucherSerializer,
    MarkUnavailableSerializer,
    VoucherUploadSerializer,
    stay_context,
)

Status = HotelBooking.Status

ORDERINGS = {
    "from_price": lambda hotel: (hotel.listed_price, hotel.name.lower()),
    "-from_price": lambda hotel: (-hotel.listed_price, hotel.name.lower()),
    "-star_rating": lambda hotel: (-(hotel.star_rating or 0), hotel.listed_price, hotel.name.lower()),
    "name": lambda hotel: (hotel.name.lower(),),
}


def hotel_bookings():
    rooms = HotelBookingRoom.objects.prefetch_related("travellers")
    return HotelBooking.objects.select_related("hotel", "user", "created_by", "review").prefetch_related(
        "hotel__photos", Prefetch("rooms", queryset=rooms), "events", "vouchers"
    )


def admin_hotels():
    rates = RoomRate.objects.prefetch_related("periods")
    types = RoomType.objects.prefetch_related(Prefetch("rates", queryset=rates))
    return pricing.with_offered_rates(
        with_rating(Hotel.objects.all(), "hotel").prefetch_related("photos", Prefetch("room_types", queryset=types))
    ).order_by("name")


def admin_context(request, hotels):
    """What the admin serializer needs to mark booked room types and rates."""
    ids = [hotel.pk for hotel in hotels]
    booked = HotelBookingRoom.objects.filter(booking__hotel__in=ids)
    return {
        "request": request,
        "booked_types": set(booked.values_list("room_type", flat=True)),
        "booked_rates": set(booked.values_list("rate", flat=True)),
    }


# Public


class HotelListView(APIView):
    """Active hotels with an offered rate, for the stay and guests when given."""

    permission_classes = [AllowAny]

    def get(self, request):
        context = stay_context(request.query_params)
        stay = (context.get("check_in"), context.get("check_out"), context.get("adults"), context.get("children"))
        params = request.query_params
        destination = params.get("destination", "").strip().lower()
        name = params.get("name", "").strip().lower()
        hotels = []
        for hotel in pricing.public_hotels():
            if destination not in hotel.destination.lower() or name not in hotel.name.lower():
                continue
            hotel.listed_price = pricing.from_price(hotel, *stay)
            if hotel.listed_price is None:
                continue
            hotels.append(hotel)
        hotels = self.filtered(hotels, params)
        hotels.sort(key=ORDERINGS.get(params.get("ordering"), ORDERINGS["from_price"]))
        paginator = api_settings.DEFAULT_PAGINATION_CLASS()
        page = paginator.paginate_queryset(hotels, request, view=self)
        return paginator.get_paginated_response(
            HotelSerializer(page, many=True, context={**context, "request": request}).data
        )

    @staticmethod
    def filtered(hotels, params):
        """Minimum stars and the price range on the from price; a malformed number matches nothing."""
        try:
            stars = int(params["stars"]) if params.get("stars") else None
            price_min = float(params["price_min"]) if params.get("price_min") else None
            price_max = float(params["price_max"]) if params.get("price_max") else None
        except ValueError:
            return []
        return [
            hotel
            for hotel in hotels
            if (stars is None or (hotel.star_rating or 0) >= stars)
            and (price_min is None or hotel.listed_price >= price_min)
            and (price_max is None or hotel.listed_price <= price_max)
        ]


class HotelDetailView(APIView):
    """An active hotel, its room types and rates priced for the stay when given."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        context = stay_context(request.query_params)
        hotel = generics.get_object_or_404(pricing.public_hotels(), pk=pk)
        return Response(HotelSerializer(hotel, context={**context, "request": request}).data)


# Customers


class HotelBookingListCreateView(generics.ListAPIView):
    serializer_class = HotelBookingSerializer

    def get_queryset(self):
        return hotel_bookings().filter(user=self.request.user)

    def post(self, request):
        if request.user.role != request.user.Role.CUSTOMER:
            raise PermissionDenied("Only customers can book here.")
        serializer = HotelBookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        booking = services.create_booking(request.user, serializer.validated_data)
        return Response(
            HotelBookingSerializer(hotel_bookings().get(pk=booking.pk), context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class HotelBookingDetailView(generics.RetrieveAPIView):
    serializer_class = HotelBookingSerializer

    def get_queryset(self):
        return hotel_bookings().filter(user=self.request.user)


class HotelBookingActionView(APIView):
    """POST cancel, accept-changes or decline-changes on the customer's own booking."""

    action = None

    def post(self, request, pk):
        generics.get_object_or_404(HotelBooking, pk=pk, user=request.user)
        if self.action == "accept-changes":
            services.accept_changes(pk, request.user)
        else:
            to_status = Status.CANCELLED if self.action == "cancel" else Status.DECLINED
            services.transition(pk, to_status, request.user)
        return Response(HotelBookingSerializer(hotel_bookings().get(pk=pk), context={"request": request}).data)


class GuestsView(APIView):
    """POST a guest to one of the booker's (or, with admin, any) booking's rooms."""

    admin = False

    def get_permissions(self):
        return [IsAdminRole()] if self.admin else super().get_permissions()

    def booking(self, request, pk):
        bookings = HotelBooking.objects.all() if self.admin else HotelBooking.objects.filter(user=request.user)
        return generics.get_object_or_404(bookings, pk=pk)

    def post(self, request, pk, room_id):
        booking = self.booking(request, pk)
        serializer = TravellerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        guest = services.add_guest(booking.pk, room_id, serializer.validated_data, self.admin)
        return Response(TravellerSerializer(guest).data, status=status.HTTP_201_CREATED)


class GuestDetailView(GuestsView):
    def guest(self, request, pk, traveller_id):
        booking = self.booking(request, pk)
        return generics.get_object_or_404(
            Traveller.objects.select_related("hotel_room"), pk=traveller_id, hotel_room__booking=booking
        )

    def patch(self, request, pk, traveller_id):
        guest = self.guest(request, pk, traveller_id)
        serializer = TravellerSerializer(guest, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        guest = services.change_guest(guest, serializer.validated_data, self.admin)
        return Response(TravellerSerializer(guest).data)

    def delete(self, request, pk, traveller_id):
        services.remove_guest(self.guest(request, pk, traveller_id), self.admin)
        return Response(status=status.HTTP_204_NO_CONTENT)


class VoucherDownloadView(APIView):
    """Admins any voucher; a customer only their own, once the booking is completed."""

    def get(self, request, pk):
        voucher = generics.get_object_or_404(HotelVoucher.objects.select_related("booking"), pk=pk)
        booking = voucher.booking
        if request.user.role != request.user.Role.ADMIN and (
            booking.user_id != request.user.pk or booking.status != Status.COMPLETED
        ):
            raise Http404
        return FileResponse(voucher.file.open("rb"), as_attachment=True, filename=voucher.original_name)


# Admins


class AdminHotelFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(
        choices=[("active", "active"), ("inactive", "inactive")], method="filter_status"
    )
    featured = django_filters.BooleanFilter(field_name="is_featured")

    class Meta:
        model = Hotel
        fields = []

    def filter_status(self, queryset, name, value):
        return queryset.filter(is_active=value == "active")


def _hotel_input(request, instance=None):
    serializer = HotelInputSerializer(instance, data=request.data, partial=instance is not None)
    serializer.is_valid(raise_exception=True)
    fields = dict(serializer.validated_data)
    return fields, fields.pop("room_types", None)


def _admin_hotel(request, pk):
    hotel = admin_hotels().get(pk=pk)
    return AdminHotelSerializer(hotel, context=admin_context(request, [hotel])).data


class AdminHotelListView(generics.ListAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminHotelSerializer
    filterset_class = AdminHotelFilter

    def get_queryset(self):
        return admin_hotels()

    def get_serializer(self, hotels, *args, **kwargs):
        return AdminHotelSerializer(hotels, *args, context=admin_context(self.request, hotels), **kwargs)

    def post(self, request):
        fields, room_types = _hotel_input(request)
        hotel = services.save_hotel(None, fields, room_types or [])
        return Response(_admin_hotel(request, hotel.pk), status=status.HTTP_201_CREATED)


class AdminHotelDetailView(APIView):
    """PATCH: fields and room types (the whole list, with rates and periods). No delete."""

    permission_classes = [IsAdminRole]

    def get(self, request, pk):
        generics.get_object_or_404(Hotel, pk=pk)
        return Response(_admin_hotel(request, pk))

    def patch(self, request, pk):
        hotel = generics.get_object_or_404(Hotel, pk=pk)
        fields, room_types = _hotel_input(request, hotel)
        services.save_hotel(pk, fields, room_types)
        return Response(_admin_hotel(request, pk))


class AdminHotelPhotosView(APIView):
    """POST: one image per request, field "image"."""

    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        generics.get_object_or_404(Hotel, pk=pk)
        serializer = HotelPhotoUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        photo = services.add_photo(pk, serializer.validated_data["image"])
        return Response(HotelPhotoSerializer(photo, context={"request": request}).data, status=status.HTTP_201_CREATED)


class AdminHotelPhotoDetailView(APIView):
    """PATCH {position} moves the photo there (0 is the cover); DELETE removes it and its file."""

    permission_classes = [IsAdminRole]

    def photo(self, pk, photo_id):
        return generics.get_object_or_404(HotelPhoto.objects.select_related("hotel"), pk=photo_id, hotel_id=pk)

    def patch(self, request, pk, photo_id):
        photo = self.photo(pk, photo_id)
        position = request.data.get("position")
        if not isinstance(position, int) or isinstance(position, bool) or position < 0:
            return Response({"position": ["Enter a position from 0."]}, status=status.HTTP_400_BAD_REQUEST)
        services.move_photo(photo, position)
        photos = HotelPhoto.objects.filter(hotel_id=pk)
        return Response(HotelPhotoSerializer(photos, many=True, context={"request": request}).data)

    def delete(self, request, pk, photo_id):
        services.delete_photo(self.photo(pk, photo_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminHotelBookingFilter(django_filters.FilterSet):
    class Meta:
        model = HotelBooking
        fields = ["status", "hotel"]


class AdminHotelBookingListView(generics.ListAPIView):
    """Also POST: the admin books for a customer; the booking then follows the normal flow from requested."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminHotelBookingSerializer
    filterset_class = AdminHotelBookingFilter

    def get_queryset(self):
        return hotel_bookings()

    def post(self, request):
        serializer = AdminHotelBookingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        booking = services.create_booking(data["user"], data, admin=request.user)
        return Response(
            AdminHotelBookingSerializer(hotel_bookings().get(pk=booking.pk), context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class AdminHotelBookingDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAdminRole]
    serializer_class = AdminHotelBookingSerializer

    def get_queryset(self):
        return hotel_bookings()


class AdminHotelBookingActionView(APIView):
    """POST confirm-availability {new_total?, note?}, mark-unavailable {message?}, mark-paid or complete
    {hotel_confirmation}."""

    permission_classes = [IsAdminRole]
    action = None

    def post(self, request, pk):
        booking = generics.get_object_or_404(HotelBooking, pk=pk)
        if self.action == "confirm-availability":
            services.check_transition(booking, Status.AVAILABILITY_CONFIRMED)
            data = self.valid(ConfirmAvailabilitySerializer, request)
            services.confirm_availability(pk, request.user, data.get("new_total"), data["note"])
        elif self.action == "mark-unavailable":
            services.check_transition(booking, Status.UNAVAILABLE)
            data = self.valid(MarkUnavailableSerializer, request)
            services.mark_unavailable(pk, request.user, data["message"].strip())
        elif self.action == "mark-paid":
            services.transition(pk, Status.PAID, request.user)
        else:
            services.check_transition(booking, Status.COMPLETED)
            data = self.valid(CompleteSerializer, request)
            services.complete(pk, request.user, data["hotel_confirmation"])
        return Response(AdminHotelBookingSerializer(hotel_bookings().get(pk=pk), context={"request": request}).data)

    def valid(self, serializer_class, request):
        serializer = serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class AdminVoucherUploadView(APIView):
    """One file per request, field "file"."""

    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        generics.get_object_or_404(HotelBooking, pk=pk)
        serializer = VoucherUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        voucher = services.add_voucher(pk, serializer.validated_data["file"])
        return Response(HotelVoucherSerializer(voucher).data, status=status.HTTP_201_CREATED)


class AdminVoucherDeleteView(APIView):
    permission_classes = [IsAdminRole]

    def delete(self, request, pk):
        services.delete_voucher(generics.get_object_or_404(HotelVoucher, pk=pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
