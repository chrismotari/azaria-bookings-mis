from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template import engines
from django.utils import timezone

# Brand colours for the HTML emails (the app's theme.ts), passed to every template as `brand`.
BRAND = {
    "primary": "#1800d2",
    "primary_text": "#ffffff",
    "accent": "#ffb400",
    "accent_text": "#252525",
    "text": "#252525",
    "muted": "#6c7171",
    "border": "#dde2e5",
    "background": "#f2f4f7",
    "surface": "#ffffff",
    "highlight": "#ebe8fd",
}

# Options shared by every email task.
EMAIL_TASK_OPTIONS = {
    "autoretry_for": (Exception,),
    "retry_backoff": True,
    "max_retries": 5,
}


def send_email(template, subject, to, context, attachments=()):
    """Render core/templates/emails/<template>.txt and .html and send them as text plus an HTML alternative.

    attachments: (filename, content, mimetype) tuples.
    """
    context = {**context, "frontend_url": settings.FRONTEND_URL, "brand": BRAND}
    body = engines["emails"].get_template(f"emails/{template}.txt").render(context)
    html = engines["django"].get_template(f"emails/{template}.html").render(context)
    message = EmailMultiAlternatives(subject=subject, body=body, to=[to])
    message.attach_alternative(html, "text/html")
    for attachment in attachments:
        message.attach(*attachment)
    message.send()
    return message


def format_price(amount):
    return f"{settings.CURRENCY} {amount:,.2f}"


def format_date(value):
    return f"{value:%a}, {value.day} {value:%b %Y}"


def format_duration(minutes):
    """e.g. "2 h 15 min", "45 min", "26 h"."""
    hours, minutes = divmod(minutes, 60)
    return " ".join(part for part in (f"{hours} h" if hours else "", f"{minutes} min" if minutes else "") if part)


def format_stops(stops):
    """e.g. "Direct" or "Dubai (DXB), 2 h 15 min layover; Istanbul (IST), 26 h stopover"."""
    return "; ".join(
        f"{stop.airport.city} ({stop.airport.code}), {format_duration(stop.duration_minutes)} {stop.kind}"
        for stop in stops
    ) or "Direct"


def format_datetime(value):
    """A timestamp in Nairobi time (the project's TIME_ZONE)."""
    local = timezone.localtime(value)
    return f"{format_date(local)} at {local:%H:%M} (Nairobi time)"
