from django.http import JsonResponse

NO_TENANT = {"detail": "There is no agency at this address.", "code": "no_tenant"}
SUSPENDED = {"detail": "This agency is not available at the moment.", "code": "tenant_suspended"}


def no_tenant(request, *args, **kwargs):
    """For unknown hosts, and for agency API paths on the root host."""
    return JsonResponse(NO_TENANT, status=404)


def suspended_body(tenant):
    """The tenant_suspended response; a suspension for non-payment says whom to contact."""
    if tenant.suspension_reason == tenant.SuspensionReason.NON_PAYMENT:
        from .models import PlatformSettings

        contact = PlatformSettings.get().billing_contact_email
        detail = "This agency's account is suspended for non-payment." + (f" Contact {contact}." if contact else "")
        return {"detail": detail, "code": "tenant_suspended"}
    return SUSPENDED
