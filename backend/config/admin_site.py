from django.contrib.admin import AdminSite


class SuperuserAdminSite(AdminSite):
    """Django's admin site, for technical support only: superusers only."""

    def has_permission(self, request):
        return request.user.is_active and request.user.is_superuser
