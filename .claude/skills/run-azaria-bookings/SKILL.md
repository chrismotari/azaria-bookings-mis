---
name: run-azaria-bookings
description: Run, start, drive and screenshot Azaria Bookings (Django API + Celery + Expo web app). Use when asked to run the app, start its processes, click through a flow in the browser, take a screenshot of a screen, do the end-to-end walkthrough, or check a UI change in the real app.
---

Azaria Bookings is a Django REST API (`backend/`), Celery worker and beat, and an Expo web-first app (`frontend/`). An agent drives it with headless Chrome through **`.claude/skills/run-azaria-bookings/driver/`** (playwright-core + small scripts). `flow.mjs` runs the whole booking flow; `shot.mjs` screenshots any URL as any role.

All paths are relative to the repo root.

## Prerequisites

Already present on this machine: Python venv at `backend/.venv`, PostgreSQL and Redis running locally, Node 24, `/usr/bin/google-chrome`. The driver uses that Chrome (no Playwright browser download).

```bash
cd .claude/skills/run-azaria-bookings/driver && npm install
```

## Start the processes

Check first: the user often already runs the API and the web app in their own terminals. Reuse them if they answer.

```bash
curl -s -o /dev/null -w 'api %{http_code}\n' http://localhost:8000/api/offers
curl -s -o /dev/null -w 'web %{http_code}\n' http://localhost:8081
```

Start only what is missing; each line stands alone, run from the repo root. Logs go to `/tmp/azaria-run/`. Always start your own worker: the worker log is where you read emails (console backend), including password-reset links.

```bash
mkdir -p /tmp/azaria-run
(cd backend && source .venv/bin/activate && nohup python manage.py runserver > /tmp/azaria-run/api.log 2>&1 &)
(cd backend && source .venv/bin/activate && nohup celery -A config worker -l info > /tmp/azaria-run/worker.log 2>&1 &)
(cd backend && source .venv/bin/activate && nohup celery -A config beat -l info -s /tmp/azaria-run/beat-schedule > /tmp/azaria-run/beat.log 2>&1 &)
(cd frontend && CI=1 nohup npx expo start --web --port 8081 > /tmp/azaria-run/expo.log 2>&1 &)
timeout 120 bash -c 'until curl -sf http://localhost:8081 >/dev/null && curl -sf http://localhost:8000/api/offers >/dev/null; do sleep 1; done' && echo ready
```

You need an admin account (the user's admin password is unknown to you). Create one; it refuses an email that exists, so reuse it next time:

```bash
cd backend && source .venv/bin/activate && python manage.py create_admin --email agent.admin@example.com --password 'Agent-Admin-2026!' --name "Agent Admin"
```

## Run (agent path)

All driver commands run from `.claude/skills/run-azaria-bookings/driver/`. Screenshots land in `/tmp/azaria-run/shots/<role>-NN-<name>.png`. **Look at them.**

| command | what it does |
|---|---|
| `AZARIA_ADMIN_EMAIL=... AZARIA_ADMIN_PASSWORD=... node flow.mjs` | Full flow with a fresh customer: guest search with no results → Request options → gate → register → request → admin responds with a custom offer → book 2 passengers → confirm → mark paid → upload PDF + PNG → send → customer downloads both and checks the bytes. Prints `FLOW OK (request N, booking M)`. About 1 minute. |
| `node login.mjs <role> <email> <password>` | Signs in and saves the session as `/tmp/azaria-run/profiles/<role>.json` |
| `node shot.mjs <role> <path> [width]` | Screenshots `http://localhost:8081<path>` as `<role>` (`guest` = signed out) and prints horizontal overflow. Use width `390` for the phone layout (bottom tabs). |

```bash
cd .claude/skills/run-azaria-bookings/driver
AZARIA_ADMIN_EMAIL=agent.admin@example.com AZARIA_ADMIN_PASSWORD='Agent-Admin-2026!' node flow.mjs
node login.mjs admin agent.admin@example.com 'Agent-Admin-2026!'
node shot.mjs admin /admin 390
node shot.mjs guest /
```

For a new flow, write a script next to these and import from `lib.mjs`: `run(role, async ({ page, shot }) => ...)`, `signIn`, `field(page, label)`, `seen(page, text)`, `button(page, name)`.

Read an email (e.g. the password-reset link). The console backend wraps lines with `=` and writes `=` as `=3D`:

```bash
sed -e ':a;/=$/{N;s/=\n//;ba}' /tmp/azaria-run/worker.log | grep -o 'http://localhost:8081/reset-password?uid=3D[^&]*&token=3D[^ ]*' | tail -1 | sed 's/=3D/=/g'
```

Run a scheduled task now instead of waiting for beat (expire every 5 min, reminders every 15 min, stale requests hourly):

```bash
cd backend && source .venv/bin/activate && DJANGO_SETTINGS_MODULE=config.settings python -c "
import django; django.setup()
from bookings.tasks import expire_unpaid_bookings, send_payment_reminders, expire_stale_requests
print(expire_unpaid_bookings.delay().get(timeout=15), send_payment_reminders.delay().get(timeout=15), expire_stale_requests.delay().get(timeout=15))"
```

Expiry case: a confirmed booking's deadline is 24h away. Move it into the past, then run the task above (or wait for beat):

```bash
cd backend && source .venv/bin/activate && DJANGO_SETTINGS_MODULE=config.settings python -c "
import django; django.setup()
from datetime import timedelta; from django.utils import timezone; from bookings.models import Booking
print(Booking.objects.filter(pk=BOOKING_ID, status='availability_confirmed').update(payment_deadline=timezone.now() - timedelta(minutes=1)))"
```

## Stop

Stop only what you started. The bracketed first letter keeps `pkill -f` from matching the shell that runs it (a plain pattern kills that shell: exit 144).

```bash
pkill -f '[c]elery -A config'
pkill -f '[e]xpo start --web --port 8081'
pkill -f '[m]anage.py runserver'   # only if you started the API
```

## Run (human path)

The four terminals in `README.md` (runserver, worker, beat, `npx expo start --web`), then open http://localhost:8081.

## Test

```bash
cd backend && source .venv/bin/activate && pytest -q
cd frontend && npx tsc --noEmit
```

About 400 backend tests in ~15 s. They need PostgreSQL only, not the worker, Redis or the web app.

## Gotchas

- **Hidden stack screens match selectors.** React Navigation keeps earlier screens mounted (Login stays under Register). `getByLabel`/`getByText` then resolve to the invisible copy and time out. Use `field`/`seen` from `lib.mjs` (`:visible` selectors); `getByRole` already skips hidden nodes.
- **The auth gate's pending action lives in memory.** Guest → "Request options" → register must happen in one page session, without a reload or a new browser, or the app lands on Explore instead of the prefilled form.
- **Inputs are found by `aria-label` = their visible label** (`TextField`, `DateField`, `AirportPicker` set it). Date inputs take `YYYY-MM-DD` via `fill`.
- **Respond screen has two From/To pairs.** Filter search on top, custom offer below. The custom pair is prefilled with the request's airports; class chips appear twice, so use `getByRole('radio', { name }).nth(1)` for the custom one.
- **Admin URLs as a guest show Explore.** If a saved admin session is missing or expired, `/admin/...` silently renders the guest navigator. Sign in first (`signIn` or `login.mjs`).
- **Deep links have no back button.** A detail page opened by URL (the links in emails) has no header back arrow and no tab bar; navigate with `page.goto`.
- **`window.confirm` dialogs** (Confirm availability, Mark paid, Delete, Cancel) are auto-accepted by `lib.mjs`.
- **Expected 4xx responses show up as console errors** (e.g. "status of 409" when an action is refused). They are not failures by themselves.
- **Explore needs a route with no public deals** for the "Request options" path. `flow.mjs` uses NBO→ZNZ; override with `ROUTE=NBO-KGL` if that route gets deals.
- **The user's Expo server may disappear mid-session** (they stop it in their terminal). `ERR_CONNECTION_REFUSED` on `:8081` → start it as above.

## Troubleshooting

- **`locator.waitFor: Timeout ... resolved to hidden <div>`**: a hidden stack screen matched. Use `seen()` / `field()`, or wait on `page.waitForURL(...)`.
- **`page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8081`**: the Expo dev server is not running. Start it (see above) and wait for the `ready` loop.
- **Shell exits with code 144 right after `pkill -f`**: the pattern matched the shell itself. Use the bracketed patterns in Stop.
- **`showmigrations` lists an unapplied migration / upload fails with a missing table**: the dev DB is behind. Run `python manage.py migrate`.
