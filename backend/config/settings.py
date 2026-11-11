from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])
# The web app's base URL with a {domain} placeholder for the agency's app address (<code>.<TENANT_BASE_DOMAIN>).
FRONTEND_URL = env("FRONTEND_URL").rstrip("/")


# Multitenancy (django-tenants): the public schema is the platform, each agency has its own schema.
TENANT_BASE_DOMAIN = env("TENANT_BASE_DOMAIN")
TENANT_MODEL = "tenants.Tenant"
TENANT_DOMAIN_MODEL = "tenants.Domain"
PUBLIC_SCHEMA_URLCONF = "config.urls_public"
DEFAULT_NOT_FOUND_TENANT_VIEW = "tenants.views.no_tenant"

# The mobile app, for the link verification files under /.well-known/ (each file answers 404 while unset).
# IOS_APP_ID: Apple Team ID and bundle id, e.g. ABCDE12345.com.azariabookings.app.
IOS_APP_ID = env("IOS_APP_ID", default="")
ANDROID_PACKAGE = env("ANDROID_PACKAGE", default="")
# SHA-256 fingerprints of the Android signing certificates (comma-separated, e.g. 14:6D:E9:...).
ANDROID_CERT_FINGERPRINTS = env.list("ANDROID_CERT_FINGERPRINTS", default=[])
DATABASE_ROUTERS = ["django_tenants.routers.TenantSyncRouter"]

DJANGO_APPS = [
    "config.apps.SuperuserAdminConfig",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

# The public schema: tenants, the shared airports, and the system owner's accounts.
SHARED_APPS = [
    "django_tenants",
    "tenants",
    "airports",
    "airlines",
    "rates",
    *DJANGO_APPS,
    "rest_framework",
    "django_filters",
    "corsheaders",
    "accounts",
    # The platform's support desk; each agency's desk is in TENANT_APPS.
    "support",
]

# Each agency's schema.
TENANT_APPS = [
    *DJANGO_APPS,
    "accounts",
    "catalog",
    "customer_requests.apps.RequestsConfig",
    "bookings",
    "core",
    "support",
    "integrations",
]

INSTALLED_APPS = [*SHARED_APPS, *[app for app in TENANT_APPS if app not in SHARED_APPS]]

MIDDLEWARE = [
    # First, so that the no-tenant and suspended responses also carry CORS headers.
    "corsheaders.middleware.CorsMiddleware",
    "django_tenants.middleware.main.TenantMainMiddleware",
    "tenants.middleware.SuspendedTenantMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
    {
        # Plain-text emails: no HTML autoescaping.
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "NAME": "emails",
        "DIRS": [BASE_DIR / "core" / "templates"],
        "OPTIONS": {"autoescape": False},
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {"default": {**env.db_url("DATABASE_URL"), "ENGINE": "django_tenants.postgresql_backend"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Nairobi"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

# Boarding passes live here. Never served by URL; see core.storage.
PRIVATE_MEDIA_ROOT = BASE_DIR / "private_media"

# Public files (airline logos): served under MEDIA_URL by Django when DEBUG, by the reverse proxy in production.
PUBLIC_MEDIA_ROOT = BASE_DIR / "media"
MEDIA_URL = "/media/"

CURRENCY = "USD"
# What agencies pay the platform in: every plan and invoice.
PLATFORM_CURRENCY = env("PLATFORM_CURRENCY", default="USD")

# Encrypts fare providers' credentials at rest (a Fernet key).
INTEGRATIONS_KEY = env("INTEGRATIONS_KEY")
# The daily exchange-rate feed: USD-based rates in ExchangeRate-API's open-access format.
EXCHANGE_RATES_URL = env("EXCHANGE_RATES_URL", default="https://open.er-api.com/v6/latest/USD")


# Email: console in development unless EMAIL_HOST is set; tests use locmem.
email_host = env("EMAIL_HOST", default="")
if email_host:
    MAILERS = {
        "default": {
            "BACKEND": "django.core.mail.backends.smtp.EmailBackend",
            "OPTIONS": {
                "host": email_host,
                "port": env.int("EMAIL_PORT", default=587),
                "username": env("EMAIL_HOST_USER", default=""),
                "password": env("EMAIL_HOST_PASSWORD", default=""),
                "use_tls": env.bool("EMAIL_USE_TLS", default=True),
            },
        },
    }
else:
    MAILERS = {"default": {"BACKEND": "django.core.mail.backends.console.EmailBackend"}}
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL")
ADMIN_EMAIL = env("ADMIN_EMAIL")


# Every tenant's web app origin, e.g. ^http://([a-z0-9-]+\.)?localhost:8081$
CORS_ALLOWED_ORIGIN_REGEXES = env.list("CORS_ALLOWED_ORIGIN_REGEXES", default=[])


REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.tokens.TenantJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    # How many trusted proxies sit in front of the API; with 0 the client IP is REMOTE_ADDR and a forged
    # X-Forwarded-For cannot dodge the per-IP throttles.
    "NUM_PROXIES": env.int("NUM_PROXIES", default=0),
    "DEFAULT_THROTTLE_RATES": {
        "register": "10/min",
        "login": "10/min",
        "password_reset": "10/min",
        # New chats from guests (signed-in requesters are not throttled).
        "support_guest": "10/hour",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
}


REDIS_URL = env("REDIS_URL")
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULE = {
    "expire-unpaid-bookings": {
        "task": "bookings.tasks.expire_unpaid_bookings",
        "schedule": timedelta(minutes=5),
    },
    "send-payment-reminders": {
        "task": "bookings.tasks.send_payment_reminders",
        "schedule": timedelta(minutes=15),
    },
    "expire-stale-requests": {
        "task": "bookings.tasks.expire_stale_requests",
        "schedule": timedelta(hours=1),
    },
    "close-idle-chats": {
        "task": "support.tasks.close_idle_chats",
        "schedule": timedelta(hours=1),
    },
    # The platform's billing (public schema), once a day.
    "issue-due-invoices": {
        "task": "tenants.tasks.issue_due_invoices",
        "schedule": timedelta(days=1),
    },
    "suspend-overdue-tenants": {
        "task": "tenants.tasks.suspend_overdue_tenants",
        "schedule": timedelta(days=1),
    },
    "fetch-exchange-rates": {
        "task": "rates.tasks.fetch_exchange_rates",
        "schedule": timedelta(days=1),
    },
    "delete-old-fares": {
        "task": "integrations.tasks.delete_old_fares",
        "schedule": timedelta(days=1),
    },
    "run-due-route-searches": {
        "task": "integrations.tasks.run_due_route_searches",
        "schedule": timedelta(hours=1),
    },
}
