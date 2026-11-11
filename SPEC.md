# Azaria Bookings — Specification

A multi-agency flight-offers and booking platform. Each travel agency (tenant) gets its own site where its admin lists flight deals, anyone can browse them, and registered customers request options or book. The admin confirms availability, the customer pays outside the system, the admin marks the booking paid, uploads boarding passes and sends them by email; the customer can also open them in the app. The platform's system owner manages agencies, plans and invoices on the root host.

This document describes the system as it stands. Work is delivered in the numbered steps at the end; new steps are appended there.

## 1. Rules

- PostgreSQL only (development, tests, production). No Docker; PostgreSQL and Redis run locally.
- No TODOs, stubs, placeholder code, mock data, or unused fields, endpoints, models or dependencies.
- Out of scope: passenger details, payment processing, push notifications, airline APIs, email verification, re-sending passes after completion, multi-currency for bookings, multi-language, social login, reviews, packages, blog, per-agency branding.
- Agency prices are USD, defined once as `CURRENCY`; no currency column. Platform prices use `PLATFORM_CURRENCY`.
- Time zone Africa/Nairobi, `USE_TZ = True`; all user-facing times are Nairobi time.
- "Admin" is the agency owner's in-app role (`User.role == "admin"`). Django's admin site is technical support only, mounted at `/django-admin/` for superusers. Never mix the two.
- Every model's primary key is a UUID (`default=uuid.uuid4`), and so is every id in URLs and API bodies. Only Django's framework tables keep numeric keys. Airports are identified by IATA code in the API. A malformed id returns 404.
- Web first: when web and native conflict, choose web. The app must compile for native but is verified in the browser.
- Files: preview first. Anything the browser can display (PDF, PNG, JPEG, WebP, GIF) opens in a new tab ("Open", "Open PDF"); only other files download, and a blocked tab falls back to download.
- Ambiguities: pick the simplest option and add one line to DECISIONS.md.

## 2. Stack and configuration

- Backend: Django, DRF, Simple JWT (access 30 min, refresh 7 days), django-filter, django-cors-headers, django-environ, django-tenants, Celery + Redis (broker and results, `task_acks_late`, JSON, beat schedule in settings), fpdf2 (invoice PDFs), nh3 (HTML sanitizing), Pillow. Tests: pytest, pytest-django, freezegun.
- Settings from `backend/.env`: `SECRET_KEY`, `DEBUG`, `DATABASE_URL`, `REDIS_URL`, `ALLOWED_HOSTS`, `TENANT_BASE_DOMAIN`, `CORS_ALLOWED_ORIGIN_REGEXES`, `FRONTEND_URL` (with `{domain}`), `NUM_PROXIES`, `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `ADMIN_EMAIL`, `PLATFORM_CURRENCY`.
- Email: console when `EMAIL_HOST` is empty, SMTP otherwise, locmem in tests.
- DRF: page size 20, JSON (multipart only for uploads), register/login/password-reset throttled at 10/min per IP, Django password validators on registration and reset. Errors use DRF's format; invalid booking transitions return 409.
- Private storage (`backend/private_media/`, never served by URL) for boarding passes, invoice PDFs and chat attachments; stored names are random UUIDs plus extension. Public storage (`backend/media/`, served at `/media/`) for airline logos only.
- Frontend: Expo + TypeScript with react-native-web, React Navigation (every screen has a browser URL), TanStack Query, axios, react-hook-form + zod, expo-secure-store (native tokens), @expo/vector-icons (Ionicons), react-native-svg (+ transformer for native flags), TipTap (web rich text). `EXPO_PUBLIC_API_URL` may contain `{host}`, replaced by the page's hostname; `EXPO_PUBLIC_PLATFORM_HOST` names the root host.

## 3. Multitenancy

- One PostgreSQL schema per agency (django-tenants), chosen by hostname. Agency: `<schema>.<TENANT_BASE_DOMAIN>` (its primary domain); extra domains can be added.
- Public schema = the platform: apps `tenants`, `airports`, `airlines`, `accounts` (system owner accounts), `support` (platform desk). Agency schemas: `accounts`, `catalog`, `requests`, `bookings`, `core`, `support`. The same email may hold separate accounts at different agencies.
- Root host: the platform's API (`/api/platform/`) and `/django-admin/`. Any other `/api/` path there, or any unknown host, returns 404 `{"code": "no_tenant"}`.
- Suspended agency (`is_active` false): every `/api/` call returns 403 `tenant_suspended` (non-payment message names the billing contact email); its scheduled jobs and emails are skipped. Agencies are never deleted.
- Schema names: 3–30 lowercase letters, digits, hyphens, starting with a letter; reserved `public`, `www`, `api`, `admin`, `app-admin`. Hyphens become underscores in the schema, not in the domain.
- JWTs carry a tenant claim; a token is refused (401) at any other tenant. Reset links use the agency's primary domain and are invalid elsewhere.
- Celery tasks touching agency data take `schema_name` first, run in that schema, and skip missing or inactive agencies. Beat tasks run their job in every active agency in turn; one agency's error is logged and does not stop the rest.
- `tenants.services.create_agency` (used by the platform app, `/django-admin/` and `manage.py create_agency`) validates the name, creates tenant, schema, primary domain and first admin, sets the notification email, and leaves nothing behind on failure.

## 4. Data model

Shared (public schema)
- **Tenant**: name, schema_name, is_active, created_at, billing_email, suspension_reason (blank / manual / non_payment), suspended_at. **Domain**: domain, tenant, is_primary.
- **Airport**: code (IATA, unique), name, city, country, country_code (ISO alpha-2). `seed_airports` loads OurAirports data (IATA code, scheduled service, not closed), idempotent.
- **Airline**: iata_code (unique, 2 chars), icao_code, name, country, is_active, logo (PNG/JPEG/WebP ≤ 200 KB, content-checked; old file deleted on replace/remove), updated_at. `seed_airlines` adds missing active airlines from OpenFlights data (one per IATA code, preferring one with ICAO) and never changes existing rows. Curated by the owner in `/django-admin/`; never deleted.
- **PlatformSettings** (single row): issuer_details, payment_instructions, invoice_due_days (14), invoice_lead_days (7), billing_contact_email, support_email.
- **Plan**: name, kind (subscription / support), description (sanitized rich HTML ≤ 5,000 chars), tag (blank / recommended / basic / advanced; subscription plans only, each tag on at most one plan, cleared on deactivation), monthly_price, annual_price (at least one), is_active, created_at. Never deleted.
- **Subscription**: tenant, plan, kind, billing_cycle (monthly / annual, plan must have that price), started_on, next_period_start, ended_on, created_at. At most one running per kind per agency. Plan/cycle changes apply from the next invoice.
- **Invoice**: number (`INV-<year>-<0001>`), tenant, subscription, plan_name, billing_cycle, period_start, period_end, amount (copied at issue), issued_on, due_on, status (unpaid / paid / void), paid_on, suspension_waived, pdf (private, `invoices/<schema>/`), created_at.

Per agency
- **User**: email login (unique), full_name, phone, role (customer / admin), is_active. Registration creates customers only; admins via `create_agency` or `create_admin`.
- **AppSettings** (single row): payment_instructions, payment_hold_hours (24), reminder_hours_before (4), admin_notification_email.
- **Offer**: origin, destination (Airport), departure_date, ticket_class (economy / premium_economy / business / first), price (per person), airline (active Airline on create/change), valid_until, is_public, is_active, created_at. Validation: origin ≠ destination, price > 0, valid_until ≤ departure_date and ≥ today on create. Bookable = active, valid_until ≥ today, departure ≥ today. Non-public offers exist only for one customer's request responses. Never deleted.
- **OfferStop / BookingStop**: ordered position, airport, duration_minutes > 0. At most 4; airport differs from origin, destination and the previous stop. Kind derived: layover < 24 h ≤ stopover. Bookings copy the offer's stops at creation.
- **Query** (request for options): user, origin, destination (one required), date_from, date_to, price_min, price_max, ticket_class, max_stopovers, message, status (open / responded / closed). **QueryResponse**: query, message, offers (M2M), created_at; creating one marks the query responded.
- **Booking**: user, offer, query, passenger_count (1–9), notes, unit_price (copied), status, payment_deadline, reminder_sent_at, changes (JSON of old/new unit_price and stops, null when none), changes_accepted, alternatives (Query of suggested options), created_at. Total = unit_price × passengers. No second active (requested / confirmed / paid) booking per user per offer.
- **BookingEvent**: booking, from_status, to_status, actor (null = system), created_at. Written on creation and every change.
- **BoardingPass**: booking, file (private, `boarding_passes/<schema>/<booking>/`), original_name, uploaded_at. PDF/PNG/JPEG ≤ 5 MB, content-checked, ≤ 10 per booking. Upload and delete only while paid; delete removes the file.
- **Conversation / Message** (support): see §8.

## 5. Bookings

All changes go through `bookings/services.py` (`create_booking`, `transition`): atomic, `select_for_update`, validates move and actor, writes a BookingEvent, queues email on commit. Views never set status.

| From | To | Who | Notes |
| --- | --- | --- | --- |
| requested | availability_confirmed | admin | Needs payment instructions. Sets deadline = now + hold hours. Optional new unit_price/stops recorded in `changes`. |
| requested / confirmed | unavailable | admin | Optional suggested offers: creates a responded Query linked as `alternatives`. |
| requested / confirmed | cancelled | customer | No email. |
| requested / confirmed | expired | system | Stale request or deadline passed. |
| availability_confirmed | paid | admin | Refused after the deadline or while changes await acceptance. |
| availability_confirmed | declined | customer | Only while changes await acceptance. No email. |
| paid | completed | admin | "Send boarding passes"; needs at least one pass. |

Customers accept changes with `accept-changes` (409 unless awaiting). Admins can book for an active customer (no "new booking" email to the admin).

## 6. Emails

HTML (one themed base layout, table-based, inline CSS, no images) plus plain-text fallback, via `EmailMultiAlternatives`. Tasks take ids only, retry with backoff (max 5), and reload and re-check state before sending.

- Agency admin: new request, new booking, new support message.
- Customer: request responded, availability confirmed (payment instructions, deadline, any changes), unavailable (with suggestions link if any), payment received, booking expired, payment reminder, boarding passes (all files attached), password reset, account created (set-password link), support reply.
- Platform: invoice (PDF attached, unpaid only), suspended for non-payment, new platform-desk message to `support_email`, reply to platform requester.

## 7. Scheduled tasks (Celery beat)

| Task | Every | Scope |
| --- | --- | --- |
| `expire_unpaid_bookings` | 5 min | each agency: confirmed bookings past deadline → expired |
| `send_payment_reminders` | 15 min | each agency: one reminder within `reminder_hours_before` of the deadline |
| `expire_stale_requests` | hour | each agency: requested bookings whose flight departed → expired |
| `close_idle_chats` | hour | public + each agency: close chats 48 h after the last message |
| `issue_due_invoices` | day | public: next invoice when `next_period_start - lead days ≤ today` (one per run, catches up) |
| `suspend_overdue_tenants` | day | public: suspend for non-payment when an unpaid, unwaived invoice is > 1 month past due |

## 8. Support chat

Two desks with the same design: each agency's (its guests and customers write, its admins answer) and the platform's (root-host visitors and agency admins write, the owner answers).

- Conversation: subject (≤ 150), email, name, requester (user id or null for guests), agency (platform desk only), status (open / closed), closed_at, closed_by, last_message_at, requester_unread, staff_unread. Message: from_staff, author_name, body (≤ 5,000), optional attachment (PDF/PNG/JPEG ≤ 5 MB, private, `support/<schema>/<conversation>/`).
- A guest's chat is one message; replies reach them by email only. Closed chats refuse messages. New guest chats throttled 10/hour per IP.
- Floating message button on every page for requesters (not for whoever answers that desk): panel with open chats and new-chat form; thread polls every 10 s, unread badge every 30 s.
- Support page for signed-in requesters (customers: Account › Support; agency admins: Settings › Support, to the platform). Chats tab for the desk with Open/Closed filter, unread first, unread count on the tab.
- Plan enquiries: "Get started" (public pricing) and "Ask to switch" (agency Plans) open a prefilled chat to the platform desk.

## 9. Platform billing

Agencies pay outside the system. `tenants/billing.py`:
- Starting a subscription (billing_email required, active plan) issues its first invoice at once. `issue_invoice` covers one month or year from `next_period_start`, advances it, renders the PDF, and emails it.
- Owner actions: issue next invoice early, resend, void (unpaid), mark paid (date, default today), mark unpaid.
- Marking paid reactivates an agency suspended for non-payment when nothing else is past the limit. Owner reactivation of such an agency waives its overdue invoices. Manual suspensions are never lifted automatically.
- Agency admins see their plans and invoices (read-only) and a warning banner on every admin screen while an invoice is overdue, naming the suspension date.

## 10. API

Agency host, `/api/`:
- Public: `auth/register`, `auth/login`, `auth/refresh`, `auth/password-reset`, `auth/password-reset-confirm` (same response for unknown emails); `airports?search=` (exact code first, ≤ 20); `offers` (filters: origin/destination text, date range, price range, class, max_stopovers; ordering) and `offers/{id}`; `POST support/chats`.
- Signed in: `auth/me`; `queries` (+ `close`); `bookings` (+ `cancel`, `accept-changes`, `decline-changes`); `boarding-passes/{id}/download` (admin, or customer once completed); `support/chats`, `support/chats/{id}` (+ `messages`), `support/unread`, `support/attachments/{id}`.
- Offer visibility for customers: public and active, or attached to a response to one of their queries (detail and booking only).
- Admin (`/api/admin/`, `IsAdminRole`): `dashboard`, `offers`, `queries` (+ `respond`), `bookings` (create for a customer, + `confirm-availability`, `mark-unavailable`, `mark-paid`, `complete`, `boarding-passes`), `boarding-passes/{id}` (delete), `settings`, `users` (customers only; deactivate instead of delete), `airlines?search=`, `chats` (+ `unread`, `{id}`, `messages`, `close`), `plans`, `billing`, `billing/invoices` (+ `pdf`); and `support/platform-chats` (+ `unread`, `{id}`, `messages`), `support/platform-attachments/{id}`.

Root host, `/api/platform/`: `login`, `refresh`, `me` (active public-schema superusers only), `dashboard`, `public-plans` and `support/chats` (open), `support/attachments/{id}`, `chats` (+ `unread`, `{id}`, `messages`, `close`), `tenants` (+ `domains`, `make-primary`, `subscriptions`), `plans`, `subscriptions/{id}` (+ `end`, `issue-invoice`), `invoices` (filters tenant, status, overdue; + `mark-paid`, `mark-unpaid`, `void`, `resend`, `pdf`), `settings`.

## 11. Frontend

Look and layout
- Colours only as tokens in `src/theme.ts`: primary indigo #1800d2, amber #ffb400 (prices and main calls to action, dark text), slate green #4a6660, neutrals (#252525, #2d3434, #6c7171, #a8b1b5, background #f2f4f7, surface #fff), status (success #51d77a, warning #faba2f, danger #fe455f, info #2275ff) with AA-contrast chip tints. Typography scale 28/22/18/15/13/12, system font.
- Wide (≥ 900 px): indigo top bar with brand, nav items with icons, account menu (initials). Narrow: slim top bar plus bottom tabs. No horizontal scrolling at 390 or 1280 px.
- List → detail opens a right-hand drawer (~480 px) on wide screens with its own URL (no history entries; Escape closes); full screen on narrow. Forms that start new work (Book, Request options, New offer, Respond) are full pages; short tasks use a shared Dialog (small/large, focus-managed, full screen on phones).
- Every list has loading, empty and error states; zod mirrors server validation; dates via a web date input; uploads and file opening are web only.
- Airline badge: logo or initials in the same fixed square frame. Country flags (bundled flag-icons SVGs) only in airport pickers, offer detail header and stop lists, decorative.
- Auth gate: login-required actions store the intended action in memory, send the guest to Login/Register, then resume it.

Agency app
- Guests: Explore (hero search bar with swap, date range and class; filter sidebar or panel; sort tabs; flight result rows; empty state with "Request options") and offer detail (route header, stops, price card, Book with passenger stepper and live total).
- Customers: Requests (criteria, responses with offers), Bookings (trip cards; progress tracker or terminal banner; payment box with countdown; changes box to accept or decline; suggested options; boarding passes), Account (+ Support).
- Admins: Dashboard (count tiles), Offers (table, form with airline and airport pickers and stop editor), Requests (Respond), Bookings (status tabs, action bar, confirm-with-changes and mark-unavailable dialogs, pass upload and send, New booking dialog), Users, Chats, Settings (app settings, Billing with Compare plans, Support).
- `no_tenant` / `tenant_suspended` responses show a full-page message.

Platform app (root host, web only)
- Public: home (short introduction, See pricing) and `/pricing` with a slim public bar. `/login`, `/admin` and `admin.<root host>` lead to sign-in; nothing on the public pages links to it.
- Owner: Dashboard (agency counts, revenue, monthly recurring, outstanding/overdue, 12-month bar chart in plain views, agencies per plan, needs attention), Agencies (table, drawer with agency, domains, plan & billing), Plans (kind tabs, tag column, rich-text dialog, link to pricing), Invoices (filters, drawer actions behind confirm dialogs), Chats, Settings.
- PlanShowcase (public pricing and agency Plans): Monthly/Annual switch with saving, featured Recommended/Basic/Advanced cards, Show all plans, support plans section, "Your plan" for running plans.

## 12. Tests

- Backend (pytest, needs PostgreSQL): two test agencies per session; every rule above has tests, including every transition and actor, email per event and state re-checks, beat tasks with frozen time, visibility and isolation across agencies, uploads (type, size, count, deletion), billing periods, suspension and reactivation, sanitizing, platform permissions, and UUID primary keys on every model.
- Frontend: `npx tsc --noEmit` and `npx expo export --platform web`. UI changes end with a browser check at 390 px and 1280 px.

## 13. Steps

All delivered; each was one commit.

1. Backend foundation: settings, DRF/JWT/CORS/Celery, accounts and password reset, AppSettings, airports, private storage.
2. Offers API; frontend client, auth screens, auth gate, admin Offers.
3. Explore and offer detail for guests.
4. Requests for options and admin responses.
5. Bookings, state machine, booking emails, dashboard.
6. Boarding passes: upload, send, open.
7. Scheduled tasks, payment reminders, admin Settings.
8. README and setup.
9–11. Theme, top bar navigation, detail drawers.
12. HTML emails.
13–16. UI refinement: building blocks, Explore, customer screens, admin screens.
17. Booking progress tracker and dialogs.
18. UUID primary keys.
19. Stops (layovers and stopovers).
20. Confirm availability with changes.
21. Mark unavailable with suggested options.
22. Multitenancy.
23. Customer management by admins.
24. Admin books for a customer.
25. Shared airlines, logos and country flags.
26. Platform app: agencies.
27. Plans, invoices, suspension for non-payment.
28. Preview-first files.
29. Platform home page and dashboard.
30. Pricing page and rich plan descriptions.
31. Support chat: agency desk.
32. Support chat: platform desk and plan enquiries.
33. UUIDs on agencies, domains and settings.
