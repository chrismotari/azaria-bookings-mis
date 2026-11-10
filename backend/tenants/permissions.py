from django.db import connection
from django_tenants.utils import get_public_schema_name
from rest_framework.permissions import BasePermission


class IsPlatformOwner(BasePermission):
    """The system owner: an active superuser of the public schema, on the root host."""

    def has_permission(self, request, view):
        user = request.user
        return bool(
            connection.schema_name == get_public_schema_name()
            and user
            and user.is_authenticated
            and user.is_active
            and user.is_superuser
        )
