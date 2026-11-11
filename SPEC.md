# Azaria Bookings — Specification

A multitenant SaaS for small and medium-sized flight ticketing agencies. Each agency (tenant) gets its own site and data: its admin lists flight deals, anyone can browse them, and registered customers request options or book. The admin confirms availability, the customer pays outside the system, the admin marks the booking paid, uploads boarding passes and sends them by email; the customer can also open them in the app. The platform's system owner manages agencies, plans and invoices on the root host.

Many integrations are still to come, so much of the work is done by hand for now: bookings and invoices are paid outside the system and marked paid manually, and booking and ticketing happen in the agent's own GDS. Offers are entered by the admin, or found by searching the agency's routes (by hand or on a schedule) through its fare providers and published after review or automatically; later searches keep published offers' prices up to date.

An agency may connect any fare provider of its choosing (Duffel or Travelport for now), several at the same time, or none: the system works fully without one.

Planned (not yet specified or built):
- Payment integrations, replacing the manual "mark paid" steps.

This document describes the system as it stands. Work is delivered in the numbered steps at the end; new steps are appended there.

## 1. Rules

- PostgreSQL only (development, tests, production). No Docker; PostgreSQL and Redis run locally.
- No TODOs, stubs, placeholder code, mock data, or unused fields, endpoints, models or dependencies.
- Out of scope until specified in a step: payment processing, and booking or ticketing through GDS or airline APIs (providers are used for fare searches only). Out of scope: passenger details, push notifications, email verification, re-sending passes after completion, multi-currency for bookings, multi-language, social login, reviews, packages, blog, per-agency branding.
- Agency prices (offers, bookings) are USD, defined once as `CURRENCY`; no currency column on them. Platform prices use `PLATFORM_CURRENCY`. Fares from providers keep their original currency and are converted to USD for every calculation and comparison; customers only ever see USD.
- Time zone Africa/Nairobi, `USE_TZ = True`; all user-facing times are Nairobi time, except flight times, which are the local times of the airport concerned (stored as date and time with no time zone).
- "Admin" is the agency owner's in-app role (`User.role == "admin"`). Django's admin site is technical support only, mounted at `/django-admin/` for superusers. Never mix the two.
- Every model's primary key is a UUID (`default=uuid.uuid4`), and so is every id in URLs and API bodies. Only Django's framework tables keep numeric keys. Airports are identified by IATA code in the API. A malformed id returns 404.
- Web first: when web and native conflict, choose web. The app must compile for native but is verified in the browser.
- Files: preview first. Anything the browser can display (PDF, PNG, JPEG, WebP, GIF) opens in a new tab ("Open", "Open PDF"); only other files download, and a blocked tab falls back to download.
- Ambiguities: pick the simplest option and add one line to DECISIONS.md.

## 2. Stack and configuration

- Backend: Django, DRF, Simple JWT (access 30 min, refresh 7 days), django-filter, django-cors-headers, django-environ, django-tenants, Celery + Redis (broker and results, `task_acks_late`, JSON, beat schedule in settings), fpdf2 (invoice PDFs), nh3 (HTML sanitizing), Pillow, httpx (fare providers and the rate feed; Travelport's XML is read with the standard library's parser), cryptography (Fernet, provider credentials). Tests: pytest, pytest-django, freezegun; external APIs through httpx's mock transport, never the network.
- Settings from `backend/.env`: `SECRET_KEY`, `DEBUG`, `DATABASE_URL`, `REDIS_URL`, `ALLOWED_HOSTS`, `TENANT_BASE_DOMAIN`, `CORS_ALLOWED_ORIGIN_REGEXES`, `FRONTEND_URL` (with `{domain}`), `NUM_PROXIES`, `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `ADMIN_EMAIL`, `PLATFORM_CURRENCY`, `INTEGRATIONS_KEY` (Fernet key), `EXCHANGE_RATES_URL` (default the free ExchangeRate-API USD feed).
- Email: console when `EMAIL_HOST` is empty, SMTP otherwise, locmem in tests.
- DRF: page size 20, JSON (multipart only for uploads), register/login/password-reset throttled at 10/min per IP, Django password validators on registration and reset. Errors use DRF's format; invalid booking transitions return 409.
- Private storage (`backend/private_media/`, never served by URL) for boarding passes, invoice PDFs and chat attachments; stored names are random UUIDs plus extension. Public storage (`backend/media/`, served at `/media/`) for airline logos only.
- Frontend: Expo + TypeScript with react-native-web, React Navigation (every screen has a browser URL), TanStack Query, axios, react-hook-form + zod, expo-secure-store (native tokens), @expo/vector-icons (Ionicons), react-native-svg (+ transformer for native flags), TipTap (web rich text). `EXPO_PUBLIC_API_URL` may contain `{host}`, replaced by the page's hostname; `EXPO_PUBLIC_PLATFORM_HOST` names the root host.

## 3. Multitenancy

- One PostgreSQL schema per agency (django-tenants), chosen by hostname. Agency: `<schema>.<TENANT_BASE_DOMAIN>` (its primary domain); extra domains can be added.
- Public schema = the platform: apps `tenants`, `airports`, `airlines`, `rates`, `accounts` (system owner accounts), `support` (platform desk). Agency schemas: `accounts`, `catalog`, `requests`, `bookings`, `core`, `support`, `integrations`. The same email may hold separate accounts at different agencies.
- Root host: the platform's API (`/api/platform/`) and `/django-admin/`. Any other `/api/` path there, or any unknown host, returns 404 `{"code": "no_tenant"}`.
- Suspended agency (`is_active` false): every `/api/` call returns 403 `tenant_suspended` (non-payment message names the billing contact email); its scheduled jobs and emails are skipped. Agencies are never deleted.
- Schema names: 3–30 lowercase letters, digits, hyphens, starting with a letter; reserved `public`, `www`, `api`, `admin`, `app-admin`. Hyphens become underscores in the schema, not in the domain.
- JWTs carry a tenant claim; a token is refused (401) at any other tenant. Reset links use the agency's primary domain and are invalid elsewhere.
- Celery tasks touching agency data take `schema_name` first, run in that schema, and skip missing or inactive agencies. Beat tasks run their job in every active agency in turn; one agency's error is logged and does not stop the rest.
- `tenants.services.create_agency` (used by the platform app, `/django-admin/` and `manage.py create_agency`) validates the name, creates tenant, schema, primary domain and first admin, sets the notification email, and leaves nothing behind on failure.

## 4. Data model

Shared (public schema)
- **Tenant**: name, schema_name, is_active, created_at, billing_email, suspension_reason (blank / manual / non_payment), suspended_at, monthly_search_allowance (1500; fare searches per Nairobi calendar month, edited by the owner). **Domain**: domain, tenant, is_primary.
- **Airport**: code (IATA, unique), name, city, country, country_code (ISO alpha-2). `seed_airports` loads OurAirports data (IATA code, scheduled service, not closed), idempotent.
- **Airline**: iata_code (unique, 2 chars), icao_code, name, country, is_active, logo (PNG/JPEG/WebP ≤ 200 KB, content-checked; old file deleted on replace/remove), updated_at. `seed_airlines` adds missing active airlines from OpenFlights data (one per IATA code, preferring one with ICAO) and never changes existing rows. Curated by the owner in `/django-admin/`; never deleted.
- **ExchangeRate**: currency (ISO 4217), units_per_usd (8 decimals), date, source (feed / manual), fetched_at; one row per currency per date; USD is always 1 and has no rows. `rates.convert(amount, currency, on)` gives the USD amount (÷ rate, half-up to the cent), the rate and its date, from the latest rate on or before `on`; no rate raises, a rate more than 3 days older is used but reported stale. Stored conversions keep their rate and rate date.
- **PlatformSettings** (single row): issuer_details, payment_instructions, invoice_due_days (14), invoice_lead_days (7), billing_contact_email, support_email.
- **Plan**: name, kind (subscription / support), description (sanitized rich HTML ≤ 5,000 chars), tag (blank / recommended / basic / advanced; subscription plans only, each tag on at most one plan, cleared on deactivation), monthly_price, annual_price (at least one), is_active, created_at. Never deleted.
- **Subscription**: tenant, plan, kind, billing_cycle (monthly / annual, plan must have that price), started_on, next_period_start, ended_on, created_at. At most one running per kind per agency. Plan/cycle changes apply from the next invoice.
- **Invoice**: number (`INV-<year>-<0001>`), tenant, subscription, plan_name, billing_cycle, period_start, period_end, amount (copied at issue), issued_on, due_on, status (unpaid / paid / void), paid_on, suspension_waived, pdf (private, `invoices/<schema>/`), created_at.

Per agency
- **User**: email login (unique), full_name, phone, role (customer / admin), is_active. Registration creates customers only; admins via `create_agency` or `create_admin`.
- **AppSettings** (single row): payment_instructions, payment_hold_hours (24), reminder_hours_before (4), admin_notification_email.
- **Offer**: trip_type (one_way / return), origin, destination (Airport), departure_date, return_date (null for one-way), ticket_class (economy / premium_economy / business / first), price (per person; for a return, the round trip), airline (the ticketing airline; active on create/change), baggage per passenger (checked_bags 0–3, checked_bag_kg and cabin_bag_kg, null = not stated), refund_policy and change_policy (not_allowed / with_fee / free), valid_until, is_public, is_active, created_at; source (manual / gds) and, for GDS offers only (null otherwise), integration, route, provider_ref, fare_key, net_amount, net_currency, net_usd, rate, rate_date, fare_type, price_checked_at, price_edited (the admin changed the price since publishing), missing_since (review-mode routes: not found by searches since then). Origin, destination, departure_date and return_date are derived from the segments. Validation: price > 0, valid_until ≤ departure_date and ≥ today on create. Bookable = active, valid_until ≥ today, departure ≥ today. Non-public offers exist only for one customer's request responses. Never deleted.
- **OfferSegment / BookingSegment**: one flight each: direction (outbound / return), position (from 1 within a direction), airline (marketing carrier), flight_number (1–4 digits and an optional letter), operating_airline (codeshares only), origin, destination, departure and arrival date and time (local). Per direction 1–5 segments, chained airport to airport, each leaving after the previous one lands, arrival date one day before to two days after departure; the outbound flights end elsewhere than they start; one-way offers have no return segments; return segments go back from the destination to the origin and leave after the outbound ones land. Active airlines on create or change. Connections are derived between consecutive segments: airport, wait in minutes and kind (layover < 24 h ≤ stopover). Bookings copy the offer's segments, trip type, return date, baggage and fare conditions at creation.
- **Query** (request for options): user, origin, destination (one required), date_from, date_to, trip_type (blank = any, one_way, return), return_date (return only), price_min, price_max, ticket_class, max_stopovers, message, status (open / responded / closed). **QueryResponse**: query, message, offers (M2M), created_at; creating one marks the query responded.
- **Booking**: user, offer, airline (the ticketing airline, copied from the offer; confirming with changes may change it), query, passenger_count (1–9), notes, unit_price (copied), source, integration and fare_key (copied; null for manual offers), status, payment_deadline, reminder_sent_at, trip fields and segments copied from the offer, changes (JSON of old/new unit_price, airline and segments, null when none), changes_accepted, alternatives (Query of suggested options), created_at. Total = unit_price × passengers. No second active (requested / confirmed / paid) booking per user per offer.
- **BookingEvent**: booking, from_status, to_status, actor (null = system), created_at. Written on creation and every change.
- **Integration** (fare provider): provider (duffel / travelport), name, mode (test / live), credentials (Fernet-encrypted JSON of the provider's fields, never returned), is_active, last_tested_at, last_test_ok, last_test_message, created_at. Several per agency; disabled, never deleted.
- **Route**: origin, destination, trip_type, stay_nights (return only, 1–60), ticket_class, max_connections (0–4, null = any), airlines (M2M, ticketing airlines; empty = any), integrations (M2M; empty = every active one), weekdays (0 = Monday; empty = every day), schedule (manual / daily / weekly) and schedule_weekday (weekly only), window (fixed: window_from–window_to, at most 60 days; rolling: days_ahead_from to days_ahead_to days ahead, the difference ≤ 60; default rolling 1 to 30), auto_publish (false), pick_cheapest, pick_cheapest_direct, max_per_date (1–5), markup_percent and markup_fixed (≥ 0; selling = net USD × (1 + percent/100) + fixed, half-up to the cent), is_active, created_at.
- **SearchRun**: route, trigger (manual / scheduled / recheck: one search for a booking's fare, storing no fares), date_from, date_to, status (queued / running / done / failed / skipped: a scheduled run that could not start, the reason in errors), searches_made (the planned count while queued), fares_found, errors (short messages), started_by, created_at, finished_at.
- **Fare**: every valid result of a run: run, route, integration, itinerary (segments in the offer input shape), trip_type, ticket_class, airline (ticketing), net_amount and net_currency (as priced), net_usd, rate, rate_date (null with no_rate when the currency has no rate), selling_price, baggage and fare conditions, fare_type (public / private / unknown), seats_left, provider_ref, fare_key (each segment's carrier, flight number and date, plus the cabin), expires_at, picked, status (new / published / dismissed), offer, created_at. Kept 30 days, published ones longer.
- **BoardingPass**: booking, file (private, `boarding_passes/<schema>/<booking>/`), original_name, uploaded_at. PDF/PNG/JPEG ≤ 5 MB, content-checked, ≤ 10 per booking. Upload and delete only while paid; delete removes the file.
- **Conversation / Message** (support): see §8.

## 5. Bookings

All changes go through `bookings/services.py` (`create_booking`, `transition`): atomic, `select_for_update`, validates move and actor, writes a BookingEvent, queues email on commit. Views never set status.

| From | To | Who | Notes |
| --- | --- | --- | --- |
| requested | availability_confirmed | admin | Needs payment instructions. Sets deadline = now + hold hours. Optional new unit_price/airline/segments (same trip type and route; an active airline or the booking's own) recorded in `changes`. |
| requested / confirmed | unavailable | admin | Optional suggested offers: creates a responded Query (the booking's route, dates and trip type) linked as `alternatives`. |
| requested / confirmed | cancelled | customer | No email. |
| requested / confirmed | expired | system | Stale request or deadline passed. |
| availability_confirmed | paid | admin | Refused after the deadline or while changes await acceptance. |
| availability_confirmed | declined | customer | Only while changes await acceptance. No email. |
| paid | completed | admin | "Send boarding passes"; needs at least one pass. |

Customers accept changes with `accept-changes` (409 unless awaiting). Admins can book for an active customer (no "new booking" email to the admin).

Re-check (`integrations.services.recheck_fare`): for a requested booking with a GDS source, the admin searches its flights again (one search through the booking's integration, counted against the allowance as a run of the offer's route with trigger recheck). The answer is the booked fare_key's current original amount, USD equivalent (today's rate), selling price (the route's current markup) and segments, or "not found" with up to 3 cheapest other fares on the same dates. Nothing changes on the booking; the admin applies the answer through confirm availability.

## 5a. Fare searches

`integrations/services.py`; providers in `integrations/providers/` behind one interface (`search(request) -> results`, `test()`), each result normalised to the offer itinerary shape plus net amount and currency, baggage, conditions, fare type, seats left, reference and expiry.
- Duffel: offer requests (`POST /air/offer_requests?return_offers=true`, `Duffel-Version: v2`, one adult, cabin, max connections when set); slices → directions, segments with marketing and operating carriers and local times (technical stops ignored), checked bags included on every flight → `checked_bags`, refund and change conditions → policies (no condition: not allowed; a penalty of zero: free; otherwise with a fee), `private_fares` → fare type; seats left are not given. Test connection lists one airline.
- Travelport (Universal API, Air schema v52): `LowFareSearchReq` over its SOAP endpoint (pre-production in test mode, production in live), HTTP Basic auth as `Universal API/<username>` with the password, the target branch on every request; one adult, a leg per direction, the cabin and max connections when set, priced solutions. Credentials: username, password, target branch. Journeys → directions, air segments with marketing and codeshare operating carriers and local times (technical stops ignored), the fare components' baggage allowance → `checked_bags` and weight, refundable / exchangeable with their penalties → policies, private or negotiated fares → fare type, the fewest booking counts → seats left, the latest ticketing time → expiry. A SOAP fault is a provider error. Test connection pings its System service.
- Search now: the route's window from today on (a rolling window counted from today, a fixed one without its past days); needed = matching weekdays × the route's active integrations; refused with 409 naming both numbers when more than what is left of the month's allowance (summed `searches_made`, Nairobi month), and with 409 when the window has passed, no date falls on the weekdays or there is no active integration. The run is a tenant Celery task: one search per date per integration, a provider error recorded and the run going on; failed when every search failed.
- Scheduled: hourly, from 02:00 Nairobi time, each active daily route without a scheduled run today and each active weekly route on its weekday without one this week gets a run (trigger scheduled) over its window. One that cannot start (over the allowance, or nothing to search) is recorded as a skipped run with the reason, which counts as that day's or week's run.
- A result is skipped (and counted in the run's errors) when an airline or airport is not in the shared tables or it breaks the itinerary rules for the route; every other result is stored, converted at the run's date.
- Picking, per run: the route's cabin, connections and airlines; one fare per fare_key (the cheapest in USD across integrations); per departure date the `max_per_date` cheapest and/or the cheapest direct. Earlier new fares for the same dates stop being picked (kept for price history). Fares without a rate are never picked or published.
- Publish: a GDS offer from the fare (itinerary, baggage, conditions, source fields, price_checked_at = the run's end) with the admin's price, valid_until (≤ departure, ≥ today) and visibility; an active offer with the same fare_key gets the new price, net and conversion fields and price_checked_at instead (and is no longer missing or edited). Only new fares are published; dismissing hides one (published ones cannot be). Changing a GDS offer's price in the admin's offer form marks it edited.
- Refresh, after every run that is not failed: the route's active GDS offers departing on a date at least one search answered for. One found (a fare with its fare_key, the cheapest in USD) gets the fare's net amount, currency and conversion, the selling price (net USD at the run's rate + markup; on a review-mode route only while not edited) and price_checked_at = the run's end, and is no longer missing; a fare without a rate only clears missing. One not found is deactivated on an auto-publish route, otherwise marked missing (`missing_since`, kept from the first search that missed it).
- Auto-publish routes then publish the run's picked new fares as the publish dialog would: selling price, valid until today + 7 days (at most the departure), public. A fare that cannot be published is noted in the run's errors.
- Booking re-check: one search of the booking's departure and return dates, route, cabin and trip type, with at most as many connections as the booking has; results pass the same skip rules against the booking's route. Refused with 409 for manual bookings, any status but requested, a disabled integration or no search left (naming both numbers); a provider error answers 502 with its message and the search still counts.

## 6. Emails

HTML (one themed base layout, table-based, inline CSS, no images) plus plain-text fallback, via `EmailMultiAlternatives`. Emails about a booking show its itinerary per direction (flight numbers, local times, connections), baggage and fare conditions. Tasks take ids only, retry with backoff (max 5), and reload and re-check state before sending.

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
| `fetch_exchange_rates` | day | public: today's rate per currency from `EXCHANGE_RATES_URL`; a manual rate for the day is kept |
| `delete_old_fares` | day | each agency: fares older than 30 days, except published ones |
| `run_due_route_searches` | hour | each agency: scheduled route searches that are due (from 02:00) |

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
- Public: `auth/register`, `auth/login`, `auth/refresh`, `auth/password-reset`, `auth/password-reset-confirm` (same response for unknown emails); `airports?search=` (exact code first, ≤ 20); `offers` (filters: origin/destination text, date range, trip_type, return date range, price range, class, max_stopovers counted in the busier direction; ordering) and `offers/{id}`; `POST support/chats`.
- Signed in: `auth/me`; `queries` (+ `close`); `bookings` (+ `cancel`, `accept-changes`, `decline-changes`); `boarding-passes/{id}/download` (admin, or customer once completed); `support/chats`, `support/chats/{id}` (+ `messages`), `support/unread`, `support/attachments/{id}`.
- Offers (public, admin, nested in responses and bookings) return `source` and `price_checked_at` (never net amounts, rates or fare type outside the admin API), the trip fields and `itinerary`: `{outbound, return}`, each direction with its segments (nested airlines and airports), connections and stop_count; return is null for one-way. Admin create/edit and custom offers take `segments` as one ordered list; an edit with segments replaces them all. Bookings return their own trip fields and itinerary.
- Offer visibility for customers: public and active, or attached to a response to one of their queries (detail and booking only).
- Admin (`/api/admin/`, `IsAdminRole`): `dashboard`, `offers`, `queries` (+ `respond`), `bookings` (create for a customer, + `confirm-availability`, `recheck-fare`, `mark-unavailable`, `mark-paid`, `complete`, `boarding-passes`), `boarding-passes/{id}` (delete), `settings`, `users` (customers only; deactivate instead of delete), `airlines?search=`, `chats` (+ `unread`, `{id}`, `messages`, `close`), `plans`, `billing`, `billing/invoices` (+ `pdf`); and `support/platform-chats` (+ `unread`, `{id}`, `messages`), `support/platform-attachments/{id}`. Admin offers also return the GDS source fields and `missing_since`; admin bookings return `source`, `integration` ({id, name}) and `fare_key`; `recheck-fare` returns `{found, fare, alternatives}`, each fare with its original amount and currency, net_usd, rate, rate_date, no_rate, selling_price, `segments` (the confirm-availability input shape) and `itinerary`; the dashboard returns `new_fares` (picked, new).
- Fare searches (admin): `integrations` (list, create with `credentials`, PATCH name, mode, credentials, is_active; never returns credentials) and `integrations/{id}/test`; `routes` (list, create, PATCH; each with its schedule, window, auto_publish, last run and new fares), `routes/{id}/search` (over the window) → the run, `routes/{id}/runs` (booking re-checks included); `search-usage` (allowance, used, left); `fares?route=&run=&status=&picked=` (`{run, dates: [{departure_date, fares}]}`, latest run not skipped or a re-check by default, dismissed only when asked, sorted by USD; each fare with its itinerary as offers return it), `fares/history?route=&departure_date=` (cheapest USD fare per run), `fares/{id}/publish {price, valid_until, is_public}`, `fares/{id}/dismiss`.

Root host, `/api/platform/`: `login`, `refresh`, `me` (active public-schema superusers only), `dashboard`, `public-plans` and `support/chats` (open), `support/attachments/{id}`, `chats` (+ `unread`, `{id}`, `messages`, `close`), `tenants` (+ `domains`, `make-primary`, `subscriptions`), `plans`, `subscriptions/{id}` (+ `end`, `issue-invoice`), `invoices` (filters tenant, status, overdue; + `mark-paid`, `mark-unpaid`, `void`, `resend`, `pdf`), `settings`, `exchange-rates` (latest per currency with `stale`; POST `{currency, units_per_usd}` sets today's manual rate). Tenants return and accept `monthly_search_allowance` and return `searches_this_month`; the dashboard returns `fare_searches` (this month's searches and allowance of each agency that made any, most first).

## 11. Frontend

Look and layout
- Colours only as tokens in `src/theme.ts`: primary indigo #1800d2, amber #ffb400 (prices and main calls to action, dark text), slate green #4a6660, neutrals (#252525, #2d3434, #6c7171, #a8b1b5, background #f2f4f7, surface #fff), status (success #51d77a, warning #faba2f, danger #fe455f, info #2275ff) with AA-contrast chip tints. Typography scale 28/22/18/15/13/12, system font.
- Wide (≥ 900 px): indigo top bar with brand, nav items with icons, account menu (initials). Narrow: slim top bar plus bottom tabs; with more than five tabs, four stay in the bar and the rest go under a "More" tab (a menu carrying their badges). No horizontal scrolling at 390 or 1280 px.
- List → detail opens a right-hand drawer (~480 px) on wide screens with its own URL (no history entries; Escape closes); full screen on narrow. Forms that start new work (Book, Request options, New offer, Respond) are full pages; short tasks use a shared Dialog (small/large, focus-managed, full screen on phones).
- Every list has loading, empty and error states; zod mirrors server validation; dates via a web date input; uploads and file opening are web only.
- Airline badge: logo or initials in the same fixed square frame. Country flags (bundled flag-icons SVGs) only in airport pickers, offer detail header and connection rows, decorative.
- Compact route lines show "NBO → LHR" for one-way and "NBO ⇄ LHR" for return trips, with both dates.
- Auth gate: login-required actions store the intended action in memory, send the guest to Login/Register, then resume it.

Agency app
- Guests: Explore (hero search bar with Any / Return / One way, swap, departure and return date ranges and class; filter sidebar or panel; sort tabs; flight result rows with one line of local times per direction and a baggage summary; empty state with "Request options") and offer detail (route header, an itinerary card per direction with connections, baggage and fare conditions, price card, Book with both directions, passenger stepper and live total).
- Customers: Requests (criteria including trip type and return date, responses with offers), Bookings (trip cards; itinerary, baggage and conditions cards; progress tracker or terminal banner; payment box with countdown; changes box to accept or decline; suggested options; boarding passes), Account (+ Support).
- Admins: Dashboard (count tiles; "New fares to review" when there are any), Offers (table, form with One way / Return, a segment editor per direction with live connections, baggage and fare conditions; "Not found in the last search" chip and a note in the drawer for missing GDS offers), Routes (only once the agency has an integration: a warning once 80% of the month's searches are used; table with trip and stay, cabin and schedule, last run and new fares; drawer with Search now (the window's dates, searches needed against what is left), recent runs (scheduled or by whom, skipped ones with the reason, booking re-checks marked) with their errors, and the route's settings including departures (days ahead or fixed dates), scheduled search (manual / daily / weekly and day) and publishing (review or automatic); New route dialog), Fares for a route (Picked / All results, run selector, grouped by departure date with a price history per date; flight rows with the original amount, its USD equivalent and rate date, selling price, "No rate" note, fare type, seats left and integration; Publish dialog and Dismiss; published fares link to their offer), Requests (Respond), Bookings (status tabs, action bar, confirm-with-changes (price and flights) and mark-unavailable dialogs, pass upload and send, New booking dialog; on requested GDS bookings the confirm dialog's "Re-check price" fills the price and flights from the answer, shows the original amount, USD equivalent, rate date and selling price, and when not found lists the alternatives, each with "Use these flights"), Users, Chats, Settings (app settings, Integrations (add with the provider's credentials: Duffel's access token, or Travelport's username, password and target branch; test, enable/disable, replace credentials), Billing with Compare plans, Support).
- Offer detail shows "Price checked <time ago>" on GDS offers.
- `no_tenant` / `tenant_suspended` responses show a full-page message.

Platform app (root host, web only)
- Public: home (short introduction, See pricing) and `/pricing` with a slim public bar. `/login`, `/admin` and `admin.<root host>` lead to sign-in; nothing on the public pages links to it.
- Owner: Dashboard (agency counts, revenue, monthly recurring, outstanding/overdue, 12-month bar chart in plain views, agencies per plan, needs attention, fare searches this month per agency against its allowance), Agencies (table, drawer with agency, plan & billing, fare searches (used this month, editable allowance), domains), Plans (kind tabs, tag column, rich-text dialog, link to pricing), Invoices (filters, drawer actions behind confirm dialogs), Chats, Settings (billing and support, and Exchange rates: latest rate per currency with date, source and stale warning, a manual rate for today, the feed's credit).
- PlanShowcase (public pricing and agency Plans): Monthly/Annual switch with saving, featured Recommended/Basic/Advanced cards, Show all plans, support plans section, "Your plan" for running plans.

## 12. Tests

- Backend (pytest, needs PostgreSQL): two test agencies per session; every rule above has tests, including every transition and actor, email per event and state re-checks, beat tasks with frozen time, visibility and isolation across agencies, uploads (type, size, count, deletion), billing periods, suspension and reactivation, sanitizing, platform permissions, fare searches (provider mapping from recorded responses, skips, conversion and the rate feed, allowance, picking, publishing, clean-up, encrypted credentials, schedules and windows, skipped runs, offer refresh and auto-publish, booking fare re-checks), and UUID primary keys on every model.
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
34. Return trips and flight details (see §14).
35. GDS search: integrations, routes, manual search and review (see §15).
36. Scheduled route searches and offer refresh (see §16).
37. Re-check a booking's fare (see §17).
38. Second provider: Travelport (see §18).

Pending (not yet built):

39. Mobile app: one shared app, agency from links or code (see §19).

## 14. Step 34: Return trips and flight details

Goal: offers describe real itineraries the way airlines and GDSs do: one-way or return, each direction made of flight segments with flight numbers and local times, plus the baggage allowance and fare conditions. This works for offers the admin enters by hand and is the shape GDS results will later be mapped into. Prices stay USD.

Industry conventions followed
- An itinerary is a list of **segments** (one flight each: airline, flight number, from, to, departure, arrival). Connections are derived from consecutive segments; they are no longer entered as stops.
- Flight times are **local times of the airport** concerned, as printed on tickets (an arrival may fall on the next day, shown as "+1"). They are stored as local date and time with no time-zone conversion. This is the one exception to the Nairobi-time rule; everything else (deadlines, timelines, chats) stays in Nairobi time.
- A return price is the total for the round trip per adult. Return trips go back from the destination to the origin (no open jaws or multi-city).
- Baggage is per passenger: checked pieces and their weight, and cabin bag weight (e.g. "1 × 23 kg checked, 7 kg cabin").
- Fare conditions are summarised as refund and change policies: not allowed, with a fee, or free.

Model
- **Offer** gains `trip_type` (one_way / return, default one_way) and `return_date` (null for one-way; the date of the first return segment). `departure_date` stays and equals the first outbound segment's departure date. `airline` stays as the ticketing airline shown in the badge.
- Offer gains baggage: `checked_bags` (0–3 pieces), `checked_bag_kg` (null = weight not stated), `cabin_bag_kg` (null = not stated); and fare conditions: `refund_policy` and `change_policy` (not_allowed / with_fee / free, default not_allowed).
- **OfferSegment** replaces OfferStop: offer (related_name "segments", cascade), `direction` (outbound / return), `position` (from 1 within a direction), `airline` (marketing carrier, FK Airline), `flight_number` (1–4 digits plus an optional letter), `operating_airline` (FK Airline, null unless a codeshare), `origin`, `destination` (Airport), `departure_date`, `departure_time`, `arrival_date`, `arrival_time`.
- **BookingSegment** replaces BookingStop with the same fields; a booking copies the offer's segments, trip type, return date, baggage and fare conditions at creation (like unit_price), so later offer edits do not change it.
- Validation per direction: 1 to 5 segments (at most 4 connections, as today); the first segment leaves from the direction's start (outbound: origin; return: destination) and the last arrives at its end; each segment leaves from the airport the previous one arrived at; origin ≠ destination on each segment; a connection's departure is after the previous arrival; an arrival date is between one day before and two days after its departure date. One-way offers have no return segments; return offers need both directions, and the first return departure is after the last outbound arrival. `valid_until ≤ departure_date` as today. Only active airlines on create or change.
- Connections are derived per direction: airport, wait in minutes (next departure minus arrival, same airport so same local time) and kind (layover < 24 h ≤ stopover).
- **Query** gains `trip_type` (blank = any, one_way, return) and `return_date` (optional; only with return). Mark unavailable fills both from the booking.
- There is no production data: the catalog and bookings migrations are regenerated and development databases are reset (no upgrade path).

API
- Offers (public, admin, nested in responses and bookings) return `trip_type`, `return_date`, baggage and fare-condition fields, and `itinerary`: `{outbound: {segments, connections, stop_count}, return: {...} | null}`. Segments return nested airline, operating airline and airports. `stops` and `stop_count` go.
- Admin create and edit, `new_offers` in respond and mark-unavailable take `segments` as one ordered list of `{direction, airline (id), flight_number, operating_airline (id, optional), origin, destination (IATA codes), departure_date, departure_time, arrival_date, arrival_time}`; an edit with segments replaces them all. `origin`, `destination`, `departure_date` and `return_date` are derived from the segments, not sent.
- Offer filters gain `trip_type` and `return_from` / `return_to` (return date range). `max_stopovers` counts the connections of the direction with the most.
- Confirm availability with changes takes `{unit_price, segments}`; `changes` records `unit_price` and `segments` (old and new, as readable lists: flight, route, local times) with the existing accept/decline flow.
- Bookings return their own itinerary, baggage and fare conditions next to the nested offer.

Frontend
- Admin offer form: a One way / Return switch; "Outbound flights" and "Return flights" sections, each a segment editor (airline picker, flight number, optional "Operated by", from and to airport pickers, departure and arrival date and time) with "Add connecting flight", remove and reorder; the next segment's From and the return direction's endpoints are prefilled; connections show live with wait time and a Layover/Stopover tag. A "Baggage and fare conditions" section. The same editor serves custom offers on Respond and Mark unavailable, and the Confirm availability dialog.
- Explore search bar: Any / Return / One way control; a return date range appears for Return. Result rows show one line per direction: departure and arrival times (with "+1"), airport codes, "Direct" or "N stops", airline badge; returns show both lines; plus a short baggage summary ("23 kg checked" or "Cabin bag only").
- Offer detail and booking detail: an itinerary card per direction, each segment with airline logo, flight number, "Operated by" when set, local departure and arrival times with airports, and connection rows between segments (wait time, Layover/Stopover tag, flag of the connection airport). A "Baggage and fare conditions" card (refund and change policy in plain words). The book form summary shows both directions.
- Compact route lines elsewhere (trip cards, admin tables) show "NBO ⇄ LHR" for returns and "NBO → LHR" for one-way, with both dates.
- Request options form: trip type and an optional return date.

Emails
- Every email that shows a flight shows the itinerary per direction (flight numbers, local times, connections), baggage and fare conditions, as text in both parts.

Tests
- Segment validation (chaining, endpoints per direction, connection times, arrival day window, segment limits, one-way without return segments, return needing both, active airlines).
- Derived connections and kinds; `max_stopovers` with the busier direction; `trip_type` and return date filters.
- Booking copies segments, baggage and conditions; later offer edits leave bookings unchanged; changes on confirm availability record segments and work with accept/decline.
- API shapes for one-way and return; query trip type and return date; mark unavailable carrying them over.
- Emails showing both directions, baggage and conditions.
- Browser check at 390 px and 1280 px: create a one-way and a return offer with a connection and a codeshare, find each on Explore with the trip type filter, book the return, confirm it with a changed segment, accept, and read the itinerary in the booking and the email.

## 15. Step 35: GDS search — integrations, routes, manual search and review

Goal: an agency connects one or more fare providers and keeps a list of routes; the admin searches a route over a date range, reviews the fares found and publishes the chosen ones as offers with the agency's markup. Agencies without an integration see none of this and work as before. Booking and ticketing stay manual: the agent books in their own GDS terminal, and the app's booking flow is unchanged. Duffel is the first provider.

Providers
- `integrations/` app (agency schema). One provider interface: `search(request) -> results`, where the request holds origin, destination, departure date, return date (or none), cabin and max connections for 1 adult, and each result is normalised into step 34's itinerary shape plus net amount and its currency (as the provider priced it), baggage, fare conditions, fare type (public / private / unknown), seats left (or null), the provider's reference and its expiry.
- Duffel provider: offer requests over its REST API with `httpx` (new dependency; tests use its built-in mock transport, never the network). Mapping: slices → directions, segments → segments (marketing and operating carrier, flight number, airports, local departure and arrival), included checked and carry-on bags → `checked_bags` (weight null when not given), refund and change conditions → policies. Technical stops inside a segment are ignored.
- A result is skipped, and counted as an error on the run, when an airline or airport is not in the shared tables or when it breaks step 34's itinerary rules. Every other result is valid and is stored, whatever its currency.

Currency conversion
- New shared app `rates` (public schema). **ExchangeRate**: currency (ISO 4217), units_per_usd (decimal, 8 places), date, source (feed / manual), fetched_at; one row per currency per date. USD is always 1 and has no rows.
- Beat, daily (public): `fetch_exchange_rates` loads the day's rates for every currency from the feed at `EXCHANGE_RATES_URL` (default the free ExchangeRate-API USD feed, credited where rates are shown). A manual rate for a currency and date is never overwritten by the feed.
- `rates.convert(amount, currency, on=date)` returns the USD amount (amount ÷ units_per_usd, rounded half-up to the cent), the rate and the rate's date, using the latest rate on or before that date. With no rate at all it raises; a rate older than 3 days is used but reported as stale.
- Every stored conversion keeps the rate and rate date it used, so figures never change when rates do.
- Platform Settings › Exchange rates: the currencies seen, each with its latest rate, date and source, a stale warning, and a manual rate entry for today.

Model
- **Integration**: provider (duffel), name, mode (test / live), credentials (encrypted with Fernet from `cryptography`, new dependency, key `INTEGRATIONS_KEY` in `.env`; never returned by the API), is_active, last_tested_at, last_test_ok, last_test_message, created_at. Several per agency. Disabled, never deleted.
- **Route**: origin, destination, trip_type, stay_nights (return only, 1–60), ticket_class, max_connections (null = any), airlines (optional M2M; empty = any), integrations (optional M2M; empty = every active one), weekdays (departure weekdays to search; empty = every day), pick rule (`pick_cheapest`, `pick_cheapest_direct`, `max_per_date` 1–5), markup (`markup_percent` and `markup_fixed`, both ≥ 0: selling = net × (1 + percent/100) + fixed, rounded to the cent), is_active, created_at.
- **SearchRun**: route, trigger (manual), date_from, date_to, status (queued / running / done / failed), searches_made, fares_found, errors (list of short messages), started_by, created_at, finished_at.
- **Fare**: every valid result of a run. run, route, integration, itinerary (segments in step 34's input shape), trip_type, ticket_class, airline (ticketing), `net_amount` and `net_currency` (original), `net_usd`, `rate` and `rate_date` (null with `no_rate` true when the currency has no rate yet), `selling_price` (USD, net_usd plus markup), baggage and fare-condition fields, fare_type, seats_left, provider_ref, fare_key (flight numbers and dates of every segment plus cabin), expires_at, `picked` (chosen by the route's pick rule), status (new / published / dismissed), offer (null until published), created_at. A fare without a rate cannot be picked or published.
- **Offer** gains `source` (manual / gds), integration, route, provider_ref, fare_key, net_amount, net_currency, net_usd, rate, rate_date, fare_type and price_checked_at (all null for manual offers).
- **Tenant** (public) gains `monthly_search_allowance` (default 1500), edited by the owner on the platform.

Running a search
- "Search now" on a route takes a departure date range (at most 60 days, not in the past). Searches needed = matching departure dates × integrations; if that exceeds what is left of the allowance this month (Nairobi calendar month, summed over runs), it is refused with 409 naming both numbers.
- The run is a Celery task (`schema_name` first, as all tenant tasks): one search per date per integration, a provider error recorded and the run continuing. Each valid result is converted to USD at the run's date and stored as a Fare (status new). The pick rule then works in USD on the run's fares: filtered by the route's cabin, connections and airlines, de-duplicated by fare_key (the cheapest across integrations counts), per departure date; the chosen fares are marked picked.
- Fares are kept for 30 days for comparison (price history per route and date), then deleted by a daily task, except published ones.

Review and publish
- Publishing a Fare opens a dialog showing the original amount, its USD equivalent and rate date, and prefilled with the selling price in USD (editable), valid_until (default today + 7 days, never after departure) and public on. It creates a GDS offer with the itinerary, baggage, conditions and source fields (including the original amount and conversion), price_checked_at = the run's time. If an active offer with the same fare_key exists, publishing updates its price, net and conversion fields and price_checked_at instead.
- Dismissing hides the Fare.

API (agency admin)
- `admin/integrations` (list, create, PATCH name, mode, credentials and is_active), `admin/integrations/{id}/test`.
- `admin/routes` (list, create, PATCH), `admin/routes/{id}/search {date_from, date_to}` → the run; `admin/routes/{id}/runs`; `admin/search-usage` (allowance, used this month).
- `admin/fares?route=&run=&status=&picked=` grouped per departure date (latest run by default), with each fare's original amount, USD amount, rate date and selling price; `admin/fares/history?route=&departure_date=` the cheapest USD fare per run for that date; `admin/fares/{id}/publish {price, valid_until, is_public}`, `admin/fares/{id}/dismiss`.
- Admin offers return the source fields; public offers return `source` and `price_checked_at` only (never net amounts, rates or fare type).
- Platform: tenants return and accept `monthly_search_allowance` and return `searches_this_month`; `platform/exchange-rates` (list latest per currency, POST a manual rate).

Frontend
- Settings › Integrations: list (name, provider, mode, status, last test), "Add integration" dialog (provider, name, mode, access token), Test, Enable/Disable, replace credentials.
- A Routes tab (after Offers), shown only when the agency has an integration: table (route, trip and stay, cabin, last run, new fares), drawer with the route's settings (edit), "Search now" dialog (date range; shows searches needed and the allowance left), and recent runs with their errors.
- Fares screen for a route: Picked / All results switch and a run selector (latest by default); grouped by departure date, sorted by USD; each fare as a flight row (itinerary lines, airline badge, baggage summary) with the net amount in its original currency, its USD equivalent (rate date on hover), the selling price in USD, a "No rate" note where conversion failed, fare type, seats left, the integration, and Publish / Dismiss; published fares link to their offer. Per date, a small price history of the cheapest fare across recent runs.
- Admin Dashboard: a "New fares to review" tile when there are any.
- Customers see "Price checked <time ago>" on GDS offers in offer detail.
- Platform agency drawer: search allowance (editable) and searches used this month.

Tests
- Duffel mapping from recorded responses (one-way, return, connections, codeshare, bags, conditions, a non-USD currency), and every skip reason.
- Conversion: rounding, latest rate on or before a date, USD identity, no rate (fare stored, not pickable or publishable), stale rate, manual rate surviving the feed, the feed task from a mocked response; stored conversions unchanged when rates change.
- Every valid result stored; picking and de-duplication in USD across currencies; 30-day clean-up keeping published fares.
- Credentials encrypted at rest and never returned; test connection success and failure.
- Allowance arithmetic (weekdays, integrations, month boundary) and refusal; run continuing past a provider error.
- Filtering, de-duplication across integrations, pick rule, markup rounding; earlier new fares replaced.
- Publish creating an offer and updating one with the same fare_key; dismiss; public API hiding net price and fare type.
- Admin only; another agency's integrations, routes and fares invisible.
- Browser check at 390 px and 1280 px: add a Duffel test integration, create a route, search, publish a fare, find the offer on Explore, book it.

## 16. Step 36: Scheduled route searches and offer refresh

- Route gains a schedule (manual / daily / weekly with a weekday) and a date window: fixed (from, to) or rolling (from N to M days ahead, M − N ≤ 60), and `auto_publish` (default false). "Search now" uses the window.
- Beat, hourly, in every active agency: `run_due_route_searches` starts a run (trigger scheduled) for each active scheduled route not yet run today (daily) or this week on its weekday (weekly), after 02:00 Nairobi time. A run that would exceed the allowance is not started and is recorded as skipped with the reason.
- Refresh after every run, for the route's active GDS offers: a fare with the same fare_key updates net amount, currency and conversion, price (net in USD at the run's rate + markup; in review mode only when the admin has not edited the price since publishing) and price_checked_at. An offer not found: auto-publish deactivates it; review mode marks it "Not found in the last search" (`missing_since`) for the admin.
- Auto-publish routes publish picked fares at once with the defaults of step 35's dialog.
- At 80% of the allowance the admin sees a warning on the Routes screen; the platform dashboard shows searches used per agency this month.
- Tests: due-route selection with frozen time, rolling windows, skips over allowance, refresh updating, deactivating and flagging, edited prices left alone, auto-publish.

## 17. Step 37: Re-check a booking's fare

- Bookings copy `source`, integration and fare_key from their offer.
- `POST admin/bookings/{id}/recheck-fare` (requested bookings with a GDS source): searches the booking's dates through its integration (counts against the allowance) and returns the same fare_key's current original amount, its USD equivalent, selling price and segments, or "not found" with the cheapest alternatives on the same dates.
- The Confirm availability dialog gets "Re-check price", which fills the price, ticketing airline (shown read-only in the dialog) and segments from the answer; the existing changes flow does the rest.
- Tests: found, changed, not found, allowance, manual bookings refused.

## 18. Step 38: Second provider: Travelport

- Travelport's Universal API (the API its free 30-day trial covers) behind the same interface: low-fare search over its XML/SOAP endpoint with `httpx` and the standard library's XML parser, credentials (username, password, target branch) and test or live endpoint, request and response mapping into step 34's itinerary shape with the same skip rules, tests from recorded responses, and README notes on obtaining trial and production access. No other changes: routes, runs, fares and offers work across providers, and a route can search both at once.

## 19. Step 39: Mobile app: one shared app, agency from links or code

Goal: one "Azaria Bookings" app in the App Store and Google Play serves every agency's customers and admins. The app learns its agency from the link the customer is sent (or from a code typed in), stores it, and sends every API request to that agency. Branding stays shared, as everywhere else. The web app is unchanged: there the address still decides the agency. The platform app stays web only.

Industry conventions followed
- Links in emails are ordinary https links on the agency's address. They open the app when it is installed (iOS universal links, Android app links) and the web app otherwise. This needs the app to declare its domains at build time and each domain to serve a small verification file.
- No deferred deep linking (it needs a third-party service): a customer who installs the app after tapping a link taps it again, or types the agency code.
- One agency at a time on a device; switching agency signs out.

Agency address for apps
- Every agency is reachable at `<code>.<TENANT_BASE_DOMAIN>` (its code is its schema name with hyphens, as typed). App links only work on addresses the app declares, and it can declare `*.<TENANT_BASE_DOMAIN>` but not agencies' own custom domains, so **every link in agency emails uses that address**, even when the agency's primary domain is a custom one.

Backend
- `GET /api/agency` (public, agency hosts): `{code, name, app_address}`; the existing `no_tenant` and `tenant_suspended` answers apply.
- Verification files on every agency host, served by Django: `/.well-known/apple-app-site-association` (from `IOS_APP_ID`, Team ID plus bundle id) and `/.well-known/assetlinks.json` (from `ANDROID_PACKAGE` and `ANDROID_CERT_FINGERPRINTS`). New `.env` settings, all optional; with them unset the files answer 404. In production the reverse proxy sends `/.well-known/` to the API.
- A welcome email on registration, `send_welcome_email(user_id)`, HTML plus text like the others, active users only: welcome to <agency>, a link to the agency's site, and "Get the app" (the agency's `/app` link) with the agency code. The admin-created customers' set-password email gains the same "Get the app" lines.
- `FRONTEND_URL`'s `{domain}` becomes the agency's app address (above) for every email link.

App (native only, the web build is unchanged)
- New settings: `EXPO_PUBLIC_TENANT_BASE_DOMAIN` (e.g. `azariabookings.com`), `EXPO_PUBLIC_APP_STORE_URL` and `EXPO_PUBLIC_PLAY_STORE_URL`. In `EXPO_PUBLIC_API_URL`, `{host}` is replaced by the stored agency's address on native.
- The agency (code and name) is stored in secure storage with the sign-in tokens.
- **First launch, no agency:** a "Find your agency" screen: the agency code, checked with `GET /api/agency` on that address, then a confirmation card with the agency's name and Continue. Clear messages for an unknown code and for a suspended agency. Below: "Got an email from your agency? Tap its link."
- **Opening a link** to `https://<code>.<base>/...` (or the app scheme, below):
  - no agency stored: check and store it, then open the link's screen;
  - same agency: open the link's screen; for a password reset or set-password link while signed in, first ask "Sign out and continue?" (Sign out / Cancel);
  - another agency: ask "This link is for <B>. You're using <A>. Switch to <B>? You'll be signed out." (Switch / Cancel). Switch signs out, clears the stored tokens, stores B and opens the link's screen; Cancel stays where the user was.
  - a link to the root host or an unknown agency is ignored with a short message.
- "Switch agency" in the account menu (customers and admins): signs out and returns to Find your agency.
- `app.json` / `app.config.ts`: the app scheme `azaria`, iOS `associatedDomains` `applinks:*.<base>`, Android intent filters with `autoVerify` for `*.<base>`, bundle id and package from config. Check against the Expo SDK 58 docs before writing them.

Web
- `/app` on an agency's site: a page with the agency's name and code, App Store and Google Play buttons, "Already installed? Open in the app" (the `azaria://open?agency=<code>` scheme link, for browsers that do not hand https links to the app), and "After installing, tap the link in your email again."
- Every agency site shows a "Get the app" link (account menu and footer of the public pages) to `/app`.

Tests
- `GET /api/agency` (active, suspended, root host); the verification files with and without settings; email links using the app address for an agency with a custom primary domain; the welcome email on registration (and none for admin-created users, who get the set-password email with the app lines).
- Frontend: type-check and web export; the web build never shows Find your agency.
- Device check, done by the user (cannot run here): iOS and Android builds; first launch with a code; a link before and after install; a link to another agency (Switch and Cancel); a reset link while signed in; Switch agency from the menu; API calls going to the right agency.
