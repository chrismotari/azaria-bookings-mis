from django.contrib import admin

from config.admin_site import platform_site

from .models import Airport


# Shared by every tenant, so only on the platform's admin.
@admin.register(Airport, site=platform_site)
class AirportAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "city", "country"]
    search_fields = ["code", "name", "city", "country"]
