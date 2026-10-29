from celery import shared_task
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from core.emails import EMAIL_TASK_OPTIONS, send_email

from .models import User


@shared_task(**EMAIL_TASK_OPTIONS)
def send_password_reset_email(user_id):
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    send_email(
        "password_reset",
        "Reset your Azaria Bookings password",
        user.email,
        {"user": user, "reset_url": f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"},
    )
