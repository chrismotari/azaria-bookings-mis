# Azaria Bookings

A multitenant SaaS for small and medium-sized flight ticketing agencies ([azariabookings.com](https://azariabookings.com)).

Each agency gets its own site and data. Its admin lists flight deals, which anyone can browse. Registered customers request options or book. The admin confirms availability, the customer pays outside the system, and the admin marks the booking paid, then uploads and sends the boarding passes (by email and in the app). Customers and guests can write to the agency through a built-in support chat.

On the root host, the platform's owner manages agencies, plans and invoices, and answers platform support chats. Agencies pay outside the system; the owner marks invoices paid, and agencies with long-overdue invoices are suspended automatically.

The system is in active development. An agency can connect fare providers (Duffel, Travelport, Sabre and Amadeus) to search its routes and publish the fares it chooses as offers; booking and ticketing stay manual, and the system works fully without any provider. Payment integrations are planned, so payments are recorded by hand for now.

The full specification is in [SPEC.md](SPEC.md); choices made where it is silent are in [DECISIONS.md](DECISIONS.md).

## Stack

| Area | Technology |
| --- | --- |
| API | Python 3.12+, Django 6.1, Django REST Framework, Simple JWT, django-tenants (one PostgreSQL schema per agency) |
| Database | PostgreSQL |
| Background jobs | Celery with Redis; Celery beat for scheduled tasks |
| Email | HTML + plain text; printed to the console unless `EMAIL_HOST` is set |
| App | Expo (React Native, web first) with TypeScript, React Navigation, TanStack Query, react-hook-form + zod |
| Tests | pytest, pytest-django, freezegun; ruff for lint and format; `tsc`, ESLint (eslint-config-expo) and Prettier for the app |

```
backend/      Django project "config": tenants, airports, airlines, rates, accounts, catalog,
              customer_requests, bookings, support, integrations, core
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

A database created before the migrations were flattened (each app back to `0001_initial`; catalog also has `0002_initial`) must be dropped and set up again. Otherwise, after pulling changes, `python manage.py migrate_schemas` applies new migrations to the platform and every agency.

Exchange rates for fare searches arrive with the daily beat task; to load them at once, run `python manage.py shell -c "from rates.tasks import fetch_exchange_rates; fetch_exchange_rates()"`.

`backend/.env`:

| Variable | Purpose |
| --- | --- |
| `SECRET_KEY`, `DEBUG` | Standard Django settings |
| `DATABASE_URL` | e.g. `postgres://azaria:password@localhost:5432/azaria` |
| `REDIS_URL` | e.g. `redis://localhost:6379/0` |
| `TENANT_BASE_DOMAIN` | The root host (the platform); agencies live at `<schema>.<this>`. `localhost` in development |
| `ALLOWED_HOSTS` | The base domain and its subdomains, e.g. `localhost,.localhost` |
| `CORS_ALLOWED_ORIGIN_REGEXES` | The web app's origins, e.g. `^http://([a-z0-9-]+\.)?localhost:8081$` |
| `FRONTEND_URL` | Base URL for links in emails; `{domain}` is the agency's app address `<code>.<TENANT_BASE_DOMAIN>` (even when its primary domain is a custom one): `http://{domain}:8081` |
| `NUM_PROXIES` | Reverse proxies in front of the API (`0` locally), so throttling sees the real client IP |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | SMTP; leave `EMAIL_HOST` empty to print emails in the worker's console |
| `DEFAULT_FROM_EMAIL` | Sender address |
| `ADMIN_EMAIL` | Default notification email for a new agency |
| `PLATFORM_CURRENCY` | Currency of the platform's plans and invoices |
| `INTEGRATIONS_KEY` | Fernet key that encrypts fare providers' credentials; generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `IOS_APP_ID`, `ANDROID_PACKAGE`, `ANDROID_CERT_FINGERPRINTS` | Optional: the mobile app's link verification files (see Mobile app) |
| `EXCHANGE_RATES_URL` | Daily USD exchange-rate feed (default: ExchangeRate-API's free `https://open.er-api.com/v6/latest/USD`) |

### 3. Web app

```bash
cd frontend
npm install
cp .env.example .env
```

`EXPO_PUBLIC_API_URL` (`http://{host}:8000/api`, where `{host}` becomes the page's hostname, or the stored agency's address in the mobile app), `EXPO_PUBLIC_PLATFORM_HOST` (`localhost`), `EXPO_PUBLIC_TENANT_BASE_DOMAIN` (`localhost`; the backend's `TENANT_BASE_DOMAIN`), and `EXPO_PUBLIC_APP_STORE_URL` / `EXPO_PUBLIC_PLAY_STORE_URL` (store buttons on the `/app` page, hidden while empty).

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

## Fare providers

Agencies add their own provider credentials under Settings › Integrations; nothing goes in `.env` beyond `INTEGRATIONS_KEY`.

**Travelport (Universal API).**
- **Trial:** sign up for the free 30-day Universal API trial on Travelport's developer site (developer.travelport.com). The welcome email gives a username (`uAPI…`), a password and a target branch (`P7…`) for the pre-production system. Add a Travelport integration in **Test** mode with those three values and press Test.
- **Production:** needs a commercial agreement with Travelport (through your Travelport account manager or local Travelport office), which issues production credentials and a production target branch tied to your Galileo (1G) pseudo city. Switch the integration to **Live** and replace its credentials.
- The app uses Travelport's EMEA gateways and the Galileo (1G) host for searches only; booking and ticketing stay in your own terminal.

**Sabre (REST, Bargain Finder Max).**
- **Certification (test):** register on Sabre Dev Studio (developer.sabre.com) and create an application. Its client id has the form `V1:<user id>:<group>:<domain>`; enter the user id, the group as the pseudo city code, the domain and the client secret as the password. Add a Sabre integration in **Test** mode and press Test (it only takes a token).
- **Production:** needs a Sabre agreement with REST API access for your pseudo city, arranged through your Sabre account manager. Sabre gives an EPR user id, password and the `AA` domain for your PCC; switch the integration to **Live** and replace its credentials.
- The app calls Bargain Finder Max v5 for searches only; booking and ticketing stay in your own Sabre terminal. It has been built against Sabre's documented responses and is not yet verified against a live Sabre account.

**Amadeus (REST, Flight Offers Search).**
- **Access:** Amadeus closed its self-service sign-up in 2026, so keys come through an Amadeus Enterprise agreement (via your Amadeus account manager or local Amadeus office). The application's API key and secret work in Amadeus's test environment; production access is granted on the same application.
- Add an Amadeus integration in **Test** mode with the API key and secret and press Test (it only takes a token); switch to **Live** once production is enabled.
- Searches only; booking and ticketing stay in your own terminal. The search does not return fare conditions, so Amadeus fares are shown as not refundable and not changeable; check the rules before selling. Built against Amadeus's documented responses and not yet verified against a live account.

## Mobile app

One shared "Azaria Bookings" app serves every agency. It learns its agency from a link (`https://<code>.<base>/...`, or `azaria://open?agency=<code>` from the web app's `/app` page) or from the agency code typed on first launch, and keeps it with the sign-in tokens. "Switch agency" in the account menu (or on the sign-in screen) signs out and asks again. The web app is unchanged: there the address decides the agency.

- **Ids:** bundle id and Android package `com.azariabookings.app` (`frontend/app.config.ts`). The build reads `EXPO_PUBLIC_TENANT_BASE_DOMAIN` to declare `applinks:*.<base>` (iOS) and an auto-verified intent filter for `*.<base>` (Android).
- **Verification files:** set `IOS_APP_ID` (Apple Team ID plus bundle id, e.g. `ABCDE12345.com.azariabookings.app`), `ANDROID_PACKAGE` (`com.azariabookings.app`) and `ANDROID_CERT_FINGERPRINTS` (the SHA-256 fingerprints of the signing certificates, comma-separated; for Play App Signing take them from the Play Console). Django then serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` on every agency host and on the root host; in production the reverse proxy must send `/.well-known/` to the API over HTTPS, without redirects.
- **Builds:** `cd frontend && npx expo run:ios` / `npx expo run:android` locally, or EAS Build for store builds. Universal and app links need HTTPS on a real domain, so test them on a staging base domain rather than `localhost`.
- **Custom domains:** links only open the app on `<code>.<base>`, which is why every email link uses that address. An agency that wants links on its own custom domain to open an app needs a separate app of its own: a build that declares that domain (and its own bundle id, package and store listings), with the verification files served for that app. The shared app cannot declare agencies' custom domains.

## Files

- `backend/private_media/`: boarding passes, invoice PDFs and chat attachments. Never served by URL; only through authenticated endpoints.
- `backend/media/`: airline logos, served at `/media/` (by Django while `DEBUG` is true; by the reverse proxy in production).

## Tests

```bash
cd backend && pytest                            # needs PostgreSQL, not Redis or the worker
cd backend && ruff check . && ruff format --check .
cd frontend && npx tsc --noEmit
cd frontend && npm run lint && npm run format:check   # npm run format to fix
cd frontend && npx expo export --platform web   # production web build
```

## Data and credits

- Airports: [OurAirports](https://ourairports.com/data/) (public domain).
- Airlines: [OpenFlights](https://openflights.org/data) airline data, [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
- Country flags: [flag-icons](https://github.com/lipis/flag-icons), MIT licence (`frontend/public/flags/LICENSE`).
- Exchange rates: [Rates By Exchange Rate API](https://www.exchangerate-api.com) (open access, attribution required; credited on the platform's Exchange rates screen).
