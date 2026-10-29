from django.conf import settings
from django.core.mail import EmailMessage
from django.template import engines
from django.utils import timezone

# Options shared by every email task.
EMAIL_TASK_OPTIONS = {
    "autoretry_for": (Exception,),
    "retry_backoff": True,
    "max_retries": 5,
}


def send_email(template, subject, to, context, attachments=()):
    """Render core/templates/emails/<template>.txt and send it as plain text.

    attachments: (filename, content, mimetype) tuples.
    """
    body = engines["emails"].get_template(f"emails/{template}.txt").render(
        {**context, "frontend_url": settings.FRONTEND_URL}
    )
    message = EmailMessage(subject=subject, body=body, to=[to])
    for attachment in attachments:
        message.attach(*attachment)
    message.send()
    return message


def format_price(amount):
    return f"{settings.CURRENCY} {amount:,.2f}"


def format_date(value):
    return f"{value:%a}, {value.day} {value:%b %Y}"


def format_datetime(value):
    """A timestamp in Nairobi time (the project's TIME_ZONE)."""
    local = timezone.localtime(value)
    return f"{format_date(local)} at {local:%H:%M} (Nairobi time)"
