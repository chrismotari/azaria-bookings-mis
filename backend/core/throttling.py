from rest_framework.throttling import ScopedRateThrottle


class IPScopedRateThrottle(ScopedRateThrottle):
    """Scoped throttle keyed by client IP, whether or not the user is authenticated."""

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
