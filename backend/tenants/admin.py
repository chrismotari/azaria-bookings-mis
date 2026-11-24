from django import forms
from django.conf import settings
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import models
from django_tenants.utils import get_public_schema_name

from config.admin_site import platform_site

from . import billing, services
from .models import Domain, Tenant, Theme


def theme_choice(theme, current=None):
    try:
        return services.validate_theme_choice(theme, current)
    except ValidationError as exc:
        raise ValidationError(exc.message_dict["theme"]) from exc


class AddTenantForm(forms.ModelForm):
    """Name, address and first admin; saving goes through services.create_agency."""

    slug = forms.CharField(label="Address", max_length=30)
    admin_name = forms.CharField(label="First admin's full name", max_length=150)
    admin_email = forms.EmailField(label="First admin's email")
    admin_password = forms.CharField(label="First admin's password", widget=forms.PasswordInput, strip=False)

    class Meta:
        model = Tenant
        fields = ["name", "theme"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["slug"].help_text = (
            "3 to 30 lowercase letters, digits and hyphens. "
            f"The agency is reached at address.{settings.TENANT_BASE_DOMAIN}, e.g. acme.{settings.TENANT_BASE_DOMAIN}."
        )

    def clean_theme(self):
        return theme_choice(self.cleaned_data["theme"])

    def clean_slug(self):
        slug = self.cleaned_data["slug"].strip().lower()
        services.validate_slug(slug)
        return slug

    def clean(self):
        data = super().clean()
        if {"admin_email", "admin_password", "admin_name"} <= data.keys():
            try:
                services.validate_first_admin(data["admin_email"], data["admin_password"], data["admin_name"])
            except ValidationError as exc:
                for field, messages in exc.message_dict.items():
                    self.add_error(field, messages)
        return data


class TenantForm(forms.ModelForm):
    """An existing agency: its theme is an active one, or the one it already has."""

    class Meta:
        model = Tenant
        fields = "__all__"

    def clean_theme(self):
        return theme_choice(self.cleaned_data["theme"], self.instance.theme)


@admin.register(Theme, site=platform_site)
class ThemeAdmin(admin.ModelAdmin):
    """Read-only here: the system owner manages themes in the platform app, which checks their contrast."""

    list_display = ["name", "primary", "accent", "is_active", "is_default"]
    fields = ["name", "primary", "accent", "is_active", "is_default", "created_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class DomainInline(admin.TabularInline):
    model = Domain
    fields = ["domain", "is_primary"]
    extra = 0


@admin.register(Tenant, site=platform_site)
class TenantAdmin(admin.ModelAdmin):
    list_display = ["name", "schema_name", "primary_domain", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["name", "schema_name", "domains__domain"]
    readonly_fields = ["schema_name", "created_at", "suspension_reason", "suspended_at"]
    fields = [
        "name",
        "schema_name",
        "theme",
        "is_active",
        "suspension_reason",
        "suspended_at",
        "billing_email",
        "created_at",
    ]
    form = TenantForm
    inlines = [DomainInline]

    def get_queryset(self, request):
        # The platform's own row is not an agency.
        return super().get_queryset(request).exclude(schema_name=get_public_schema_name()).prefetch_related("domains")

    def get_form(self, request, obj=None, **kwargs):
        if obj is None:
            kwargs["form"] = AddTenantForm
        return super().get_form(request, obj, **kwargs)

    def get_fields(self, request, obj=None):
        if obj is None:
            return ["name", "slug", "theme", "admin_name", "admin_email", "admin_password"]
        return self.fields

    def get_readonly_fields(self, request, obj=None):
        return [] if obj is None else self.readonly_fields

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "theme":
            # Active themes, plus an inactive one the agency already has (TenantForm keeps it valid).
            choices = models.Q(is_active=True)
            agency = Tenant.objects.filter(pk=request.resolver_match.kwargs.get("object_id")).first()
            if agency is not None:
                choices |= models.Q(pk=agency.theme_id)
            kwargs["queryset"] = Theme.objects.filter(choices)
            kwargs.setdefault("initial", Theme.objects.filter(is_default=True).first())
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def get_inlines(self, request, obj):
        # Domains are created with the tenant; more can be added afterwards.
        return [] if obj is None else self.inlines

    def save_model(self, request, obj, form, change):
        if change:
            # Suspending and reactivating go through billing.set_active (reason, waived invoices).
            toggled = "is_active" in form.changed_data
            active = obj.is_active
            if toggled:
                obj.is_active = not active
            obj.save()
            if toggled:
                billing.set_active(obj, active)
            return
        data = form.cleaned_data
        tenant = services.create_agency(
            slug=data["slug"],
            name=data["name"],
            admin_email=data["admin_email"],
            admin_password=data["admin_password"],
            admin_name=data["admin_name"],
            theme=data["theme"],
        )
        # The admin goes on to log and redirect with this object.
        obj.pk, obj.schema_name, obj.created_at = tenant.pk, tenant.schema_name, tenant.created_at
        obj._state.adding = False

    def has_delete_permission(self, request, obj=None):
        # Tenants are suspended, never deleted.
        return False

    @admin.display(description="Primary domain")
    def primary_domain(self, tenant):
        return tenant.primary_domain
