from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from core.emails import EMAIL_TASK_OPTIONS, send_email
from core.tenancy import agency_code, current_tenant, frontend_url, tenant_task

from .models import User


def set_password_url(user):
    """The password reset screen's link for this user, also used to choose a first password."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{frontend_url()}/reset-password?uid={uid}&token={token}"


def get_app_context():
    """The "Get the app" lines: the agency's /app page and the code to type in the app."""
    tenant = current_tenant()
    return {
        "agency_name": tenant.name,
        "agency_code": agency_code(tenant.schema_name),
        "app_url": f"{frontend_url()}/app",
    }


@tenant_task(**EMAIL_TASK_OPTIONS)
def send_password_reset_email(user_id):
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return
    send_email(
        "password_reset",
        "Reset your Azaria Bookings password",
        user.email,
        {"user": user, "reset_url": set_password_url(user)},
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def send_account_created_email(user_id):
    """Welcomes a customer the admin created, with a link to choose their password."""
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return
    send_email(
        "account_created",
        "Your Azaria Bookings account is ready",
        user.email,
        {"user": user, "set_password_url": set_password_url(user), **get_app_context()},
    )


@tenant_task(**EMAIL_TASK_OPTIONS)
def send_welcome_email(user_id):
    """Welcomes a customer who registered, with the agency's site and the app."""
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return
    context = get_app_context()
    send_email("welcome", f"Welcome to {context['agency_name']}", user.email, {"user": user, **context})
