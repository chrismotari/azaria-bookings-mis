from django.http import JsonResponse

NO_TENANT = {"detail": "There is no agency at this address.", "code": "no_tenant"}
SUSPENDED = {"detail": "This agency is not available at the moment.", "code": "tenant_suspended"}


def no_tenant(request, *args, **kwargs):
    """For unknown hosts, and for /api/ on the root host (the platform has no API)."""
    return JsonResponse(NO_TENANT, status=404)
