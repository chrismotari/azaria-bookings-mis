from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """The agency owner's role in the app (User.role == "admin")."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == user.Role.ADMIN)
