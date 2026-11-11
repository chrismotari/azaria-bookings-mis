from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.permissions import IsAdminRole
from core.tenancy import queue
from core.throttling import IPScopedRateThrottle

from .filters import AdminCustomerFilter
from .models import User
from .serializers import (
    AdminCustomerSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
    tokens_for,
)
from .tasks import send_account_created_email, send_password_reset_email, send_welcome_email


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [IPScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        queue(send_welcome_email, user.pk)
        return Response(tokens_for(user), status=status.HTTP_201_CREATED)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [IPScopedRateThrottle]
    throttle_scope = "login"


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [IPScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = User.objects.normalize_email(serializer.validated_data["email"])
        user = User.objects.filter(email=email, is_active=True).first()
        if user is not None:
            queue(send_password_reset_email, user.pk)
        return Response({"detail": "If an account exists for this email, a reset link has been sent."})


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [IPScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your password has been reset."})


class AdminCustomerListView(generics.ListCreateAPIView):
    """The agency's customers (only role customer); creating one emails them a link to choose a password."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminCustomerSerializer
    filterset_class = AdminCustomerFilter
    queryset = User.objects.filter(role=User.Role.CUSTOMER).order_by("full_name", "email")

    def perform_create(self, serializer):
        user = serializer.save()
        queue(send_account_created_email, user.pk)


class AdminCustomerDetailView(generics.RetrieveUpdateAPIView):
    """Deactivating (is_active false) stands in for deleting: requests and bookings stay."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminCustomerSerializer
    queryset = User.objects.filter(role=User.Role.CUSTOMER)
    http_method_names = ["get", "patch", "head", "options"]


class AdminCustomerMakeAdminView(APIView):
    """Promotes a customer to admin; they then leave the customer list, and keep their requests and bookings."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk, role=User.Role.CUSTOMER)
        if not user.is_active:
            return Response(
                {"detail": "This customer is deactivated: reactivate them before making them an admin."},
                status=status.HTTP_409_CONFLICT,
            )
        user.role = User.Role.ADMIN
        user.save(update_fields=["role"])
        return Response({"detail": f"{user.full_name} is now an admin."})
