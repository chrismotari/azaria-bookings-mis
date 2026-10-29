from django.conf import settings
from django.core.mail import EmailMessage
from django.template import engines

# Options shared by every email task.
EMAIL_TASK_OPTIONS = {
    "autoretry_for": (Exception,),
    "retry_backoff": True,
    "max_retries": 5,
}


def send_email(template, subject, to, context):
    """Render core/templates/emails/<template>.txt and send it as plain text."""
    body = engines["emails"].get_template(f"emails/{template}.txt").render(
        {**context, "frontend_url": settings.FRONTEND_URL}
    )
    message = EmailMessage(subject=subject, body=body, to=[to])
    message.send()
    return message
