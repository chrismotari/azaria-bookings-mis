# Azaria Bookings

A flight-offerings and booking portal for a Nairobi travel agency ([azariabookings.com](https://azariabookings.com)).

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
  accounts/              Custom user (login by email, role customer/admin), auth endpoints, create_admin
  catalog/               Airports (seed_airports) and flight offerings
  customer_requests/     Customer requests for options and the admin's responses (app label "requests")
  bookings/              Bookings, the status state machine (services.py), boarding passes, scheduled tasks
  core/                  App settings, permissions, private storage, email templates
  data/raw/              OurAirports CSV files used by seed_airports
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
python manage.py migrate
python manage.py seed_airports
python manage.py create_admin --email owner@example.com --password '<strong password>' --name "Agency Owner"
```

The settings in `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS` | Standard Django settings |
| `DATABASE_URL` | e.g. `postgres://azaria:password@localhost:5432/azaria` |
| `REDIS_URL` | e.g. `redis://localhost:6379/0` (Celery broker and results) |
| `CORS_ALLOWED_ORIGINS` | The web app's origin, e.g. `http://localhost:8081` |
| `FRONTEND_URL` | The web app's base URL, used for links in emails (password reset, bookings) |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | SMTP. Leave `EMAIL_HOST` empty to print emails in the worker's console |
| `DEFAULT_FROM_EMAIL` | Sender address |
| `ADMIN_EMAIL` | Seeds the admin notification email on the first `migrate`; change it later in the app's Settings |

About the two management commands:

- **`seed_airports`** loads airports from `data/raw/airports.csv` and `countries.csv`. It keeps airports that have an IATA code and scheduled service, and skips closed ones. Running it again updates rows in place, so it is safe to repeat.
- **`create_admin`** creates the agency owner's account (role `admin`). It refuses an email that already exists.
- **`/django-admin/`**, Django's built-in admin site, is for technical support only and is open to superusers. Create one with `python manage.py createsuperuser`. It is separate from the in-app admin.

### 3. Web app

```bash
cd frontend
npm install
cp .env.example .env               # EXPO_PUBLIC_API_URL=http://localhost:8000/api
```

## Running

Run each of these in its own terminal. Activate the backend virtualenv in the three backend terminals first (`source .venv/bin/activate`).

| Process | Command |
| --- | --- |
| API | `cd backend && python manage.py runserver` |
| Celery worker (emails and scheduled tasks) | `cd backend && celery -A config worker -l info` (on Windows add `--pool=solo`) |
| Celery beat (schedule) | `cd backend && celery -A config beat -l info` |
| Web app | `cd frontend && npx expo start --web` |

The web app runs at http://localhost:8081 and the API at http://localhost:8000/api.

Before the admin can confirm any booking, they must add **payment instructions** under **Settings** in the app.

Celery beat runs these scheduled tasks:

| Task | Every | What it does |
| --- | --- | --- |
| `expire_unpaid_bookings` | 5 minutes | Expires confirmed bookings whose payment deadline has passed |
| `send_payment_reminders` | 15 minutes | Emails one reminder when a confirmed booking is within the reminder window of its deadline |
| `expire_stale_requests` | hour | Expires requested bookings whose flight has already departed |

## How it works

**Who can do what**
- **Guests** can browse deals, view a deal and search airports.
- **Customers** can also request options, book, cancel their own bookings and download their boarding passes once they are sent.
- **The admin** manages deals, answers requests, moves bookings through their statuses, uploads and sends boarding passes, and edits settings.

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

Everything is under `/api/`. Authenticate with `Authorization: Bearer <access token>`.

| Area | Endpoints |
| --- | --- |
| Auth (public) | `POST auth/register`, `auth/login`, `auth/refresh`, `auth/password-reset`, `auth/password-reset-confirm`; `GET auth/me` |
| Browse (public) | `GET airports?search=`, `GET offerings` (filters: origin, destination, date range, price range, class, max stopovers; ordering), `GET offerings/{id}` |
| Customer | `queries` (list, create, detail, `close`), `bookings` (list, create, detail, `cancel`), `GET boarding-passes/{id}/download` |
| Admin | `admin/dashboard`, `admin/offerings`, `admin/queries` (+ `respond`), `admin/bookings` (+ `confirm-availability`, `mark-unavailable`, `mark-paid`, `complete`, `boarding-passes` upload), `DELETE admin/boarding-passes/{id}`, `admin/settings` |

Errors use DRF's standard format.

## Tests and checks

```bash
cd backend && pytest                                 # backend test suite (needs PostgreSQL)
cd frontend && npx tsc --noEmit                      # type-check the app
cd frontend && npx expo export --platform web        # production web build
```

The backend tests use an in-memory email outbox, run Celery tasks eagerly and write uploaded files to a temporary directory, so the worker and Redis don't need to be running. PostgreSQL does.

## Decisions

Every choice made where the spec was ambiguous is recorded, one line each, in [DECISIONS.md](DECISIONS.md).
