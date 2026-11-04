from django.contrib import admin

from .models import Offer


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = ["__str__", "ticket_class", "price", "valid_until", "is_public", "is_active"]
    list_filter = ["ticket_class", "is_public", "is_active"]
    raw_id_fields = ["origin", "destination", "airline"]
