from celery import shared_task

from core.emails import EMAIL_TASK_OPTIONS, format_date, format_price, send_email
from core.models import AppSettings

from .models import Query, QueryResponse


def _airport(airport):
    return f"{airport.city} ({airport.code})" if airport else "Anywhere"


def describe_query(query):
    """Plain-text lines for the customer's search criteria."""
    if query.date_to:
        dates = f"{format_date(query.date_from)} to {format_date(query.date_to)}"
    else:
        dates = f"From {format_date(query.date_from)}"
    if query.price_min is not None and query.price_max is not None:
        prices = f"{format_price(query.price_min)} to {format_price(query.price_max)}"
    elif query.price_min is not None:
        prices = f"From {format_price(query.price_min)}"
    elif query.price_max is not None:
        prices = f"Up to {format_price(query.price_max)}"
    else:
        prices = "Any"
    return {
        "route": f"{_airport(query.origin)} → {_airport(query.destination)}",
        "dates": dates,
        "prices": prices,
        "ticket_class": query.get_ticket_class_display() if query.ticket_class else "Any",
        "max_stopovers": "Any" if query.max_stopovers is None else str(query.max_stopovers),
    }


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_admin_new_query(query_id):
    query = Query.objects.select_related("user", "origin", "destination").filter(pk=query_id).first()
    if query is None or query.status != Query.Status.OPEN:
        return
    details = describe_query(query)
    send_email(
        "new_query",
        f"New request from {query.user.full_name}: {details['route']}",
        AppSettings.get().admin_notification_email,
        {"query": query, **details},
    )


@shared_task(**EMAIL_TASK_OPTIONS)
def notify_customer_query_responded(query_response_id):
    response = (
        QueryResponse.objects.select_related("query__user", "query__origin", "query__destination")
        .filter(pk=query_response_id)
        .first()
    )
    if response is None or response.query.status != Query.Status.RESPONDED:
        return
    query = response.query
    send_email(
        "query_responded",
        "We have flight options for your request",
        query.user.email,
        {
            "query": query,
            "response": response,
            "option_count": response.offers.count(),
            **describe_query(query),
        },
    )
