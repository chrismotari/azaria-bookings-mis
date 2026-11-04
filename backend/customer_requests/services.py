from django.db import transaction

from catalog.models import Offer
from core.exceptions import Conflict

from .models import Query, QueryResponse
from .tasks import notify_customer_query_responded


def add_response(query, message, offers, new_offers):
    """Attach existing and newly created (non-public) offers to a new response; queues no email.

    Call inside a transaction. new_offers: validated AdminOfferSerializer data.
    """
    created = []
    for data in new_offers:
        data = {**data, "is_public": False}
        stops = data.pop("stops", [])
        offer = Offer.objects.create(**data)
        offer.set_stops(stops)
        created.append(offer)
    response = QueryResponse.objects.create(query=query, message=message)
    response.offers.set([*offers, *created])
    query.status = Query.Status.RESPONDED
    query.save(update_fields=["status"])
    return response


def respond_to_query(query_id, message, offers, new_offers):
    """Respond to the customer's request and email them, in one transaction."""
    with transaction.atomic():
        query = Query.objects.select_for_update().get(pk=query_id)
        if query.status == Query.Status.CLOSED:
            raise Conflict("This request has been closed by the customer.")
        response = add_response(query, message, offers, new_offers)
        transaction.on_commit(lambda: notify_customer_query_responded.delay(response.pk))
    return query


def close_query(query_id, user):
    with transaction.atomic():
        query = Query.objects.select_for_update().get(pk=query_id, user=user)
        if query.status == Query.Status.CLOSED:
            raise Conflict("This request is already closed.")
        query.status = Query.Status.CLOSED
        query.save(update_fields=["status"])
    return query
