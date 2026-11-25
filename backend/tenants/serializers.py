from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import DomainNameValidator
from django_tenants.utils import schema_context
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed

from accounts.models import User
from accounts.serializers import LoginSerializer

from . import themes
from .models import MODULES, Domain, Tenant, Theme

NO_PLATFORM_ACCOUNT = "No platform account found with the given credentials."


class PlatformUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]
        read_only_fields = fields


class PlatformAgencyAdminSerializer(serializers.ModelSerializer):
    """One of an agency's admins as the owner sees them; only is_active can be changed."""

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "is_active", "last_login"]
        read_only_fields = ["id", "email", "full_name", "phone", "last_login"]


class PlatformLoginSerializer(LoginSerializer):
    """Signs in the system owner: active superusers of the public schema only."""

    default_error_messages = {"no_active_account": NO_PLATFORM_ACCOUNT}

    def validate(self, attrs):
        data = super().validate(attrs)
        if not self.user.is_superuser:
            raise AuthenticationFailed(NO_PLATFORM_ACCOUNT, "no_active_account")
        data["user"] = PlatformUserSerializer(self.user).data
        return data


class ThemeSerializer(serializers.ModelSerializer):
    """A theme as agencies and their apps see it: its name and every colour the app uses."""

    colors = serializers.SerializerMethodField()

    class Meta:
        model = Theme
        fields = ["id", "name", "colors"]
        read_only_fields = fields

    def get_colors(self, theme):
        return theme.colors


class PlatformThemeSerializer(ThemeSerializer):
    """The owner's view: create and change themes. Every save passes the contrast rules (tenants.themes)."""

    # Declared so validate_name's message (and its case-insensitive check) replaces the model's unique check.
    name = serializers.CharField(max_length=40)
    primary = serializers.CharField(write_only=True)
    accent = serializers.CharField(write_only=True)
    agency_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Theme
        fields = ["id", "name", "colors", "primary", "accent", "is_active", "is_default", "agency_count"]
        read_only_fields = ["id", "colors", "is_default", "agency_count"]

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Enter the theme's name.")
        if Theme.objects.filter(name__iexact=name).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("A theme with this name already exists.")
        return name

    def _color(self, value):
        if not themes.HEX.match(value.strip()):
            raise serializers.ValidationError("Enter a colour as #rrggbb.")
        return value.strip().lower()

    def validate_primary(self, value):
        value = self._color(value)
        if problems := themes.primary_problems(value):
            raise serializers.ValidationError(problems)
        return value

    def validate_accent(self, value):
        value = self._color(value)
        if problems := themes.accent_problems(value):
            raise serializers.ValidationError(problems)
        return value

    def validate_is_active(self, value):
        if not value and self.instance is not None and self.instance.is_default:
            raise serializers.ValidationError("The default theme cannot be deactivated.")
        return value


def slug_of(tenant):
    """The address the owner typed: the schema name with its hyphens back."""
    return tenant.schema_name.replace("_", "-")


def validate_modules(value):
    from .services import validate_modules

    try:
        return validate_modules(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(exc.message_dict["modules"]) from exc


def modules_field():
    return serializers.ListField(child=serializers.ChoiceField(choices=MODULES), required=False)


class TenantSerializer(serializers.ModelSerializer):
    slug = serializers.SerializerMethodField()
    modules = modules_field()
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
            "theme",
            "modules",
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

    def validate_modules(self, value):
        return validate_modules(value)

    def validate_theme(self, value):
        from .services import validate_theme_choice

        try:
            return validate_theme_choice(value, getattr(self.instance, "theme", None))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict["theme"]) from exc


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
            raise serializers.ValidationError("Enter a valid hostname, e.g. acme.192.168.1.5.nip.io.") from None
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
    # The default theme when left out.
    theme = serializers.PrimaryKeyRelatedField(queryset=Theme.objects.all(), required=False)
    modules = modules_field()

    def validate_modules(self, value):
        return validate_modules(value)

    def validate_slug(self, value):
        return value.strip().lower()
