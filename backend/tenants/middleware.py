from django.http import JsonResponse
from django_tenants.utils import get_public_schema_name

from .views import SUSPENDED


class SuspendedTenantMiddleware:
    """Refuses every /api/ request on a suspended tenant's hosts. Place right after TenantMainMiddleware."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        tenant = getattr(request, "tenant", None)
        if (
            tenant is not None
            and tenant.schema_name != get_public_schema_name()
            and not tenant.is_active
            and request.path.startswith("/api/")
        ):
            return JsonResponse(SUSPENDED, status=403)
        return self.get_response(request)
