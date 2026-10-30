from django.db import transaction

from catalog.models import Offer
from core.exceptions import Conflict

from .models import Query, QueryResponse
from .tasks import notify_customer_query_responded


def respond_to_query(query_id, message, offers, new_offers):
    """Attach existing and newly created (non-public) offers to a new response, in one transaction."""
    with transaction.atomic():
        query = Query.objects.select_for_update().get(pk=query_id)
        if query.status == Query.Status.CLOSED:
            raise Conflict("This request has been closed by the customer.")
        created = [Offer.objects.create(**{**data, "is_public": False}) for data in new_offers]
        response = QueryResponse.objects.create(query=query, message=message)
        response.offers.set([*offers, *created])
        query.status = Query.Status.RESPONDED
        query.save(update_fields=["status"])
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
