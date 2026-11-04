"""JWTs carry the tenant (schema name) they were issued by; they are refused at any other tenant."""

from django.db import connection
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

TENANT_CLAIM = "tenant"


def check_tenant(token):
    if token.get(TENANT_CLAIM) != connection.schema_name:
        raise InvalidToken("This token was issued by another agency.")


class TenantRefreshToken(RefreshToken):
    """A refresh token for the current tenant; its access tokens copy the claim."""

    @classmethod
    def for_user(cls, user):
        token = super().for_user(user)
        token[TENANT_CLAIM] = connection.schema_name
        return token


class TenantJWTAuthentication(JWTAuthentication):
    def get_validated_token(self, raw_token):
        token = super().get_validated_token(raw_token)
        check_tenant(token)
        return token


class TenantTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        check_tenant(RefreshToken(attrs["refresh"]))
        return super().validate(attrs)
