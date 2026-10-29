from django.contrib import admin

from .models import AppSettings


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ["admin_notification_email", "payment_hold_hours", "reminder_hours_before"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
