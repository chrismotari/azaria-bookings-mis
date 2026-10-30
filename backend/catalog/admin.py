from django.contrib import admin

from .models import Airport, Offer


@admin.register(Airport)
class AirportAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "city", "country"]
    search_fields = ["code", "name", "city", "country"]


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = ["__str__", "ticket_class", "price", "valid_until", "is_public", "is_active"]
    list_filter = ["ticket_class", "is_public", "is_active"]
    raw_id_fields = ["origin", "destination"]
