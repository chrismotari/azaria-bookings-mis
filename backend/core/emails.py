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

EMAIL_TASK_OPTIONS = {
    "autoretry_for": (Exception,),
    "retry_backoff": True,
    "max_retries": 5,
}


def send_email(template, subject, to, context, attachments=()):
    """Render core/templates/emails/<template>.txt and .html and send them as text plus an HTML alternative.

    attachments: (filename, content, mimetype) tuples.
    """
    from core.tenancy import frontend_url

    context = {**context, "frontend_url": frontend_url(), "brand": BRAND}
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


def _place(airport):
    return f"{airport.city} ({airport.code})"


def format_direction(flights):
    """One direction's segment dicts as lines: each flight, with its connection between them; "" without flights.

    e.g. "Fri, 10 Apr 2026 · KQ 310 · 23:50 Nairobi (NBO) → 05:40 +1 Dubai (DXB)", then
    "2 h 15 min layover in Dubai (DXB)". Times are local to each airport.
    """
    from catalog.itinerary import connections

    lines = []
    waits = connections(flights)
    for index, flight in enumerate(flights):
        number = f"{flight['airline'].iata_code} {flight['flight_number']}"
        if flight["operating_airline"] is not None:
            number += f" (operated by {flight['operating_airline'].name})"
        days = (flight["arrival_date"] - flight["departure_date"]).days
        arrival = f"{flight['arrival_time']:%H:%M}" + (f" {days:+d}" if days else "")
        lines.append(
            f"{format_date(flight['departure_date'])} · {number} · "
            f"{flight['departure_time']:%H:%M} {_place(flight['origin'])} → {arrival} {_place(flight['destination'])}"
        )
        if index < len(waits):
            wait = waits[index]
            lines.append(f"{format_duration(wait['wait_minutes'])} {wait['kind']} in {_place(wait['airport'])}")
    return "\n".join(lines)


def format_baggage(trip):
    """Per passenger, e.g. "1 × 23 kg checked, 7 kg cabin", "2 checked bags" or "Cabin bag only (7 kg)"."""
    if not trip.checked_bags:
        return "Cabin bag only" + (f" ({trip.cabin_bag_kg} kg)" if trip.cabin_bag_kg else "")
    if trip.checked_bag_kg:
        checked = f"{trip.checked_bags} × {trip.checked_bag_kg} kg checked"
    else:
        checked = f"{trip.checked_bags} checked bag{'s' if trip.checked_bags > 1 else ''}"
    return checked + (f", {trip.cabin_bag_kg} kg cabin" if trip.cabin_bag_kg else "")


REFUNDS = {"not_allowed": "Non-refundable", "with_fee": "Refundable for a fee", "free": "Free refunds"}
CHANGES = {"not_allowed": "no changes", "with_fee": "changes for a fee", "free": "free changes"}


def format_conditions(trip):
    """e.g. "Non-refundable, changes for a fee"."""
    return f"{REFUNDS[trip.refund_policy]}, {CHANGES[trip.change_policy]}"


def format_segment_changes(lines):
    """Segments as recorded in Booking.changes, e.g. "Outbound KQ 310 NBO → DXB, Fri, 10 Apr 2026 23:50 – 05:40"."""
    return "; ".join(
        f"{line['direction'].capitalize()} {line['flight']} {line['route']}, {line['departure']} – {line['arrival']}"
        for line in lines
    )


def format_datetime(value):
    """A timestamp in Nairobi time (the project's TIME_ZONE)."""
    local = timezone.localtime(value)
    return f"{format_date(local)} at {local:%H:%M} (Nairobi time)"
