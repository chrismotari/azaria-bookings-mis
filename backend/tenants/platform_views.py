"""The platform API on the root host: the system owner signs in and manages agencies."""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django_tenants.utils import get_public_schema_name, schema_context
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from accounts.models import User
from accounts.tasks import send_password_reset_email
from core.throttling import IPScopedRateThrottle

from . import billing, services
from .models import Domain, Tenant
from .permissions import IsPlatformOwner
from .serializers import (
    DomainSerializer,
    PlatformAgencyAdminSerializer,
    PlatformLoginSerializer,
    PlatformUserSerializer,
    TenantCreateSerializer,
    TenantDetailSerializer,
    TenantSerializer,
)


class PlatformLoginView(TokenObtainPairView):
    serializer_class = PlatformLoginSerializer
    throttle_classes = [IPScopedRateThrottle]
    throttle_scope = "login"


class PlatformMeView(APIView):
    permission_classes = [IsPlatformOwner]

    def get(self, request):
        return Response(PlatformUserSerializer(request.user).data)


def agencies():
    # The public schema's row is the platform itself, not an agency.
    return Tenant.objects.exclude(schema_name=get_public_schema_name()).prefetch_related("domains")


class PlatformTenantListView(generics.ListCreateAPIView):
    permission_classes = [IsPlatformOwner]
    serializer_class = TenantSerializer
    filterset_fields = ["is_active"]

    def get_queryset(self):
        queryset = agencies()
        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(schema_name__icontains=services.schema_name_for(search.lower()))
                | Q(domains__domain__icontains=search)
            ).distinct()
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = TenantCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            tenant = services.create_agency(
                slug=data["slug"],
                name=data["name"],
                admin_email=data["admin_email"],
                admin_password=data["admin_password"],
                admin_name=data["admin_name"],
            )
        except DjangoValidationError as exc:
            # The address checks raise plain errors; the others name their fields.
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "error_dict") else {"slug": exc.messages})
        return Response(TenantDetailSerializer(agencies().get(pk=tenant.pk)).data, status=status.HTTP_201_CREATED)


class PlatformTenantDetailView(generics.RetrieveUpdateAPIView):
    """Rename, suspend and reactivate; tenants are never deleted."""

    permission_classes = [IsPlatformOwner]
    serializer_class = TenantDetailSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return agencies()

    def get_serializer(self, *args, **kwargs):
        kwargs.setdefault("partial", True)
        return super().get_serializer(*args, **kwargs)

    def perform_update(self, serializer):
        active = serializer.validated_data.pop("is_active", None)
        tenant = serializer.save()
        if active is not None:
            billing.set_active(tenant, active)
        # The response lists the domains as they are now.
        serializer.instance = agencies().get(pk=tenant.pk)


class PlatformDomainListView(APIView):
    permission_classes = [IsPlatformOwner]

    def post(self, request, pk):
        tenant = get_object_or_404(agencies(), pk=pk)
        serializer = DomainSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(tenant=tenant, is_primary=False)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


def tenant_domain(pk, domain_id):
    tenant = get_object_or_404(agencies(), pk=pk)
    return get_object_or_404(Domain, pk=domain_id, tenant=tenant)


class PlatformDomainDetailView(APIView):
    permission_classes = [IsPlatformOwner]

    def delete(self, request, pk, domain_id):
        domain = tenant_domain(pk, domain_id)
        if domain.is_primary:
            return Response({"detail": "The primary domain cannot be removed."}, status=status.HTTP_409_CONFLICT)
        domain.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlatformDomainMakePrimaryView(APIView):
    permission_classes = [IsPlatformOwner]

    def post(self, request, pk, domain_id):
        with transaction.atomic():
            domain = tenant_domain(pk, domain_id)
            Domain.objects.filter(tenant_id=domain.tenant_id, is_primary=True).exclude(pk=domain.pk).update(
                is_primary=False
            )
            if not domain.is_primary:
                domain.is_primary = True
                domain.save(update_fields=["is_primary"])
        return Response(DomainSerializer(domain).data)


# An agency's admins (role admin in its schema): suspend or restore them, or email them a reset link.


def agency_admins():
    return User.objects.filter(role=User.Role.ADMIN)


class PlatformAgencyAdminListView(APIView):
    permission_classes = [IsPlatformOwner]

    def get(self, request, pk):
        tenant = get_object_or_404(agencies(), pk=pk)
        with schema_context(tenant.schema_name):
            admins = list(agency_admins().order_by("full_name", "email"))
        return Response(PlatformAgencyAdminSerializer(admins, many=True).data)


class PlatformAgencyAdminDetailView(APIView):
    """Suspending (is_active false) blocks sign-in and refuses its tokens; nothing is deleted."""

    permission_classes = [IsPlatformOwner]

    def patch(self, request, pk, admin_id):
        tenant = get_object_or_404(agencies(), pk=pk)
        with schema_context(tenant.schema_name):
            admin = get_object_or_404(agency_admins(), pk=admin_id)
            serializer = PlatformAgencyAdminSerializer(admin, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data)


class PlatformAgencyAdminPasswordResetView(APIView):
    """Emails the admin the agency's usual reset link; suspended admins and agencies get none."""

    permission_classes = [IsPlatformOwner]

    def post(self, request, pk, admin_id):
        tenant = get_object_or_404(agencies(), pk=pk)
        with schema_context(tenant.schema_name):
            admin = get_object_or_404(agency_admins(), pk=admin_id)
        if not tenant.is_active:
            return Response(
                {"detail": "The agency is suspended: reactivate it before sending a reset link."},
                status=status.HTTP_409_CONFLICT,
            )
        if not admin.is_active:
            return Response(
                {"detail": "This admin is suspended: restore them before sending a reset link."},
                status=status.HTTP_409_CONFLICT,
            )
        transaction.on_commit(lambda: send_password_reset_email.delay(tenant.schema_name, admin.pk))
        return Response({"detail": f"A reset link has been sent to {admin.email}."})
