from django.contrib.admin import AdminSite


class SuperuserAdminSite(AdminSite):
    """Django's admin site, for technical support only: superusers only."""

    def has_permission(self, request):
        return request.user.is_active and request.user.is_superuser


# On the root host: the system owner manages tenants, domains, airports and the platform's own accounts.
platform_site = SuperuserAdminSite(name="platform_admin")
platform_site.site_header = "Azaria Bookings platform"
platform_site.site_title = "Platform admin"
