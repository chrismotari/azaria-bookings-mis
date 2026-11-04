from django.contrib.auth import password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User
from .tokens import TenantRefreshToken


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "role"]
        read_only_fields = fields


def tokens_for(user):
    refresh = TenantRefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh), "user": UserSerializer(user).data}


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    full_name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=30)

    def validate_email(self, value):
        email = User.objects.normalize_email(value)
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate(self, attrs):
        candidate = User(email=attrs["email"], full_name=attrs["full_name"], phone=attrs["phone"])
        try:
            password_validation.validate_password(attrs["password"], candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(role=User.Role.CUSTOMER, **validated_data)


class LoginSerializer(TokenObtainPairSerializer):
    token_class = TenantRefreshToken

    def validate(self, attrs):
        attrs[self.username_field] = User.objects.normalize_email(attrs[self.username_field])
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False)

    def validate(self, attrs):
        try:
            pk = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=pk, is_active=True)
        except (ValueError, TypeError, OverflowError, DjangoValidationError, User.DoesNotExist):
            user = None
        if user is None or not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError({"token": "This reset link is invalid or has expired."})
        try:
            password_validation.validate_password(attrs["new_password"], user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        attrs["user"] = user
        return attrs

    def save(self):
        user = self.validated_data["user"]
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class AdminCustomerSerializer(serializers.ModelSerializer):
    """A customer as the admin manages them; the role is never changed here."""

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "phone", "is_active"]
        read_only_fields = ["id"]
        extra_kwargs = {"email": {"validators": []}}

    def validate_email(self, value):
        email = User.objects.normalize_email(value)
        others = User.objects.filter(email=email)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email

    def validate_full_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Enter the customer's name.")
        return value.strip()

    def create(self, validated_data):
        # No password: the customer chooses one from the welcome email (email 11).
        validated_data.pop("is_active", None)
        return User.objects.create_user(role=User.Role.CUSTOMER, password=None, **validated_data)
