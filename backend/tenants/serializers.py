from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import DomainNameValidator
from django_tenants.utils import schema_context
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed

from accounts.models import User
from accounts.serializers import LoginSerializer

from .models import Domain, Tenant

NO_PLATFORM_ACCOUNT = "No platform account found with the given credentials."


class PlatformUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]
        read_only_fields = fields


class PlatformLoginSerializer(LoginSerializer):
    """Signs in the system owner: active superusers of the public schema only."""

    default_error_messages = {"no_active_account": NO_PLATFORM_ACCOUNT}

    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.is_superuser:
            raise AuthenticationFailed(NO_PLATFORM_ACCOUNT, "no_active_account")
        data["user"] = PlatformUserSerializer(self.user).data
        return data


def slug_of(tenant):
    """The address the owner typed: the schema name with its hyphens back."""
    return tenant.schema_name.replace("_", "-")


class TenantSerializer(serializers.ModelSerializer):
    slug = serializers.SerializerMethodField()
    primary_domain = serializers.SerializerMethodField()
    searches_this_month = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            "id",
            "name",
            "slug",
            "primary_domain",
            "is_active",
            "suspension_reason",
            "suspended_at",
            "billing_email",
            "monthly_search_allowance",
            "searches_this_month",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "slug",
            "primary_domain",
            "suspension_reason",
            "suspended_at",
            "searches_this_month",
            "created_at",
        ]

    def get_slug(self, tenant):
        return slug_of(tenant)

    def get_primary_domain(self, tenant):
        # From the prefetched domains, so a page of tenants costs one query for all of them.
        return next((domain.domain for domain in tenant.domains.all() if domain.is_primary), None)

    def get_searches_this_month(self, tenant):
        from integrations.services import searches_this_month

        # Runs live in the agency's own schema.
        with schema_context(tenant.schema_name):
            return searches_this_month()

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter the agency's name.")
        return value.strip()


class DomainSerializer(serializers.ModelSerializer):
    # Declared so the model's own unique check (with its generic message) does not run before validate_domain.
    domain = serializers.CharField(max_length=253)

    class Meta:
        model = Domain
        fields = ["id", "domain", "is_primary"]
        read_only_fields = ["id", "is_primary"]

    def validate_domain(self, value):
        domain = value.strip().lower().rstrip(".")
        # The root host is the platform itself (checked first: "localhost" has no dot, so is not a valid name).
        if domain == settings.TENANT_BASE_DOMAIN or Domain.objects.filter(domain=domain).exists():
            raise serializers.ValidationError("This domain is already in use.")
        try:
            DomainNameValidator(accept_idna=False)(domain)
        except DjangoValidationError:
            raise serializers.ValidationError("Enter a valid hostname, e.g. acme.192.168.1.5.nip.io.")
        return domain


class TenantDetailSerializer(TenantSerializer):
    domains = DomainSerializer(many=True, read_only=True)

    class Meta(TenantSerializer.Meta):
        fields = [*TenantSerializer.Meta.fields, "domains"]


class TenantCreateSerializer(serializers.Serializer):
    """The new agency and its first admin; saving goes through services.create_agency."""

    name = serializers.CharField(max_length=100, trim_whitespace=False)
    slug = serializers.CharField(max_length=30)
    admin_name = serializers.CharField(max_length=150, trim_whitespace=False)
    admin_email = serializers.CharField(max_length=254)
    admin_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_slug(self, value):
        return value.strip().lower()
