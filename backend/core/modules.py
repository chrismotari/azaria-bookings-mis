import functools

from django.http import JsonResponse

MODULE_OFF = {"detail": "This part of the site isn't available.", "code": "module_off"}


def requires_module(module, view):
    """The view, answering 404 module_off when the agency has the module off."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        tenant = getattr(request, "tenant", None)
        if tenant is not None and not tenant.has_module(module):
            return JsonResponse(MODULE_OFF, status=404)
        return view(request, *args, **kwargs)

    return wrapped


def module_urls(module, urlpatterns):
    """The URL patterns with every view wrapped by requires_module."""
    for pattern in urlpatterns:
        pattern.callback = requires_module(module, pattern.callback)
    return urlpatterns
