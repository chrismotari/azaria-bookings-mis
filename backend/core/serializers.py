from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from tenants.models import Tenant, Theme
from tenants.services import validate_theme_choice

from .models import AppSettings, MailServer


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
        return {
            **super().to_representation(instance),
            "theme": str(self.tenant.theme_id),
            "modules": self.tenant.modules,
        }

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


class MailServerSerializer(serializers.ModelSerializer):
    port = serializers.IntegerField(min_value=1, max_value=65535)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=255)

    class Meta:
        model = MailServer
        fields = [
            "host",
            "port",
            "security",
            "username",
            "password",
            "from_email",
            "from_name",
            "last_success_at",
            "last_failure_at",
            "last_failure",
        ]
        read_only_fields = ["last_success_at", "last_failure_at", "last_failure"]

    def to_representation(self, instance):
        return {**super().to_representation(instance), "has_password": bool(instance.password), "in_use": True}

    def validate_host(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter the server's host.")
        return value.strip()

    def validate(self, attrs):
        username = attrs.get("username", "")
        password = attrs.get("password", "")
        stored = bool(self.instance and self.instance.password)
        if username and not (password or stored):
            raise serializers.ValidationError({"password": "Enter the password for this username."})
        if password and not username:
            raise serializers.ValidationError({"username": "Enter the username for this password."})
        return attrs

    def save(self, **kwargs):
        password = self.validated_data.pop("password", "")
        server = self.instance or MailServer()
        for field, value in self.validated_data.items():
            setattr(server, field, value)
        if not server.username:
            server.set_password("")
        elif password:
            server.set_password(password)
        server.save()
        self.instance = server
        return server


EMPTY_MAIL_SERVER = {
    "host": "",
    "port": 587,
    "security": MailServer.Security.STARTTLS,
    "username": "",
    "from_email": "",
    "from_name": "",
    "last_success_at": None,
    "last_failure_at": None,
    "last_failure": "",
    "has_password": False,
    "in_use": False,
}
