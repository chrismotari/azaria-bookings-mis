from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from core.exceptions import Conflict
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
    """The agency's customers, or with ?role=admin its admins; creating one (always a customer) emails them a
    link to choose a password."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminCustomerSerializer
    filterset_class = AdminCustomerFilter

    def get_queryset(self):
        role = User.Role.ADMIN if self.request.query_params.get("role") == "admin" else User.Role.CUSTOMER
        return User.objects.filter(role=role).order_by("full_name", "email")

    def perform_create(self, serializer):
        user = serializer.save()
        queue(send_account_created_email, user.pk)


class AdminCustomerDetailView(generics.RetrieveUpdateAPIView):
    """A customer or admin. Deactivating (is_active false) stands in for deleting: requests and bookings stay.
    Admins cannot deactivate themselves."""

    permission_classes = [IsAdminRole]
    serializer_class = AdminCustomerSerializer
    queryset = User.objects.all()
    http_method_names = ["get", "patch", "head", "options"]

    def perform_update(self, serializer):
        if serializer.instance == self.request.user and serializer.validated_data.get("is_active") is False:
            raise Conflict("You cannot deactivate your own account.")
        serializer.save()


class AdminUserPasswordResetView(APIView):
    """Emails an active customer or admin the reset link (it also sets a first password)."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if not user.is_active:
            raise Conflict("This user is deactivated: reactivate them before sending a reset link.")
        queue(send_password_reset_email, user.pk)
        return Response({"detail": f"A reset link has been sent to {user.email}."})


class AdminCustomerMakeAdminView(APIView):
    """Promotes a customer to admin; they then leave the customer list, and keep their requests and bookings."""

    permission_classes = [IsAdminRole]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk, role=User.Role.CUSTOMER)
        if not user.is_active:
            raise Conflict("This customer is deactivated: reactivate them before making them an admin.")
        user.role = User.Role.ADMIN
        user.save(update_fields=["role"])
        return Response({"detail": f"{user.full_name} is now an admin."})
