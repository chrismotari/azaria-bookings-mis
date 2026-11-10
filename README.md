# Azaria Bookings

A flight-offers and booking portal for a Nairobi travel agency ([azariabookings.com](https://azariabookings.com)).

The agency owner (the **admin**) lists flight deals. Anyone can browse them. Registered **customers** can ask for options when nothing fits and can book a deal. The admin then confirms availability, the customer pays outside the system, the admin marks the booking paid, uploads the boarding passes and sends them. The customer receives them by email and can also download them in the app.

The full specification is in [SPEC.md](SPEC.md). Choices made where the spec is silent are listed in [DECISIONS.md](DECISIONS.md).

## Tech stack

| Area | Technology |
| --- | --- |
| API | Python 3.12+, Django 6.1, Django REST Framework 3.18, Simple JWT (access 30 min, refresh 7 days), django-filter, django-cors-headers, django-environ |
| Database | PostgreSQL (development, tests and production; no SQLite) |
| Background jobs | Celery 5.6 with Redis as broker and result backend; Celery beat for scheduled tasks |
| Email | Plain-text templates sent with Django's `EmailMessage`: console output in development, SMTP when `EMAIL_HOST` is set |
| File storage | Private file-system storage (`backend/private_media/`) for boarding passes; never served by URL, only through an authenticated download endpoint |
| Backend tests | pytest, pytest-django, freezegun |
| App | Expo 58 (React Native 0.88, React 19) with react-native-web, TypeScript 6 |
| App libraries | React Navigation 7 (every screen has a browser URL), TanStack Query 5, axios, react-hook-form + zod, expo-secure-store (native token storage) |

The app is **web first**: it is developed and checked in the browser. It still compiles for iOS and Android, but native behaviour isn't tested yet, and file upload and download are web only.

## Project layout

```
backend/                 Django project "config"
  tenants/               Agencies (tenants) and their domains, create_agency, the platform's Django admin
  airports/              Airports (seed_airports), shared by every agency
  airlines/              Airlines (seed_airlines) and their logos, shared by every agency
  accounts/              Custom user (login by email, role customer/admin), auth endpoints, create_admin
  catalog/               Flight offers and their stops
  customer_requests/     Customer requests for options and the admin's responses (app label "requests")
  bookings/              Bookings, the status state machine (services.py), boarding passes, scheduled tasks
  core/                  App settings, permissions, private storage, email templates
  data/raw/              OurAirports CSV files (seed_airports) and OpenFlights airlines.dat (seed_airlines)
frontend/                Expo app
  src/api/               axios client (token refresh), token storage, API types
  src/auth/              Auth context and the login gate
  src/navigation/        Navigators and URL linking
  src/screens/           Explore, requests, bookings, account, auth and admin screens
  src/components/        Shared UI (fields, cards, status chips, file field, timeline)
```

## Prerequisites

- Python 3.12 or newer
- Node.js 20 or newer
- PostgreSQL, running locally
- Redis, running locally

There is no Docker setup. PostgreSQL and Redis run directly on your machine.

## First-time setup

### 1. Database

Create a PostgreSQL user and database. The user needs `CREATEDB` so pytest can create its test database:

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
python manage.py migrate_schemas --shared      # the platform (public schema)
python manage.py seed_airports                 # shared airports, once
python manage.py seed_airlines                 # shared airlines, once
python manage.py createsuperuser               # the system owner, for /django-admin/ on the root host
python manage.py create_agency --schema azaria --name "Azaria Bookings" \
    --admin-email owner@example.com --admin-password '<strong password>' --admin-name "Agency Owner"
```

`create_agency` creates the agency's schema (and migrates it), its domain `azaria.localhost`, its settings and its first admin. Create as many agencies as you like the same way; each one gets `<schema>.localhost`.

#### Resetting the database after the airline change

The migrations were regenerated from scratch when offers started pointing at the shared airline list (and earlier, when agencies got their own schemas and for UUID primary keys). A database created before that cannot be migrated forward, so drop it and start again (this deletes all local data):

```bash
sudo -u postgres psql -c "DROP DATABASE azaria;"
sudo -u postgres psql -c "CREATE DATABASE azaria OWNER azaria;"
python manage.py migrate_schemas --shared
python manage.py seed_airports
python manage.py seed_airlines
python manage.py createsuperuser
python manage.py create_agency --schema azaria --name "Azaria Bookings" \
    --admin-email owner@example.com --admin-password '<strong password>' --admin-name "Agency Owner"
```

Uploaded boarding passes in `backend/private_media/` and airline logos in `backend/media/` belong to the old records and can be deleted too.

The settings in `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY`, `DEBUG` | Standard Django settings |
| `ALLOWED_HOSTS` | Include the base domain and its subdomains, e.g. `localhost,.localhost` |
| `TENANT_BASE_DOMAIN` | The root host, which is the platform itself (`localhost` in development). Agencies are reached at `<schema>.<this>` |
| `DATABASE_URL` | e.g. `postgres://azaria:password@localhost:5432/azaria` |
| `REDIS_URL` | e.g. `redis://localhost:6379/0` (Celery broker and results) |
| `NUM_PROXIES` | Trusted proxies in front of the API, so the per-IP throttles see the real client (default `0`: no proxy; set `1` behind one reverse proxy) |
| `CORS_ALLOWED_ORIGIN_REGEXES` | The web app's origins on every agency's host, e.g. `^http://([a-z0-9-]+\.)?localhost:8081$` |
| `FRONTEND_URL` | The web app's base URL for links in emails, with `{domain}` for the agency's primary domain: `http://{domain}:8081` |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | SMTP. Leave `EMAIL_HOST` empty to print emails in the worker's console |
| `DEFAULT_FROM_EMAIL` | Sender address |
| `ADMIN_EMAIL` | Default admin notification email for a new schema; `create_agency` replaces it with the first admin's email, and it can be changed in the app's Settings |

About the management commands:

- **`seed_airports`** loads airports from `data/raw/airports.csv` and `countries.csv` into the shared (public) schema. It keeps airports that have an IATA code and scheduled service, and skips closed ones. Running it again updates rows in place, so it is safe to repeat.
- **`seed_airlines`** adds airlines from `data/raw/airlines.dat` to the shared (public) schema: active airlines with a two-character IATA code, one per code. It only adds airlines that are missing and never changes existing ones, so corrections made in the platform admin survive a re-run. The data is old (largely 2014 to 2017), so treat it as a starting point and curate the list in the platform admin.
- **`create_agency`** adds an agency: see above. The address (`--schema`) is 3 to 30 lowercase letters, digits and hyphens; `public`, `www`, `api`, `admin` and `app-admin` are reserved. If any part fails, nothing is left behind.
- **`create_admin`** adds another admin to an agency: `python manage.py tenant_command create_admin --schema=azaria --email ... --password ... --name ...`.
- **The platform app** on the root host (http://localhost:8081) is where the system owner manages agencies: sign in with a public-schema superuser (`createsuperuser`), then list, search, add, rename, suspend and reactivate agencies and manage their domains. It is web only and has no registration or password reset (use `createsuperuser` and `changepassword`). `EXPO_PUBLIC_PLATFORM_HOST` in `frontend/.env` names the root host.
- **Billing** (platform app: Plans, Invoices, Settings, and Plan & billing in an agency's drawer): agencies pay the platform outside the system. The owner creates plans (subscription or support, monthly and/or annual prices in `PLATFORM_CURRENCY`), starts an agency's plan (its first invoice is issued and emailed at once), and marks invoices paid by hand. Invoices are issued automatically before each period, due after the set number of days, and an agency with an invoice more than a month past due is suspended until it is paid or the owner reactivates it. Agency admins see their plans and invoices under Settings → Billing, with a warning banner while an invoice is overdue. Invoice PDFs are stored in `private_media/invoices/<schema>/`.
- **`/django-admin/`** on the root host (http://localhost:8000/django-admin/) is the platform admin for the system owner: list, add, rename, suspend and reactivate agencies and manage their domains, and curate the shared airline list (add, edit, deactivate, and upload each airline's logo: PNG, JPEG or WebP, up to 200 KB). It is open to superusers of the public schema (`createsuperuser`).
- **`/django-admin/`** on an agency's host is technical support for that agency's data, open to that agency's superusers (`python manage.py tenant_command createsuperuser --schema=azaria`). Both are separate from the in-app admin.

### 3. Web app

```bash
cd frontend
npm install
cp .env.example .env               # EXPO_PUBLIC_API_URL=http://{host}:8000/api, EXPO_PUBLIC_PLATFORM_HOST=localhost
```

### Files and media

- `backend/private_media/` holds boarding passes. It is never served by URL; files are only reachable through the authenticated download endpoint.
- `backend/media/` holds airline logos, served at `/media/`. Django serves it while `DEBUG` is true; in production, have the reverse proxy serve that folder at `/media/` on every agency's host.
- `frontend/public/flags/` holds the country flags, served by the web app at `/flags/<code>.svg`. On iOS and Android the same files are bundled into the app (react-native-svg, with react-native-svg-transformer in `metro.config.js`).

## Running

Run each of these in its own terminal. Activate the backend virtualenv in the three backend terminals first (`source .venv/bin/activate`).

| Process | Command |
| --- | --- |
| API | `cd backend && python manage.py runserver` |
| Celery worker (emails and scheduled tasks) | `cd backend && celery -A config worker -l info` (on Windows add `--pool=solo`) |
| Celery beat (schedule) | `cd backend && celery -A config beat -l info` |
| Web app | `cd frontend && npx expo start --web` |

Each agency has its own address: Azaria's web app is http://azaria.localhost:8081 and its API http://azaria.localhost:8000/api. `{host}` in `EXPO_PUBLIC_API_URL` is replaced by the page's hostname, so the app always talks to its own agency. Chrome and Firefox resolve `*.localhost` to this machine with no setup. To open the app from another device, add a domain such as `azaria.192.168.1.37.nip.io` to the agency in the platform admin, add `.nip.io` hosts to `ALLOWED_HOSTS` and the CORS regexes, and run the API with `runserver 0.0.0.0:8000`.

The root host (http://localhost:8081) belongs to no agency: the app shows "There is no agency at this address."

Before the admin can confirm any booking, they must add **payment instructions** under **Settings** in the app.

Celery beat runs these scheduled tasks, each in every active agency in turn:

| Task | Every | What it does |
| --- | --- | --- |
| `expire_unpaid_bookings` | 5 minutes | Expires confirmed bookings whose payment deadline has passed |
| `send_payment_reminders` | 15 minutes | Emails one reminder when a confirmed booking is within the reminder window of its deadline |
| `expire_stale_requests` | hour | Expires requested bookings whose flight has already departed |

And two for the platform's billing (public schema):

| Task | Every | What it does |
| --- | --- | --- |
| `issue_due_invoices` | day | Issues the next invoice of each running plan whose period starts within the lead days, and emails it with its PDF |
| `suspend_overdue_tenants` | day | Suspends agencies with an unpaid invoice more than a month past its due date, and emails them |

## How it works

**Agencies (multitenancy).** One installation serves many travel agencies. Each agency is a tenant with its own PostgreSQL schema (django-tenants), chosen from the request's hostname, so its users, offers, requests, bookings, boarding passes and settings are separate. The public schema is the platform ("app_admin"): agencies, their domains, the shared airports and the system owner's accounts.
- The same email can have separate accounts at different agencies. Tokens carry the agency and are refused at any other; reset links point at the agency's own domain.
- A suspended agency's API returns 403 (`tenant_suspended`), and its scheduled tasks and emails are skipped. Agencies are never deleted.
- Celery tasks take the agency's schema name as their first argument and run in that schema.

**Who can do what**
- **Guests** can browse deals, view a deal and search airports.
- **Customers** can also request options, book, cancel their own bookings and download their boarding passes once they are sent.
- **The admin** manages deals, answers requests, moves bookings through their statuses, uploads and sends boarding passes, manages customers (add, edit, deactivate and reactivate), books flights for customers (for example one who phoned; the customer is emailed as usual once availability is confirmed) and edits settings. A customer the admin adds is emailed a link to choose their password; a deactivated customer cannot sign in, but their requests and bookings stay.

**Booking lifecycle.** Every status change goes through `bookings/services.py`. The service locks the booking, checks that the move is allowed and that the right person is making it, records the change on the booking's timeline, and queues the matching email. Moves that aren't allowed return HTTP 409.

```
requested ──admin──▶ availability_confirmed ──admin──▶ paid ──admin──▶ completed
    │                        │                                (send boarding passes)
    ├─▶ unavailable (admin)  ├─▶ unavailable (admin)
    ├─▶ cancelled (customer) ├─▶ cancelled (customer)
    └─▶ expired (system)     └─▶ expired (system, payment deadline passed)
```

**Confirming availability** sets a payment deadline of now plus the payment hold hours. The customer is emailed the payment instructions and the deadline in Nairobi time.

**Boarding passes**:
- The admin uploads them only while a booking is paid.
- Each file must be a PDF, PNG or JPEG of at most 5 MB, with at most 10 per booking.
- "Send boarding passes" completes the booking and emails every file to the customer.
- Customers can see and download their passes only after that.

All times are Africa/Nairobi. Prices are in USD (`CURRENCY` setting).

## API overview

Everything is under `/api/` on an agency's host. Authenticate with `Authorization: Bearer <access token>`. On the root host, or an unknown host, `/api/` returns 404 with `"code": "no_tenant"`.

| Area | Endpoints |
| --- | --- |
| Auth (public) | `POST auth/register`, `auth/login`, `auth/refresh`, `auth/password-reset`, `auth/password-reset-confirm`; `GET auth/me` |
| Browse (public) | `GET airports?search=`, `GET offers` (filters: origin, destination, date range, price range, class, max stopovers; ordering), `GET offers/{id}` |
| Customer | `queries` (list, create, detail, `close`), `bookings` (list, create, detail, `cancel`), `GET boarding-passes/{id}/download` |
| Admin billing | `GET admin/billing` (plans, billing contact, overdue notice), `GET admin/billing/invoices`, `GET admin/billing/invoices/{id}/pdf` |
| Admin | `admin/dashboard`, `admin/offers`, `admin/queries` (+ `respond`), `admin/bookings` (list, `POST` to book for a customer, + `confirm-availability`, `mark-unavailable`, `mark-paid`, `complete`, `boarding-passes` upload), `DELETE admin/boarding-passes/{id}`, `admin/settings`, `admin/users` (list with `search` and `is_active`, create, detail, edit; customers only) |

On the root host, `/api/platform/` is the system owner's API: `login`, `refresh`, `me`, `tenants` (+ `domains`, `subscriptions`), `plans`, `subscriptions/{id}` (+ `end`, `issue-invoice`), `invoices` (+ `mark-paid`, `mark-unpaid`, `void`, `resend`, `pdf`) and `settings`.

Errors use DRF's standard format.

## Tests and checks

```bash
cd backend && pytest                                 # backend test suite (needs PostgreSQL)
cd frontend && npx tsc --noEmit                      # type-check the app
cd frontend && npx expo export --platform web        # production web build
```

The backend tests create two agencies for the session (`test`, reached at the test client's default host, and `other.localhost`) and run every test in the first. They use an in-memory email outbox, run Celery tasks eagerly and write uploaded files to a temporary directory, so the worker and Redis don't need to be running. PostgreSQL does.

## Data and credits

- Airports: [OurAirports](https://ourairports.com/data/) (public domain).
- Airlines: [OpenFlights](https://openflights.org/data) airline data, under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
- Country flags: [flag-icons](https://github.com/lipis/flag-icons) by Panayiotis Lipiridis, MIT licence (kept in `frontend/public/flags/LICENSE`).
- Airline logos are not bundled; the system owner uploads them.

## Decisions

Every choice made where the spec was ambiguous is recorded, one line each, in [DECISIONS.md](DECISIONS.md).
