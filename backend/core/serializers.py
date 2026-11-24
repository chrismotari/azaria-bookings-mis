from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from tenants.models import Tenant, Theme
from tenants.services import validate_theme_choice

from .models import AppSettings


class AppSettingsSerializer(serializers.ModelSerializer):
    payment_hold_hours = serializers.IntegerField(min_value=1)
    reminder_hours_before = serializers.IntegerField(min_value=1)
    # The agency's theme (its id), saved on the agency itself rather than in its settings row.
    theme = serializers.PrimaryKeyRelatedField(queryset=Theme.objects.all(), required=False, write_only=True)

    class Meta:
        model = AppSettings
        fields = [
            "payment_instructions",
            "payment_hold_hours",
            "reminder_hours_before",
            "admin_notification_email",
            "theme",
        ]

    @property
    def tenant(self):
        return self.context["request"].tenant

    def to_representation(self, instance):
        return {**super().to_representation(instance), "theme": str(self.tenant.theme_id)}

    def validate_theme(self, value):
        try:
            return validate_theme_choice(value, self.tenant.theme)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict["theme"]) from exc

    def update(self, instance, validated_data):
        theme = validated_data.pop("theme", None)
        if theme is not None:
            Tenant.objects.filter(pk=self.tenant.pk).update(theme=theme)
            self.tenant.theme = theme
        return super().update(instance, validated_data)
