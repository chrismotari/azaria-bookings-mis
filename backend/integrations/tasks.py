import logging

from celery import shared_task

from core.tenancy import for_each_tenant, tenant_task

from . import services
from .models import SearchRun

logger = logging.getLogger(__name__)


@tenant_task()
def run_search(run_id):
    """Runs a queued search run; a run already started or finished is left alone."""
    run = SearchRun.objects.select_related("route__origin", "route__destination").filter(pk=run_id).first()
    if run is None or run.status != SearchRun.Status.QUEUED:
        return None
    run = services.execute_run(run)
    logger.info("Search run %s: %d search(es), %d fare(s).", run.pk, run.searches_made, run.fares_found)
    return run.fares_found


@shared_task
def delete_old_fares():
    """Daily, in every active agency: fares older than 30 days, except published ones."""
    return for_each_tenant(services.delete_old_fares, "delete_old_fares")
