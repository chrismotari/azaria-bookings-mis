from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from core.emails import EMAIL_TASK_OPTIONS, send_email
from core.tenancy import frontend_url, tenant_task

from .models import User


def set_password_url(user):
    """The reset screen's link for this user (email 10 format), also used to set a first password (email 11)."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{frontend_url()}/reset-password?uid={uid}&token={token}"


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
    """Email 11: a welcome for a customer the admin created, with a link to choose their password."""
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return
    send_email(
        "account_created",
        "Your Azaria Bookings account is ready",
        user.email,
        {"user": user, "set_password_url": set_password_url(user)},
    )
