from rest_framework import serializers

from .models import AppSettings


class AppSettingsSerializer(serializers.ModelSerializer):
    payment_hold_hours = serializers.IntegerField(min_value=1)
    reminder_hours_before = serializers.IntegerField(min_value=1)

    class Meta:
        model = AppSettings
        fields = ["payment_instructions", "payment_hold_hours", "reminder_hours_before", "admin_notification_email"]
