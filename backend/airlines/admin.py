from django.contrib import admin
from django.utils.html import format_html

from config.admin_site import platform_site

from .models import Airline


class HasLogoFilter(admin.SimpleListFilter):
    title = "logo"
    parameter_name = "has_logo"

    def lookups(self, request, model_admin):
        return [("yes", "Has a logo"), ("no", "No logo")]

    def queryset(self, request, queryset):
        if self.value() == "yes":
            return queryset.exclude(logo="")
        if self.value() == "no":
            return queryset.filter(logo="")
        return queryset


# Shared by every agency, so only on the platform's admin; the system owner curates the list and the logos.
@admin.register(Airline, site=platform_site)
class AirlineAdmin(admin.ModelAdmin):
    list_display = ["thumbnail", "iata_code", "icao_code", "name", "country", "is_active"]
    list_display_links = ["iata_code", "name"]
    list_filter = ["is_active", HasLogoFilter]
    search_fields = ["iata_code", "icao_code", "name", "country"]
    fields = ["iata_code", "icao_code", "name", "country", "is_active", "logo", "preview", "updated_at"]
    readonly_fields = ["preview", "updated_at"]

    def has_delete_permission(self, request, obj=None):
        # Offers point at airlines; deactivate instead.
        return False

    @admin.display(description="")
    def thumbnail(self, airline):
        return self._image(airline, 24)

    @admin.display(description="Current logo")
    def preview(self, airline):
        return self._image(airline, 64) or "No logo yet."

    @staticmethod
    def _image(airline, height):
        if not airline.logo:
            return ""
        return format_html(
            '<img src="{}" alt="" style="height:{}px;max-width:{}px;object-fit:contain;background:#fff;'
            'border:1px solid #dde2e5;border-radius:4px;padding:2px">',
            airline.logo.url,
            height,
            height * 3,
        )
