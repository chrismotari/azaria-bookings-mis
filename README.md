# Azaria Bookings

A multitenant SaaS for small and medium-sized flight ticketing agencies ([azariabookings.com](https://azariabookings.com)).

Each agency gets its own site and data. Its admin lists flight deals, which anyone can browse. Registered customers request options or book. The admin confirms availability, the customer pays outside the system, and the admin marks the booking paid, then uploads and sends the boarding passes (by email and in the app). Customers and guests can write to the agency through a built-in support chat.

On the root host, the platform's owner manages agencies, plans and invoices, and answers platform support chats. Agencies pay outside the system; the owner marks invoices paid, and agencies with long-overdue invoices are suspended automatically.

The system is in active development. Payment and GDS integrations are planned, so payments are recorded by hand for now. Each agency will be able to connect the GDSs of its choice, several at once, while the system keeps working fully without any.

The full specification is in [SPEC.md](SPEC.md); choices made where it is silent are in [DECISIONS.md](DECISIONS.md).

## Stack

| Area | Technology |
| --- | --- |
| API | Python 3.12+, Django 6.1, Django REST Framework, Simple JWT, django-tenants (one PostgreSQL schema per agency) |
| Database | PostgreSQL |
| Background jobs | Celery with Redis; Celery beat for scheduled tasks |
| Email | HTML + plain text; printed to the console unless `EMAIL_HOST` is set |
| App | Expo (React Native, web first) with TypeScript, React Navigation, TanStack Query, react-hook-form + zod |
| Tests | pytest, pytest-django, freezegun; `tsc` for the app |

```
backend/      Django project "config": tenants, airports, airlines, accounts, catalog,
              customer_requests, bookings, support, core
frontend/     Expo app (src/api, auth, navigation, screens, components, support)
```

## Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL and Redis running locally (no Docker)

## Setup

### 1. Database

The user needs `CREATEDB` so pytest can create its test database.

```bash
sudo -u postgres psql -c "CREATE USER azaria WITH PASSWORD 'password' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE azaria OWNER azaria;"
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then edit .env
python manage.py migrate_schemas --shared
python manage.py seed_airports
python manage.py seed_airlines
python manage.py createsuperuser   # the platform owner
python manage.py create_agency --schema azaria --name "Azaria Bookings" \
    --admin-email owner@example.com --admin-password '<strong password>' --admin-name "Agency Owner"
```

`create_agency` creates the agency's schema, its domain `<schema>.localhost`, its settings and its first admin. Add more agencies the same way.

A database created before return trips were added must be dropped and set up again: the catalog, requests and bookings migrations were regenerated.

`backend/.env`:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY`, `DEBUG` | Standard Django settings |
| `DATABASE_URL` | e.g. `postgres://azaria:password@localhost:5432/azaria` |
| `REDIS_URL` | e.g. `redis://localhost:6379/0` |
| `TENANT_BASE_DOMAIN` | The root host (the platform); agencies live at `<schema>.<this>`. `localhost` in development |
| `ALLOWED_HOSTS` | The base domain and its subdomains, e.g. `localhost,.localhost` |
| `CORS_ALLOWED_ORIGIN_REGEXES` | The web app's origins, e.g. `^http://([a-z0-9-]+\.)?localhost:8081$` |
| `FRONTEND_URL` | Base URL for links in emails; `{domain}` is the agency's domain: `http://{domain}:8081` |
| `NUM_PROXIES` | Reverse proxies in front of the API (`0` locally), so throttling sees the real client IP |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | SMTP; leave `EMAIL_HOST` empty to print emails in the worker's console |
| `DEFAULT_FROM_EMAIL` | Sender address |
| `ADMIN_EMAIL` | Default notification email for a new agency |
| `PLATFORM_CURRENCY` | Currency of the platform's plans and invoices |

### 3. Web app

```bash
cd frontend
npm install
cp .env.example .env
```

`EXPO_PUBLIC_API_URL` (`http://{host}:8000/api`, where `{host}` becomes the page's hostname) and `EXPO_PUBLIC_PLATFORM_HOST` (`localhost`).

## Running

Run each in its own terminal, with the backend virtualenv active for the first three.

| Process | Command |
| --- | --- |
| API | `cd backend && python manage.py runserver` |
| Celery worker | `cd backend && celery -A config worker -l info` (Windows: add `--pool=solo`) |
| Celery beat | `cd backend && celery -A config beat -l info` |
| Web app | `cd frontend && npx expo start --web` |

Then open:

- **An agency:** http://azaria.localhost:8081 (sign in with the admin from `create_agency`). Add **payment instructions** under Settings before confirming any booking.
- **The platform:** http://localhost:8081, sign in at `/login` with the `createsuperuser` account.
- **Django admin** (technical support, curating airlines and their logos): http://localhost:8000/django-admin/.

Chrome and Firefox resolve `*.localhost` without setup. To reach the app from another device, add a domain such as `azaria.192.168.1.37.nip.io` to the agency, allow `.nip.io` in `ALLOWED_HOSTS` and the CORS regexes, and run `runserver 0.0.0.0:8000`.

Other management commands: `python manage.py tenant_command create_admin --schema=azaria --email … --password … --name …` adds another agency admin; `tenant_command createsuperuser --schema=azaria` creates a Django-admin user for one agency.

## Files

- `backend/private_media/`: boarding passes, invoice PDFs and chat attachments. Never served by URL; only through authenticated endpoints.
- `backend/media/`: airline logos, served at `/media/` (by Django while `DEBUG` is true; by the reverse proxy in production).

## Tests

```bash
cd backend && pytest                            # needs PostgreSQL, not Redis or the worker
cd frontend && npx tsc --noEmit
cd frontend && npx expo export --platform web   # production web build
```

## Data and credits

- Airports: [OurAirports](https://ourairports.com/data/) (public domain).
- Airlines: [OpenFlights](https://openflights.org/data) airline data, [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
- Country flags: [flag-icons](https://github.com/lipis/flag-icons), MIT licence (`frontend/public/flags/LICENSE`).
