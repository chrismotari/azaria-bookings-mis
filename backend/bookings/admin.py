from django.contrib import admin

from .models import Booking, BookingEvent


class BookingEventInline(admin.TabularInline):
    model = BookingEvent
    extra = 0
    readonly_fields = ["from_status", "to_status", "actor", "created_at"]
    can_delete = False


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ["__str__", "user", "offer", "status", "created_at"]
    list_filter = ["status"]
    raw_id_fields = ["user", "offer", "query"]
    inlines = [BookingEventInline]
