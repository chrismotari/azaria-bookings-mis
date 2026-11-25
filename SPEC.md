# Azaria Bookings — Specification

A multitenant SaaS for small and medium-sized travel agencies. Each agency (tenant) gets its own site and data, and buys any of three modules, which the system owner switches on per agency (§25): **flights** (its admin lists flight deals, anyone can browse them, and registered customers request options or book; the admin confirms availability, the customer pays outside the system, the admin marks the booking paid, uploads boarding passes and sends them by email, and the customer can also open them in the app), **tours** and **hotels**. The platform's system owner manages agencies, their modules, plans and invoices on the root host.

Many integrations are still to come, so much of the work is done by hand for now: bookings and invoices are paid outside the system and marked paid manually, and booking and ticketing happen in the agent's own GDS. Offers are entered by the admin, or found by searching the agency's routes (by hand or on a schedule) through its fare providers and published after review or automatically; later searches keep published offers' prices up to date.

An agency may connect any fare provider of its choosing (Duffel, Travelport, Sabre or Amadeus for now), several at the same time, or none: the system works fully without one.

Planned (not yet specified or built):
- Payment integrations, replacing the manual "mark paid" steps.

This document describes the system as it stands. Work is delivered in the numbered steps at the end; new steps are appended there.

## 1. Rules

- PostgreSQL only (development, tests, production). No Docker; PostgreSQL and Redis run locally.
- No TODOs, stubs, placeholder code, mock data, or unused fields, endpoints, models or dependencies.
- Out of scope until specified in a step: payment processing, and booking or ticketing through GDS or airline APIs (providers are used for fare searches only). Out of scope: passenger details, push notifications, email verification, re-sending passes after completion, multi-currency for bookings, multi-language, social login, reviews, packages, blog.
- Agency prices (offers, bookings) are USD, defined once as `CURRENCY`; no currency column on them. Platform prices use `PLATFORM_CURRENCY`. Fares from providers keep their original currency and are converted to USD for every calculation and comparison; customers only ever see USD.
- Time zone Africa/Nairobi, `USE_TZ = True`; all user-facing times are Nairobi time, except flight times, which are the local times of the airport concerned (stored as date and time with no time zone).
- "Admin" is the agency owner's in-app role (`User.role == "admin"`). Django's admin site is technical support only, mounted at `/django-admin/` for superusers. Never mix the two.
- Every model's primary key is a UUID (`default=uuid.uuid4`), and so is every id in URLs and API bodies. Only Django's framework tables keep numeric keys. Airports are identified by IATA code in the API. A malformed id returns 404.
- Web first: when web and native conflict, choose web. The app must compile for native but is verified in the browser.
- Files: preview first. Anything the browser can display (PDF, PNG, JPEG, WebP, GIF) opens in a new tab ("Open", "Open PDF"); only other files download, and a blocked tab falls back to download.
- Ambiguities: pick the simplest option and add one line to DECISIONS.md.

## 2. Stack and configuration

- Backend: Django, DRF, Simple JWT (access 30 min, refresh 7 days), django-filter, django-cors-headers, django-environ, django-tenants, Celery + Redis (broker and results, `task_acks_late`, JSON, beat schedule in settings), fpdf2 (invoice PDFs), nh3 (HTML sanitizing), Pillow, httpx (fare providers and the rate feed; Travelport's XML is read with the standard library's parser), cryptography (Fernet, provider credentials). Tests: pytest, pytest-django, freezegun; external APIs through httpx's mock transport, never the network.
- Settings from `backend/.env`: `SECRET_KEY`, `DEBUG`, `DATABASE_URL`, `REDIS_URL`, `ALLOWED_HOSTS`, `TENANT_BASE_DOMAIN`, `CORS_ALLOWED_ORIGIN_REGEXES`, `FRONTEND_URL` (with `{domain}`: the agency's app address), `NUM_PROXIES`, `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `ADMIN_EMAIL`, `PLATFORM_CURRENCY`, `INTEGRATIONS_KEY` (Fernet key), `EXCHANGE_RATES_URL` (default the free ExchangeRate-API USD feed), and optionally `IOS_APP_ID`, `ANDROID_PACKAGE`, `ANDROID_CERT_FINGERPRINTS` (the mobile app's link verification files).
- Email: console when `EMAIL_HOST` is empty, SMTP otherwise, locmem in tests.
- DRF: page size 20, JSON (multipart only for uploads), register/login/password-reset throttled at 10/min per IP, Django password validators on registration and reset. Errors use DRF's format; invalid booking transitions return 409.
- Private storage (`backend/private_media/`, never served by URL) for boarding passes, invoice PDFs and chat attachments; stored names are random UUIDs plus extension. Public storage (`backend/media/`, served at `/media/`) for airline logos only.
- Frontend: Expo + TypeScript with react-native-web, React Navigation (every screen has a browser URL), TanStack Query, axios, react-hook-form + zod, expo-secure-store (native tokens), @expo/vector-icons (Ionicons), react-native-svg (+ transformer for native flags), TipTap (web rich text). `EXPO_PUBLIC_API_URL` may contain `{host}`, replaced by the page's hostname (on native: the stored agency's address); `EXPO_PUBLIC_PLATFORM_HOST` names the root host; `EXPO_PUBLIC_TENANT_BASE_DOMAIN`, `EXPO_PUBLIC_APP_STORE_URL` and `EXPO_PUBLIC_PLAY_STORE_URL` serve the mobile app (§19).

## 3. Multitenancy

- One PostgreSQL schema per agency (django-tenants), chosen by hostname. Agency: `<schema>.<TENANT_BASE_DOMAIN>` (its primary domain); extra domains can be added.
- Public schema = the platform: apps `tenants`, `airports`, `airlines`, `rates`, `accounts` (system owner accounts), `support` (platform desk). Agency schemas: `accounts`, `catalog`, `requests`, `bookings`, `core`, `support`, `integrations`. The same email may hold separate accounts at different agencies.
- Root host: the platform's API (`/api/platform/`) and `/django-admin/`. Any other `/api/` path there, or any unknown host, returns 404 `{"code": "no_tenant"}`.
- Suspended agency (`is_active` false): every `/api/` call returns 403 `tenant_suspended` (non-payment message names the billing contact email); its scheduled jobs and emails are skipped. Agencies are never deleted.
- Schema names: 3–30 lowercase letters, digits, hyphens, starting with a letter; reserved `public`, `www`, `api`, `admin`, `app-admin`. Hyphens become underscores in the schema, not in the domain.
- JWTs carry a tenant claim; a token is refused (401) at any other tenant. Email links (reset links included) use the agency's app address `<code>.<TENANT_BASE_DOMAIN>` (code: the schema name with hyphens); reset links are invalid at other agencies.
- Celery tasks touching agency data take `schema_name` first, run in that schema, and skip missing or inactive agencies. Beat tasks run their job in every active agency in turn; one agency's error is logged and does not stop the rest.
- `tenants.services.create_agency` (used by the platform app, `/django-admin/` and `manage.py create_agency`) validates the name, creates tenant, schema, primary domain and first admin, sets the notification email, and leaves nothing behind on failure.

## 4. Data model

Shared (public schema)
- **Tenant**: name, schema_name, is_active, created_at, billing_email, suspension_reason (blank / manual / non_payment), suspended_at, monthly_search_allowance (1500; fare searches per Nairobi calendar month, edited by the owner), theme (FK Theme, protected, required; an active theme or the one it already has). **Domain**: domain, tenant, is_primary.
- **Theme**: name (unique, ≤ 40), primary and accent (`#rrggbb`, lowercase), is_active, is_default, created_at. Exactly one default, which is active; never deleted. The tint (primary 9% over white), hover (white 12% over the primary), white text on the primary and #252525 on the accent are derived (`tenants/themes.py`). Every create and change passes the WCAG contrast rules: the primary at least 4.5:1 against white, its tint and the background #f2f4f7; the accent at least 4.5:1 against #252525 (400 naming the rule and ratio). Eight starting themes, Indigo & Amber (Azaria's colours) the default (§24).
- **Airport**: code (IATA, unique), name, city, country, country_code (ISO alpha-2). `seed_airports` loads OurAirports data (IATA code, scheduled service, not closed), idempotent.
- **Airline**: iata_code (unique, 2 chars), icao_code, name, country, is_active, logo (PNG/JPEG/WebP ≤ 200 KB, content-checked; old file deleted on replace/remove), updated_at. `seed_airlines` adds missing active airlines from OpenFlights data (one per IATA code, preferring one with ICAO) and never changes existing rows. Curated by the owner in `/django-admin/`; never deleted.
- **ExchangeRate**: currency (ISO 4217), units_per_usd (8 decimals), date, source (feed / manual), fetched_at; one row per currency per date; USD is always 1 and has no rows. `rates.convert(amount, currency, on)` gives the USD amount (÷ rate, half-up to the cent), the rate and its date, from the latest rate on or before `on`; no rate raises, a rate more than 3 days older is used but reported stale. Stored conversions keep their rate and rate date.
- **PlatformSettings** (single row): issuer_details, payment_instructions, invoice_due_days (14), invoice_lead_days (7), billing_contact_email, support_email.
- **Plan**: name, kind (subscription / support), description (sanitized rich HTML ≤ 5,000 chars), tag (blank / recommended / basic / advanced; subscription plans only, each tag on at most one plan, cleared on deactivation), monthly_price, annual_price (at least one), is_active, created_at. Never deleted.
- **Subscription**: tenant, plan, kind, billing_cycle (monthly / annual, plan must have that price), started_on, next_period_start, ended_on, created_at. At most one running per kind per agency. Plan/cycle changes apply from the next invoice.
- **Invoice**: number (`INV-<year>-<0001>`), tenant, subscription, plan_name, billing_cycle, period_start, period_end, amount (copied at issue), issued_on, due_on, status (unpaid / paid / void), paid_on, suspension_waived, pdf (private, `invoices/<schema>/`), created_at.

Per agency
- **User**: email login (unique), full_name, phone, role (customer / admin), is_active, date_joined (set on creation; null for users created before step 41). Registration creates customers only; admins via `create_agency` or `create_admin`.
- **AppSettings** (single row): payment_instructions, payment_hold_hours (24), reminder_hours_before (4), admin_notification_email.
- **Offer**: trip_type (one_way / return), origin, destination (Airport), departure_date, return_date (null for one-way), ticket_class (economy / premium_economy / business / first), price (per person; for a return, the round trip), airline (the ticketing airline; active on create/change), baggage per passenger (checked_bags 0–3, checked_bag_kg and cabin_bag_kg, null = not stated), refund_policy and change_policy (not_allowed / with_fee / free), valid_until, is_public, is_active, created_at; source (manual / gds) and, for GDS offers only (null otherwise), integration, route, provider_ref, fare_key, net_amount, net_currency, net_usd, rate, rate_date, fare_type, price_checked_at, price_edited (the admin changed the price since publishing), missing_since (review-mode routes: not found by searches since then). Origin, destination, departure_date and return_date are derived from the segments. Validation: price > 0, valid_until ≤ departure_date and ≥ today on create. Bookable = active, valid_until ≥ today, departure ≥ today. Non-public offers exist only for one customer's request responses. Never deleted.
- **OfferSegment / BookingSegment**: one flight each: direction (outbound / return), position (from 1 within a direction), airline (marketing carrier), flight_number (1–4 digits and an optional letter), operating_airline (codeshares only), origin, destination, departure and arrival date and time (local). Per direction 1–5 segments, chained airport to airport, each leaving after the previous one lands, arrival date one day before to two days after departure; the outbound flights end elsewhere than they start; one-way offers have no return segments; return segments go back from the destination to the origin and leave after the outbound ones land. Active airlines on create or change. Connections are derived between consecutive segments: airport, wait in minutes and kind (layover < 24 h ≤ stopover). Bookings copy the offer's segments, trip type, return date, baggage and fare conditions at creation.
- **Query** (request for options): user, origin, destination (one required), date_from, date_to, trip_type (blank = any, one_way, return), return_date (return only), price_min, price_max, ticket_class, max_stopovers, message, status (open / responded / closed). **QueryResponse**: query, message, offers (M2M), created_at; creating one marks the query responded.
- **Booking**: user, offer, airline (the ticketing airline, copied from the offer; confirming with changes may change it), query, passenger_count (1–9), notes, unit_price (copied), source, integration and fare_key (copied; null for manual offers), status, payment_deadline, reminder_sent_at, trip fields and segments copied from the offer, changes (JSON of old/new unit_price, airline and segments, null when none), changes_accepted, alternatives (Query of suggested options), created_at. Total = unit_price × passengers. No second active (requested / confirmed / paid) booking per user per offer.
- **BookingEvent**: booking, from_status, to_status, actor (null = system), created_at. Written on creation and every change.
- **Integration** (fare provider): provider (duffel / travelport / sabre / amadeus), name, mode (test / live), credentials (Fernet-encrypted JSON of the provider's fields, never returned), is_active, last_tested_at, last_test_ok, last_test_message, created_at. Several per agency; disabled, never deleted.
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
- Sabre (REST, Bargain Finder Max v5, grouped itinerary response): `POST /v5/offers/shop` on the certification host in test mode, production in live, with a bearer token from `POST /v2/auth/token` (client id `V1:<user id>:<PCC>:<domain>` and password, each base64-encoded, joined and encoded again), taken once per provider instance. Credentials: user id, password, pseudo city code, domain. The PCC in the point of sale, one adult, an origin–destination per direction, the cabin only, max connections as the most stops when set, penalty information asked for. Legs → directions, schedules with marketing and operating carriers and local times (the leg's date plus day adjustments; technical stops ignored), the validating carrier → ticketing airline, checked allowances → `checked_bags` and weight, refund and exchange penalties before departure → policies, fare type unknown, the fewest seats available → seats left, the last ticketing date and time → expiry. An HTTP error, or error messages with no itineraries, is a provider error. Test connection takes a token.
- Amadeus (REST, Flight Offers Search v2): `POST /v2/shopping/flight-offers` with `X-HTTP-Method-Override: GET` on `test.api.amadeus.com` in test mode, `api.amadeus.com` in live, with a bearer token from `POST /v1/security/oauth2/token` (client credentials), taken once per provider instance. Credentials: API key, API secret. One adult, an origin–destination per direction, GDS sources, the cabin on all segments, max connections (at most 2) when set. Itineraries → directions, segments with marketing and operating carriers and local times (technical stops ignored), the grand total, the first validating airline → ticketing airline, included checked bags → `checked_bags` and weight, policies not allowed (not stated), negotiated or corporate → private and published → public, bookable seats → seats left, the last ticketing date → expiry. An HTTP error is a provider error. Test connection takes a token.
- Search now: the route's window from today on (a rolling window counted from today, a fixed one without its past days); needed = matching weekdays × the route's active integrations; refused with 409 naming both numbers when more than what is left of the month's allowance (summed `searches_made`, Nairobi month), and with 409 when the window has passed, no date falls on the weekdays or there is no active integration. The run is a tenant Celery task: one search per date per integration, a provider error recorded and the run going on; failed when every search failed.
- Scheduled: hourly, from 02:00 Nairobi time, each active daily route without a scheduled run today and each active weekly route on its weekday without one this week gets a run (trigger scheduled) over its window. One that cannot start (over the allowance, or nothing to search) is recorded as a skipped run with the reason, which counts as that day's or week's run.
- A result is skipped (and counted in the run's errors) when an airline or airport is not in the shared tables or it breaks the itinerary rules for the route; every other result is stored, converted at the run's date.
- Picking, per run: the route's cabin, connections and airlines; one fare per fare_key (the cheapest in USD across integrations); per departure date the `max_per_date` cheapest and/or the cheapest direct. Earlier new fares for the same dates stop being picked (kept for price history). Fares without a rate are never picked or published.
- Publish: a GDS offer from the fare (itinerary, baggage, conditions, source fields, price_checked_at = the run's end) with the admin's price, valid_until (≤ departure, ≥ today) and visibility; an active offer with the same fare_key gets the new price, net and conversion fields and price_checked_at instead (and is no longer missing or edited). Only new fares are published; dismissing hides one (published ones cannot be). Changing a GDS offer's price in the admin's offer form marks it edited.
- Refresh, after every run that is not failed: the route's active GDS offers departing on a date at least one search answered for. One found (a fare with its fare_key, the cheapest in USD) gets the fare's net amount, currency and conversion, the selling price (net USD at the run's rate + markup; on a review-mode route only while not edited) and price_checked_at = the run's end, and is no longer missing; a fare without a rate only clears missing. One not found is deactivated on an auto-publish route, otherwise marked missing (`missing_since`, kept from the first search that missed it).
- Auto-publish routes then publish the run's picked new fares as the publish dialog would: selling price, valid until today + 7 days (at most the departure), public. A fare that cannot be published is noted in the run's errors.
- Booking re-check: one search of the booking's departure and return dates, route, cabin and trip type, with at most as many connections as the booking has; results pass the same skip rules against the booking's route. Refused with 409 for manual bookings, any status but requested, a disabled integration or no search left (naming both numbers); a provider error answers 502 with its message and the search still counts.

## 6. Emails

HTML (one base layout, table-based, inline CSS, no images; an agency's emails in its theme's colours, the platform's in Azaria's own) plus plain-text fallback, via `EmailMultiAlternatives`. Emails about a booking show its itinerary per direction (flight numbers, local times, connections), baggage and fare conditions. Tasks take ids only, retry with backoff (max 5), and reload and re-check state before sending.

- Agency admin: new request, new booking, new support message.
- Customer: request responded, availability confirmed (payment instructions, deadline, any changes), unavailable (with suggestions link if any), payment received, booking expired, payment reminder, boarding passes (all files attached), password reset, welcome on registration (site link, "Get the app" with the agency code), account created (set-password link and "Get the app"), support reply.
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
- Public: `agency` (`{code, name, app_address, theme}`; a theme is `{id, name, colors: {primary, primary_text, primary_tint, primary_hover, accent, accent_text}}`), `auth/register`, `auth/login`, `auth/refresh`, `auth/password-reset`, `auth/password-reset-confirm` (same response for unknown emails); `airports?search=` (exact code first, ≤ 20); `offers` (filters: origin/destination text, date range, trip_type, return date range, price range, class, max_stopovers counted in the busier direction; ordering) and `offers/{id}`; `POST support/chats`.
- Signed in: `auth/me`; `queries` (+ `close`); `bookings` (+ `cancel`, `accept-changes`, `decline-changes`); `boarding-passes/{id}/download` (admin, or customer once completed); `support/chats`, `support/chats/{id}` (+ `messages`), `support/unread`, `support/attachments/{id}`.
- Offers (public, admin, nested in responses and bookings) return `source` and `price_checked_at` (never net amounts, rates or fare type outside the admin API), the trip fields and `itinerary`: `{outbound, return}`, each direction with its segments (nested airlines and airports), connections and stop_count; return is null for one-way. Admin create/edit and custom offers take `segments` as one ordered list; an edit with segments replaces them all. Bookings return their own trip fields and itinerary.
- Offer visibility for customers: public and active, or attached to a response to one of their queries (detail and booking only).
- Admin (`/api/admin/`, `IsAdminRole`): `dashboard`, `offers`, `queries` (+ `respond`), `bookings` (create for a customer, + `confirm-availability`, `recheck-fare`, `mark-unavailable`, `mark-paid`, `complete`, `boarding-passes`), `boarding-passes/{id}` (delete), `settings` (+ `theme`, its id, saved on the agency), `themes` (active, default first, then by name), `users` (customers, or `?role=admin` the agency's admins; returns `role`; deactivate instead of delete, never your own account; `password-reset` emails an active user the reset link; `make-admin` promotes an active customer), `airlines?search=`, `chats` (+ `unread`, `{id}`, `messages`, `close`), `plans`, `billing`, `billing/invoices` (+ `pdf`); and `support/platform-chats` (+ `unread`, `{id}`, `messages`), `support/platform-attachments/{id}`. Admin offers also return the GDS source fields and `missing_since`; admin bookings return `source`, `integration` ({id, name}) and `fare_key`; `recheck-fare` returns `{found, fare, alternatives}`, each fare with its original amount and currency, net_usd, rate, rate_date, no_rate, selling_price, `segments` (the confirm-availability input shape) and `itinerary`; the dashboard returns `new_fares` (picked, new) and the step 41 figures (§21).
- Fare searches (admin): `integrations` (list, create with `credentials`, PATCH name, mode, credentials, is_active; never returns credentials) and `integrations/{id}/test`; `routes` (list, create, PATCH; each with its schedule, window, auto_publish, last run and new fares), `routes/{id}/search` (over the window) → the run, `routes/{id}/runs` (booking re-checks included); `search-usage` (allowance, used, left); `fares?route=&run=&status=&picked=` (`{run, dates: [{departure_date, fares}]}`, latest run not skipped or a re-check by default, dismissed only when asked, sorted by USD; each fare with its itinerary as offers return it), `fares/history?route=&departure_date=` (cheapest USD fare per run), `fares/{id}/publish {price, valid_until, is_public}`, `fares/{id}/dismiss`.

Root host, `/api/platform/`: `login`, `refresh`, `me` (active public-schema superusers only), `dashboard`, `public-plans` and `support/chats` (open), `support/attachments/{id}`, `chats` (+ `unread`, `{id}`, `messages`, `close`), `themes` (with inactive ones, each with `is_active`, `is_default`, `agency_count`; create; PATCH name, primary, accent, is_active; + `make-default`, active themes only), `tenants` (+ `domains`, `make-primary`, `subscriptions`, `admins` (list; PATCH `{is_active}` suspends or restores; `password-reset` emails the agency's reset link, 409 while the admin or agency is suspended)), `plans`, `subscriptions/{id}` (+ `end`, `issue-invoice`), `invoices` (filters tenant, status, overdue; + `mark-paid`, `mark-unpaid`, `void`, `resend`, `pdf`), `settings`, `exchange-rates` (latest per currency with `stale`; POST `{currency, units_per_usd}` sets today's manual rate). Tenants return and accept `monthly_search_allowance` and `theme` (its id; the default when left out on create) and return `searches_this_month`; the dashboard returns `fare_searches` (this month's searches and allowance of each agency that made any, most first).

## 11. Frontend

Look and layout
- Colours only as tokens in `src/theme.ts`, read while rendering and in `createStyles` style sheets, never into constants: primary and accent (with the primary's tint and hover) come from the agency's theme, applied before the first screen (§24); Azaria's own primary indigo #1800d2 and amber #ffb400 (prices and main calls to action, dark text) wherever there is no agency (platform app, web loading state, mobile Find your agency). The rest is the same in every theme: slate green #4a6660, neutrals (#252525, #2d3434, #6c7171, #a8b1b5, background #f2f4f7, surface #fff), status (success #51d77a, warning #faba2f, danger #fe455f, info #2275ff) with AA-contrast chip tints. Typography scale 28/22/18/15/13/12, system font.
- Wide (≥ 900 px): indigo top bar with brand, nav items with icons, account menu (initials). Narrow: slim top bar plus bottom tabs; with more than five tabs, four stay in the bar and the rest go under a "More" tab (a menu carrying their badges). No horizontal scrolling at 390 or 1280 px.
- List → detail on wide screens: the list shrinks to a slim, collapsible rail on the left (one short identifier and one time per row, see §20) and the detail fills the rest, with its own URL (no history entries; Escape closes); full screen on narrow. Forms that start new work (Book, Request options, New offer, Respond) are full pages; short tasks use a shared Dialog (small/large, focus-managed, full screen on phones).
- Every list has loading, empty and error states; zod mirrors server validation; dates via a web date input; uploads and file opening are web only.
- Airline badge: logo or initials in the same fixed square frame. Country flags (bundled flag-icons SVGs) only in airport pickers, offer detail header and connection rows, decorative.
- Compact route lines show "NBO → LHR" for one-way and "NBO ⇄ LHR" for return trips, with both dates.
- Auth gate: login-required actions store the intended action in memory, send the guest to Login/Register, then resume it.

Agency app
- Guests: Explore (hero search bar with Any / Return / One way, swap, departure and return date ranges and class; filter sidebar or panel; sort tabs; flight result rows with one line of local times per direction and a baggage summary; empty state with "Request options") and offer detail (route header, an itinerary card per direction with connections, baggage and fare conditions, price card, Book with both directions, passenger stepper and live total).
- Customers: Requests (criteria including trip type and return date, responses with offers), Bookings (trip cards; itinerary, baggage and conditions cards; progress tracker or terminal banner; payment box with countdown; changes box to accept or decline; suggested options; boarding passes), Account (+ Support).
- Admins: Dashboard (action tiles; "New fares to review" when there are any; sales figures and a 12-month chart, coming up (payment deadlines and departures), top routes, customers, offers and searches, overdue invoice tile; see §21), Offers (table, form with One way / Return, a segment editor per direction with live connections, baggage and fare conditions; "Not found in the last search" chip and a note in the drawer for missing GDS offers), Routes (only once the agency has an integration: a warning once 80% of the month's searches are used; table with trip and stay, cabin and schedule, last run and new fares; drawer with Search now (the window's dates, searches needed against what is left), recent runs (scheduled or by whom, skipped ones with the reason, booking re-checks marked) with their errors, and the route's settings including departures (days ahead or fixed dates), scheduled search (manual / daily / weekly and day) and publishing (review or automatic); New route dialog), Fares for a route (Picked / All results, run selector, grouped by departure date with a price history per date; flight rows with the original amount, its USD equivalent and rate date, selling price, "No rate" note, fare type, seats left and integration; Publish dialog and Dismiss; published fares link to their offer), Requests (Respond), Bookings (status tabs, action bar, confirm-with-changes (price and flights) and mark-unavailable dialogs, pass upload and send, New booking dialog; on requested GDS bookings the confirm dialog's "Re-check price" fills the price and flights from the answer, shows the original amount, USD equivalent, rate date and selling price, and when not found lists the alternatives, each with "Use these flights"), Users (System admins button for the admins list; drawer with Send reset link, Make admin for customers, Deactivate except on your own account), Chats, Settings (app settings, Integrations (add with the provider's credentials: Duffel's access token, Travelport's username, password and target branch, Sabre's user id, password, pseudo city code and domain, or Amadeus's API key and secret; test, enable/disable, replace credentials), Billing with Compare plans, Support, and a Theme card: active themes by name, a preview of the selected one, Save, which re-renders the admin's own app in it (the web page reloads)).
- Offer detail shows "Price checked <time ago>" on GDS offers.
- `no_tenant` / `tenant_suspended` responses show a full-page message.

Platform app (root host, web only)
- Public: home (short introduction, See pricing) and `/pricing` with a slim public bar. `/login`, `/admin` and `admin.<root host>` lead to sign-in; nothing on the public pages links to it.
- Owner: Dashboard (agency counts, revenue, monthly recurring, outstanding/overdue, 12-month bar chart in plain views, agencies per plan, needs attention, fare searches this month per agency against its allowance), Agencies (table; New agency dialog with a Theme dropdown (active themes, the default preselected) and preview; each agency opens beside the slim rail (`/agencies/<id>`) with agency (name, address, its theme with preview, changeable), admins (suspend/restore, send a password reset link), domains, plan & billing, fare searches (used this month, editable allowance)), Plans (kind tabs, tag column, rich-text dialog, link to pricing), Invoices (filters, drawer actions behind confirm dialogs), Chats, Settings (billing and support; Themes: table of swatches, name, agencies using it, Default and Active/Inactive chips, New theme, a create/edit dialog with hex fields, the browser's colour picker, live preview and the four contrast checks (Save disabled while one fails), Make default and Deactivate/Activate; and Exchange rates: latest rate per currency with date, source and stale warning, a manual rate for today, the feed's credit).
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
39. Mobile app: one shared app, agency from links or code (see §19).
40. Detail pages with a slim list rail (see §20).
41. Agency dashboard (see §21).
42. Third provider: Sabre (see §22).
43. Fourth provider: Amadeus (see §23).
44. Agency themes (see §24).
45. Modules: flights, tours and hotels per agency (see §25).

Pending (not yet built):

46. Tours (see §26).
47. Flight passenger details (see §27).
48. Hotels (see §28).
49. Dashboard and Explore across modules (see §29).

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
- Platform agency page: search allowance (editable) and searches used this month.

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

Goal: one "Azaria Bookings" app in the App Store and Google Play serves every agency's customers and admins. The app learns its agency from the link the customer is sent (or from a code typed in), stores it, and sends every API request to that agency. It takes the colours of the agency it is set to (§24). The web app is unchanged: there the address still decides the agency. The platform app stays web only.

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

## 20. Step 40: Detail pages with a slim list rail

Goal: when an item is open on a wide screen, the detail takes most of the page. The list stays beside it as a slim rail on the left with only what is needed to find an item, and the rail can be collapsed. Narrow screens are unchanged (the detail stays full screen with the back link). Frontend only, in the shared `DetailLayout`; no API changes.

Wide screens (≥ 900 px), nothing open
- The full list as today: title, intro, filters, tabs, table or cards, pagination.

Wide screens, an item open
- **Rail** (left, 280 px, surface background, right border): a header with the list's title (e.g. "Chats") and a collapse button («); below it the rows of the page currently loaded, with the current filter and status tab kept but not shown; at the bottom a compact pager (‹ page n of m ›) when there is more than one page.
- **Rail rows**: two lines, no chips, cards, icons or columns. Line 1 is the identifier, line 2 the time (muted, 13 px), both one line with ellipsis. The open item is highlighted (indigo left edge and light tint, `aria-current`); unread chats have a bold line 1. Each row is a link; its accessible label also carries the status.
- **Rows per screen:**

| Screen | Line 1 | Line 2 |
|---|---|---|
| Chats (agency and platform desks) | requester email | last message time |
| Support (customer and agency) | subject | last message time |
| Bookings (customer) | route line | departure date |
| Requests (customer) | route line | sent date |
| Admin Bookings | customer email | booked time |
| Admin Requests | customer email | received time |
| Offers | route line | departure date |
| Routes | route line | last run time ("Never run") |
| Users | email | name |
| Invoices (platform) | invoice number | due date |
| Agencies (platform) | agency name | joined date |
| Explore | route line | departure date |

- **Detail**: fills the rest of the width. It no longer slides in or overlaps; it keeps its header with the title and ✕, its own scrolling and its URL. Escape and ✕ close it and bring the full list back with its filters, page and scroll position.
- **Escape** closes the detail on every list screen, whether the page was opened from the list or straight from its URL, and wherever the focus is (a text field in the detail included), except while a dialog or menu is open, where Escape closes only that.
- **Not found and errors stay in the detail.** An id that does not exist (or is not visible to this user) shows a "<Item> not found" empty state with "Back to <list>" inside the detail pane; the rail, top bar and navigation stay. Other errors show the error with Try again in the same place. Server wording such as "No Conversation matches the given query." is never shown.
- **Platform Agencies** joins this layout: an agency opens beside the slim rail (`/agencies/<id>` kept) instead of as a separate full page, so Escape and not-found work as above.
- **Collapse**: « collapses the rail to a 44 px strip holding only an expand button (») with the label "Show list"; the detail then takes the full width. The choice is remembered for the session across all list screens (in memory) and both buttons are keyboard reachable with labels "Hide list" / "Show list".
- Switching between items keeps the rail's scroll position.

Tests
- Frontend: type-check, lint, format check and web export.
- Browser check at 1280 px on Chats, Admin Bookings, Explore and platform Agencies: open an item, check the rail rows, switch items, collapse and expand, Escape back to the full list with its filter and page kept (also after loading a detail URL directly and with the focus in a text field); a made-up id shows not found inside the detail only; at 390 px the detail is still full screen.

## 21. Step 41: Agency dashboard

Goal: the agency admin's dashboard shows how the business is doing and what is coming up, at the level of detail the platform dashboard gives the owner, built from the same pieces (stat cards, the plain 12-month bar chart, list cards). Every figure is the agency's own data. Money is in USD, the agency's selling currency.

Definitions
- **A sale** is a booking that reached Paid (status Paid or Completed). Its amount is the booking's total (unit price × passengers); its date is when it was marked paid (its Paid timeline event), in Nairobi time.
- Months and "today" are Nairobi calendar months and days.

API: `GET /api/admin/dashboard` keeps its current fields and adds:
- `sales`: `{this_month, this_year, all_time}` amounts and `{count_this_month}`.
- `sales_by_month`: the last 12 months, oldest first, `{month: "YYYY-MM", total, count}`.
- `payments_due`: bookings Awaiting payment whose deadline is within the next 48 hours, soonest first, at most 5: `{id, customer (name, email), route (origin and destination codes, trip type), total, payment_deadline}`.
- `departures`: Paid and Completed bookings departing in the next 7 days (outbound date), soonest first, at most 5: `{id, customer, route, departure_date, passenger_count, boarding_passes_sent}`.
- `top_routes`: this year's sales grouped by origin, destination and trip type, most sales first, at most 5: `{origin, destination, trip_type, count, total}`.
- `customers`: `{total, new_this_month}` (active customers; new = registered or added this month).
- `offers`: `{bookable, public_bookable, expiring_soon}` (expiring soon: bookable offers whose valid until is within the next 7 days).
- `searches`: `{used, allowance}` this month, or null when the agency has no integration.
- `overdue_invoice`: the same object the Billing screen gets (`number, amount, currency, due_on, suspends_on`), or null.

Screen (Admins › Dashboard), top to bottom; two columns from 900 px where noted, one column on phones
- Title and greeting as today.
- **Needs action**: today's tiles (Bookings to confirm, Paid boarding pass due, Open requests, Awaiting payment, New fares to review), led by an emphasised "Overdue invoice" tile when there is one (amount, number and due date, the suspension date, "View billing"); the app-wide overdue banner stays as it is.
- **Sales**: stat cards for This month (with the number of bookings), This year and All time.
- **Sales by month**: the 12-month bar chart in plain views, as on the platform dashboard: month labels, and each bar's amount and number of bookings in its accessible label.
- Two columns: **Coming up** (two lists: "Payments due in 48 hours", each with customer, route, amount and time left; "Departing this week", each with customer, route, date, passengers and a "Passes not sent" chip when none were sent; empty lines "Nothing due" / "No departures this week"; rows open the booking) and **Top routes this year** (route line, bookings, sales; empty: "No sales this year yet").
- Two columns: **Customers** (total, new this month; links to Users) and **Offers and searches** (bookable offers and how many are public, "N expire within 7 days" linking to Offers; when there is an integration, searches used this month against the allowance as a bar, warning colour from 80%, linking to Routes).
- Every section has loading and error states through the one dashboard request, and the screen works at 390 px with no horizontal scrolling.

Tests
- Backend: each figure against bookings in every status (only Paid and Completed count as sales; dated by their Paid event, including month and year edges in Nairobi time); the 48-hour and 7-day windows at their edges; the five-item limits and ordering; top routes grouping by trip type; customers excluding admins and inactive users; offers bookable and expiring; searches null without an integration; the overdue invoice; and that another agency's data never appears.
- Frontend: type-check, lint, format check, web export; browser check at 1280 and 390 px with sales, an overdue invoice and an empty agency.

## 22. Step 42: Third provider: Sabre

Goal: an agency that works in Sabre can search its routes through it, exactly as with Duffel and Travelport. It cannot be tried against Sabre from here; correctness rests on recorded responses in Sabre's documented shape.

- Sabre's REST APIs behind the same provider interface, with `httpx`: Bargain Finder Max (`POST /v5/offers/shop`, the grouped itinerary response) on the certification host in test mode and the production host in live mode.
- Authentication: a token from `POST /v2/auth/token` (client credentials; the client id `V1:<user id>:<PCC>:<domain>` and the password each base64-encoded, joined by a colon and base64-encoded again), taken once per provider instance and sent as a bearer token. Credentials: user id (EPR), password, PCC and domain (`AA` for agencies; Dev Studio accounts are given theirs).
- Request: the PCC in the point of sale, one adult (ADT), an origin–destination per direction with its date, the cabin as the only cabin allowed, max connections as the most stops when set, and penalty information asked for (not filtered on).
- Mapping into step 34's itinerary shape with the same skip rules: legs → directions; schedules → segments with marketing and operating carriers and flight numbers, airports and local dates and times (the leg's date with the schedule's day adjustments; offsets dropped; technical stops ignored); the total price and its currency; the validating carrier → ticketing airline; checked baggage allowances → `checked_bags` (fewest across allowances, a weight alone being one bag) and kilograms when every allowance gives them; refund and exchange penalties before departure → policies (no penalty information: not allowed; allowed with a zero amount: free; otherwise with a fee); fare type unknown; the fewest seats available → seats left; the last ticketing date and time → expiry; the itinerary's id → provider reference.
- Errors: an HTTP error or a response whose messages carry an error and no itineraries is a provider error with Sabre's message. Test connection takes a token (it searches nothing).
- Integration provider gains `sabre`; Settings › Integrations takes Sabre's four credentials with help text.
- README: obtaining Sabre Dev Studio (certification) credentials and production access.
- Tests: the token request and the search sent (headers, body, test and live hosts, max connections only when set), mapping from recorded responses (one-way with a connection and codeshare, return, day changes, baggage by pieces and by weight, penalties, seats and expiry, a non-USD currency), errors (token refused, HTTP error, error messages without itineraries), and a Sabre integration in a run beside Duffel, in a re-check and in the admin API (credentials required and never returned).

## 23. Step 43: Fourth provider: Amadeus

Goal: an agency with an Amadeus API contract can search its routes through it. Amadeus closed its self-service sign-up in 2026; agencies get keys through an Amadeus Enterprise agreement. As with Sabre, it is built from Amadeus's documented shapes and tested with recorded responses.

- Amadeus's Flight Offers Search (`POST /v2/shopping/flight-offers`, with `X-HTTP-Method-Override: GET`) behind the same interface, with `httpx`, on `test.api.amadeus.com` in test mode and `api.amadeus.com` in live mode.
- Authentication: an OAuth2 token from `POST /v1/security/oauth2/token` (client credentials: API key and API secret), taken once per provider instance and sent as a bearer token. Credentials: API key, API secret.
- Request: one adult, an origin–destination per direction with its date, GDS sources, the cabin as a cabin restriction on every direction, and max connections (Amadeus allows at most 2) when set.
- Mapping with the same skip rules: itineraries → directions; segments with marketing and operating carriers, flight numbers, airports and local dates and times (technical stops ignored); the grand total and its currency; the first validating airline → ticketing airline; included checked bags per segment → `checked_bags` (fewest across segments, a weight alone being one bag) and kilograms when every segment gives them; refund and change policies not allowed (the search does not state conditions); negotiated or corporate fares private, published ones public; bookable seats → seats left; last ticketing date → expiry; the offer's id → provider reference.
- Errors: an HTTP error is a provider error with Amadeus's error detail. Test connection takes a token (it searches nothing).
- Integration provider gains `amadeus`; Settings › Integrations takes the API key and secret with help text.
- README: obtaining Amadeus API access.
- Tests: as for Sabre: token and search requests, mapping from recorded responses, errors, and an Amadeus integration in a run, a re-check and the admin API.

## 24. Step 44: Agency themes

Goal: each agency can give its site, app and emails its own look by choosing a theme from a list the system owner manages. A theme sets two brand colours and the shades that go with them. Agencies cannot type in their own colours, and the owner cannot save a theme whose text would be hard to read: the server checks contrast on every save. This replaces "per-agency branding" in the out-of-scope list (§1), and §19's "Branding stays shared": the shared mobile app takes the colours of the agency it is set to.

Colours
- A theme sets **primary** (top bar, links, selected states; white text on it) and **accent** (prices and main calls to action; dark text #252525 on it). The server derives the primary's **tint** (chat bubbles, highlights; the primary blended 9% over white) and its **hover** shade, so the owner enters only the two colours.
- Everything else is the same in every theme: the slate-green tertiary, the neutrals, the background and surface, the status colours and their chip tints, the type scale.
- **Azaria's own colours** (today's `theme.ts` values) stay in the code. They are used wherever there is no agency: the platform app, platform emails, the web app's loading state and the mobile Find your agency screen.

Model (public schema)
- **Theme**: name (unique, ≤ 40 characters), primary and accent (`#rrggbb`, stored lowercase), is_active, is_default, created_at. Exactly one theme is the default, and it is active. Themes are never deleted.
- Contrast rules, checked on create and on every change, with the WCAG contrast ratio: the primary at least 4.5:1 against white, against its tint and against the background #f2f4f7; the accent at least 4.5:1 against #252525. A failing save is refused with 400 naming the rule and the ratio (for example "White text on this primary is 3.1:1; it needs 4.5:1.").
- **Tenant** gains `theme` (FK Theme, protected, required).
- The migration creates the eight starting themes below (all of which pass the rules), makes Indigo & Amber the default, and gives every existing agency the default:
  - Indigo & Amber (#1800d2 / #ffb400), the default and today's colours
  - Navy & Gold (#1b3a6b / #f2c14e)
  - Teal & Coral (#00676b / #ff8a65)
  - Forest & Lime (#1e5631 / #a4de02)
  - Burgundy & Sand (#7b1e3a / #f4d58d)
  - Plum & Peach (#5b2a86 / #ffb38a)
  - Charcoal & Sky (#2b2d42 / #8ecae6)
  - Ocean & Sunflower (#0057b8 / #ffd100)
- Editing a theme's colours changes every agency that uses it (from their next load). An inactive theme is no longer offered, but agencies already using it keep it until they choose another. The default cannot be deactivated.

Backend
- `create_agency` takes a theme (default: the default theme); `manage.py create_agency` gains `--theme <name>`. `/django-admin/` lists themes read-only and shows the agency's theme as a choice.
- Choosing a theme for an agency: an active theme, or the one it already has. Anything else is refused with 400.
- A theme in the API: `{id, name, colors: {primary, primary_text, primary_tint, primary_hover, accent, accent_text}}`, with `is_active`, `is_default` and `agency_count` added in the platform API.
- `GET /api/agency` adds `theme`.
- `GET /api/admin/themes`: the active themes, default first, then by name. `GET/PATCH /api/admin/settings` returns and accepts `theme` (its id) and saves it on the agency.
- Platform: `themes` (list with inactive ones; create; PATCH name, primary, accent, is_active) and `themes/{id}/make-default` (active themes only). `tenants` returns `theme` and accepts it on create and PATCH.
- Emails: an agency's emails use its theme in the base layout (the header bar and anything else that uses the primary or accent today). Platform emails (invoices, suspension, platform desk) use Azaria's own colours.

App
- Web: the agency app loads `GET /api/agency` before its first screen and applies the theme; until then a plain loading state in Azaria's colours. Every screen uses the theme's colours, including styles built when a file loads; no screen may keep Azaria's colours once a theme is applied.
- Native: the stored agency (§19) keeps its theme. On launch the app applies the stored theme at once and refreshes it from `GET /api/agency`. Switching agency applies the new agency's theme.
- The platform app always uses Azaria's colours.
- A shared **theme preview**: a strip of the top bar in the primary with the agency's name (or "Your agency"), a line of text and a link on the tint, and an accent "Book" button beside a price.
- Agency Admin › Settings gains a **Theme** card: a dropdown of the active themes by name, the preview of the selected one, and Save. Saving applies the theme to the admin's own app at once (the screens re-render with the new colours; on web the page reloads). Other users get it the next time they load the app.
- Platform › New agency dialog gains a Theme dropdown (active themes, the default preselected) with the preview. The agency's detail page shows its theme in the Agency section and can change it.
- Platform › Settings gains a **Themes** section: a table of themes (the two colours as swatches, name, agencies using it, a Default chip, Active or Inactive), New theme, and a dialog to create or edit one. The dialog has the name, each colour as a hex field with the browser's colour picker beside it (web only), the live preview, and the four contrast checks with their ratios, each passing or failing as the colours change. Save is disabled while a check fails, and the server checks again. Rows also offer Make default (active themes) and Deactivate or Activate (not on the default).

Tests
- Backend: the migration's eight themes pass every rule, the default is Indigo & Amber, and existing agencies get it; every contrast rule refuses a failing colour with its ratio on create and on change; colours stored lowercase and the tint and hover derived; exactly one default (make-default moves it; the default cannot be deactivated; an inactive theme cannot be made default); an inactive theme is refused for an agency except the one it already has, and is missing from the admin list; `create_agency` and the command with and without a theme; `GET /api/agency`, admin settings (an admin changes only their own agency's theme), the platform themes and tenants endpoints and their permissions; agency emails render with the agency's colours, platform emails with Azaria's.
- Frontend: type-check, lint, format check, web export. Browser check at 1280 and 390 px on two agencies with different themes: Explore, offer detail, a booking, Dashboard and Settings, with no leftovers in Azaria's colours; changing the theme in Settings; the platform Themes section (create a theme, a failing pair with Save disabled, edit, make default, deactivate) and the New agency dialog. Device check (the user's): the native app takes the agency's theme and changes it on Switch agency.

## 25. Step 45: Modules

Goal: an agency buys flights, tours and hotels as separate modules: any one, any two or all three. The owner switches them on per agency. Whatever belongs to a module that is off is hidden from the agency's app and refused by its API, and its data is kept. Flights, the system as built so far, becomes the first module; tours (step 46) and hotels (step 48) are the others. Modules are not tied to plans: billing stays manual, so the owner sets an agency's modules to match what it pays for, as with its search allowance, and plan descriptions say what each plan includes.

From this step the system is for travel agencies, not only flight ticketing: when the step is built, the opening paragraph of this document describes an agency platform with three modules.

Model
- **Tenant** gains flights_enabled, tours_enabled and hotels_enabled; at least one is on (database check). Existing agencies get flights only. `create_agency` takes the modules (flights only when left out). The tours and hotels switches exist from this step; what they turn on arrives with steps 46 and 48.

What each module covers
- **Flights**: offers, requests for options, flight bookings and boarding passes, flight passengers (step 47), fare providers, routes, fares and fare searches (the search allowance), with their emails and scheduled tasks.
- **Tours**: everything in §26. **Hotels**: everything in §28.
- Always on: accounts and users, support chat, app settings (payment instructions, hold and reminder hours, notification email), theme, billing and plans.

Rules
- A module that is off: its endpoints (public, customer and admin) return 404 `{"code": "module_off"}`; its scheduled tasks skip the agency; a queued email re-checks and is dropped. Its data stays and is all back when the module is turned on again.
- Turning a module off is refused (409, e.g. "3 open flight bookings") while it has open bookings: flight bookings requested, availability confirmed or paid; tour bookings confirmed on a tour that has not ended; hotel bookings requested, availability confirmed or paid. Turning the last module off is refused (400). Turning one on is always allowed.

API
- `agency` returns `modules`, the ones on, in the order flights, tours, hotels (e.g. `["flights", "tours"]`). Admin `settings` returns them, read-only.
- Platform `tenants` return and accept `modules` (create: `["flights"]` when left out; PATCH applies the rules above).
- The admin `dashboard` leaves out its flight figures when flights is off.

App
- The agency app reads `modules` with the agency, before the first screen (as the theme), and shows only what they include:
  - **Explore**: a switch at the top with a tab per module on (Flights, Tours, Hotels), shown only with more than one; the first is the default. With one module, Explore is that module's page.
  - **Customers**: Requests only with flights; Bookings with a switch like Explore's when more than one module is on.
  - **Admins**: Offers, Routes, Requests and Bookings only with flights, Tours with tours, Hotels with hotels; the Integrations card in Settings only with flights; until the dashboard step (after hotels) the dashboard shows its flight sections only with flights.
  - A `module_off` answer (an old link, or a module turned off while the app is open) shows "This part of the site isn't available" with a link home.
- **Platform**: the New agency dialog has Modules checkboxes (Flights checked; at least one). The agency page gets a Modules card with three switches, each saved at once, showing the server's message when refused. The Agencies table gains a Modules column. The agency's fare searches section shows only with flights.

Tests
- Backend: the database check; defaults for existing and new agencies; flight endpoints refused with `module_off` when flights is off (one per endpoint group, public, customer and admin; steps 46 and 48 add the same for theirs); flight scheduled tasks and queued emails skipped; turning off refused with open flight bookings (steps 46 and 48 add theirs) and with no module left; data back when turned on; `agency` and platform `tenants` fields; the dashboard without flights.
- Frontend: type-check, lint, format check, web export. Browser check at 1280 and 390 px: an agency with flights only (no switch, as today) and one with flights off (no flight screens or nav); a `module_off` link; the platform's Modules card and a refused switch.

## 26. Step 46: Tours

Goal: an agency also sells tours, for example "Maasai Mara, 3 days" on fixed dates with a fixed number of slots. Its admin creates tours, each with one or more price options (Regular, VIP, Child, Couple, Group of 6 and so on). Tours show as cards on Explore, and a signed-in customer books on their own: as long as slots are left, choosing options books them at once, with no admin step. The booker is the account holder; traveller details are optional and can be added later, since people often buy for others or as gifts. Admins can also book for a customer, as for flights. Plans change, so an admin can change or cancel a tour after people have booked, and tell them by email in their own words. Payment stays outside the system; when payments are added later, a tour booking will be confirmed on payment, and this step does not prepare for that. Prices are USD. Tours are a module (§25): everything here is on only when the agency has tours. Hotels are step 48, and the admin dashboard is revised once, after hotels; this step leaves it unchanged.

§1's "passenger details" exclusion is removed when step 47 is built; from this step tour bookings can hold traveller details in the shared Traveller table (below).

Model (per agency)
- **Tour**: title (≤ 120), destination (≤ 120, free text, e.g. "Maasai Mara, Kenya"), start_date, end_date (≥ start_date), slots (1–500, the tour's capacity in people), booking_deadline (the last day customers can book; ≤ start_date; the form proposes the day before the start), cancellation_deadline (the last day customers can cancel; ≤ start_date; the form proposes the day before the start), cancellation_policy (plain text ≤ 2,000, required), summary (≤ 300, plain text, shown on cards), description (sanitized rich HTML ≤ 10,000 characters, as plan descriptions), included and not_included (lists of short lines, ≤ 30 each of ≤ 200 characters), meeting_point (≤ 200, blank allowed), is_active, cancelled_at and cancelled_by (null unless cancelled), created_at, updated_at. Never deleted.
  - Slots left = slots − people on its confirmed bookings. Slots cannot be set below the people already booked.
  - Every other field can change at any time, bookings or not, except on a cancelled tour (409). Existing bookings keep the prices they were booked at.
  - **Bookable** (for customers): active, not cancelled, today (Nairobi) on or before booking_deadline and before start_date, at least one active price option, and at least one slot left. Booking closes at the end of the booking_deadline day.
- **TourPriceOption**: tour, name (≤ 60, unique within the tour, e.g. "VIP", "Child (3–11)", "Couple", "Group of 6"), description (≤ 200, blank allowed), price (> 0, for one unit), people_per_unit (1–20: 1 for a per-person price, 2 for a couple, 6 for a group of six), units_available (null = limited only by the tour's slots; otherwise how many units of this option can be sold, e.g. 10 VIP places), position, is_active. At least one per tour. An option that has been booked cannot be deleted, only deactivated; an inactive option is not offered. Units left = units_available − units on confirmed bookings (null when unlimited). units_available cannot be set below the units already booked.
  - A tour's **from price** is the lowest price per person across its active options (price ÷ people_per_unit, half-up to the cent).
- **TourPhoto**: tour, image (PNG/JPEG/WebP ≤ 2 MB, content-checked, public storage `tours/<schema>/<tour>/`, random UUID names), position, created_at. At most 8 per tour; the first is the cover. Deleting a photo deletes its file. Public storage (§2) now holds airline logos and tour photos.
- **TourBooking**: tour, user (customer), created_by (the admin when booked for the customer, null otherwise), people (the sum of the lines' people, 1–40), group_name (≤ 80, optional, e.g. "Otieno family"), notes (≤ 1,000), status (confirmed / cancelled / completed), cancelled_by (customer / admin, null otherwise), cancel_reason (≤ 2,000, the admin's message, blank otherwise), created_at. Total = the sum of its lines.
- **TourBookingLine**: booking, option, and copied at booking: option_name, unit_price, people_per_unit; quantity (≥ 1). Line total = unit_price × quantity; its people = people_per_unit × quantity. One line per option per booking.
- **Traveller** (shared with flight bookings from step 47 and hotel rooms from step 48, `bookings` app): exactly one of tour_line (a TourBookingLine) or booking (a flight Booking, step 47), enforced by a database check; related_name "travellers" on both, cascade. Fields: full_name (2–100, as on the travel document, required), gender (female / male / blank), date_of_birth, nationality (ISO alpha-2), document_type (passport / national_id / blank), document_number (≤ 30), document_expiry, email, phone, checked_bags (0–5, default 0), checked_bag_kg (per bag, null = not stated), cabin_bag_kg (null = not stated), special_requests (≤ 500: diet, medical, accessibility), created_at, updated_at. Baggage uses the same names and units as an offer's allowance (§14), but is what this traveller is bringing. Document number and expiry go together (expiry optional for a national ID). Travellers are personal data: only the booker and the agency's admins ever see them.
  - On a tour line every field but full_name may be blank. A line holds at most its people in travellers (a Couple line of quantity 2 holds up to 4; a Group of 6, up to 6); fewer, or none, is fine.
  - The shared traveller form (one component in the app) is used by tours here, by flight bookings in step 47 and by hotel guests in step 48.
- **TourBookingEvent**: booking, from_status (null on creation), to_status, actor (null = system), created_at.
- **TourNotice**: tour, kind (change / cancellation), message (≤ 2,000), sent_by, recipients (how many bookings it was emailed to), created_at. The record of every message the admin sent about the tour.

Booking rules (`tours/services.py`, atomic, the tour locked with `select_for_update`, so two bookings can never take the last slot or the last unit of an option together)
- Booking: one or more lines (active options of the tour, quantity ≥ 1), each with optional travellers (up to its people), an optional group name and notes. The booker's account must have a phone (the form asks for one and saves it to the account when missing); it is the booking's contact. The people must fit in the slots left (409 "Only N slots left") and each line in its option's units left (409 "Only N VIP left"). The booking is confirmed at once.
  - **Customer**: the tour must be bookable (otherwise 409 naming why: fully booked, bookings closed, cancelled).
  - **Admin for a customer** (an active customer, as for flights): the tour must be active, not cancelled and not yet started; the booking deadline does not apply. The customer gets the booked email; there is no "new booking" email to the admins.
- Several bookings by one customer on one tour are allowed (for example a second group).
- **Travellers** are added, edited and removed by the booker or an admin while the booking is confirmed, within each line's people. No email is sent for traveller changes.
- **Customer cancels**: a confirmed booking, until the end of the cancellation_deadline day. Slots and units are freed.
- **Admin cancels one booking**: a confirmed booking, at any time before the tour ends, with an optional message (≤ 2,000) emailed to the customer. Slots and units are freed.
- **System completes**: daily, confirmed bookings whose tour ended before today become completed.
- Every booking change writes a TourBookingEvent and queues its email on commit. Views never set status.

Changing or cancelling a tour that has bookings
- **Save with a notice**: saving a tour (fields, dates or options) that has confirmed bookings may carry a message (≤ 2,000). With a message, the save writes a TourNotice (kind change) and emails every customer with a confirmed booking on it; without one, nobody is emailed. Photo changes alone never send a notice.
- **Cancel tour**: needs a message (required, ≤ 2,000). In one transaction it marks the tour cancelled (cancelled_at, cancelled_by, inactive), cancels every confirmed booking (cancelled_by admin, cancel_reason = the message, an event each), writes a TourNotice (kind cancellation) and emails every one of those customers once per booking. A cancelled tour cannot be reactivated or edited.

Emails (HTML plus text, as §6; every customer email shows the tour, its dates and meeting point, the booking's lines, group name, the travellers entered (names only) and total)
- Customer: tour booked (with the cancellation policy and deadline, and "Pay as your agency instructs": the agency's payment instructions from AppSettings); tour changed (the admin's message, then the tour as it now stands); booking cancelled by the agency (the admin's message); tour cancelled (the admin's message). No email when the customer cancels.
- Agency admin (`admin_notification_email`): new tour booking (customer-made only), tour booking cancelled by the customer.

Scheduled task
- `complete_finished_tour_bookings`, daily, each agency.

API (agency host)
- Public: `tours` (bookable tours; filters: `search` over title and destination, start date range, price range on the from price; ordering by start date (default) or from price) and `tours/{id}` (a bookable tour, or any tour the signed-in customer has booked). Each tour returns its fields, `slots_left`, `duration_days` (end − start + 1), `from_price`, `options` (active ones in order, each with `units_left`), `photos` (`[{id, url}]` in order), `bookable` and, when not bookable, `not_bookable_reason` (fully_booked / closed / cancelled).
- Signed in (customers): `tour-bookings` (own; create with lines and their travellers; `{id}`; `cancel`), each with its tour, lines with their travellers, status timeline, `can_cancel` and `can_edit_travellers`; `tour-bookings/{id}/travellers` (POST with the line) and `tour-bookings/{id}/travellers/{traveller_id}` (PATCH, DELETE).
- Admin: `admin/tours` (all tours with `booked` and `slots_left`; filters upcoming / past / inactive / cancelled; create with options; PATCH with options, the whole list replacing the old one: an omitted booked option is refused (400), and an optional `notice` message; no delete), `admin/tours/{id}/cancel {message}`, `admin/tours/{id}/notices`, `admin/tours/{id}/photos` (upload, one image per request), `admin/tours/{id}/photos/{photo_id}` (delete; PATCH `{position}` to reorder), `admin/tours/{id}/bookings`, and `admin/tour-bookings` (status and tour filters; create for a customer; `{id}`; `cancel {message}`; `travellers` as for customers).

App
- **Explore** shows Tours as its tab in the module switch (§25); with tours as the only module, Explore is the tours list.
- **Tours list**: a search box (destination or name), start date range and price range filters (sidebar on wide screens, panel on phones, as for flights), and sort by date or price. Results are cards: cover photo (a neutral placeholder with an icon when there is none), title, destination, dates and number of days, "From $X per person", and an "N slots left" chip from 5 down. Two to three columns on wide screens, one on phones. Empty state: "No tours right now".
- **Tour detail** (own URL): a photo gallery (cover large, the rest as thumbnails; tapping opens the photo large), title, destination, dates and days, the summary, the description, Included and Not included lists, meeting point, the cancellation policy with "Free to cancel until <date>", and a price card listing the options (name, description, price and what it covers, e.g. "$900 for 2 people", and "N left" when limited) with slots left, booking deadline and Book. When not bookable, the card says why: fully booked, bookings closed, or cancelled.
- **Book tour** (full page, behind the auth gate): a quantity stepper per option (limited by its units left and the slots left), per option an "Add traveller" button that adds a traveller form (full name required, then the optional fields above, with baggage) up to the option's people (it disappears at the limit, showing "4 of 6 travellers added"), and a note that travellers can be added later; group name; phone when the account has none; notes; the cancellation policy, live lines and total, and Confirm booking. On success it opens the booking with a "You're booked" banner. A 409 shows its message and refreshes the tour.
- **Customer Bookings** shows tour bookings under its Tours tab (§25). Tour booking cards show the cover, title, dates, group name, people and total. Tour booking detail: tour summary with a link to the tour, lines with their travellers ("4 of 6 added"; Add, Edit and Remove while confirmed, using the same traveller form in a dialog), group name, notes, total, status with its timeline, the agency's payment instructions while confirmed, the cancellation policy and deadline, the agency's message when it cancelled, and Cancel booking (confirm dialog) while `can_cancel`.
- **Admin › Tours** (a nav item; on phones it joins the "More" menu as the rules for tabs already say):
  - A table with title, dates, booked / slots, from price and status (Upcoming, Fully booked, Closed, Past, Inactive, Cancelled), with the upcoming / past / inactive / cancelled filter. A tour opens beside the slim rail (§20).
  - The tour detail shows its fields, options (with units sold), photos, its bookings (group name or booker, booker's phone, options, people, travellers added of people, status, created) and its notices (kind, message, sent by, when, recipients). Actions: Edit, Activate or Deactivate, Book for a customer, and Cancel tour.
  - Each booking opens with its booker (name, email, phone), lines with their travellers in full (Add, Edit, Remove while confirmed), group name, notes, timeline and Cancel booking: a dialog with a message box ("Message to the customer", optional) that is emailed when filled.
  - **New tour** and **Edit tour** are full pages: the fields with the two deadlines and the cancellation policy, a rich-text editor for the description, line editors for Included and Not included, a price option editor (add, edit, reorder, deactivate; delete only when never booked), and photos (web only: add, delete, move up or down; the first is the cover). The form refuses values that break the rules above with the server's message.
  - **Saving a booked tour** opens a dialog first: "N bookings (M people) are booked on this tour. Tell them about the change?" with a message box, and Save and notify (needs a message) or Save without notifying.
  - **Cancel tour** opens a dialog: what happens (N bookings cancelled, each customer emailed), the message box (required), and Cancel tour.
  - **Book for a customer**: a dialog to pick an active customer (searchable, as for flight bookings), then the Book tour page filled in for them.
- The admin dashboard, sales figures and the flight Bookings screen are unchanged in this step.

Tests
- Backend:
  - Tour validation: dates and both deadlines; slots and units not below booked; lists; sanitized description; at least one active option; booked options cannot be deleted; edits after bookings keep booked prices; a cancelled tour refuses edits.
  - Photos: type, size, content check, count, order, file deleted with the photo.
  - Bookable rules at their edges: the booking_deadline day in Nairobi time, the last slot, the last unit of a limited option, inactive, cancelled, no active option. Admin bookings past the deadline but before the start.
  - Booking validation: lines, count limits, the booker's phone, and the 409s.
  - Travellers: optional at booking; at most a line's people (refused above it); full name required, document number and expiry together, field limits; added, edited and removed by the booker and admins only while confirmed; never visible to other customers. Two bookings racing for the last slot and for the last limited unit (only one succeeds). From price across options.
  - Cancellation: the customer window at the cancellation_deadline edge; admin cancel with and without a message; slots and units freed.
  - Notices: a save with a message emails each confirmed booking's customer once and records the notice; a save without one emails nobody; photo changes send nothing. Cancel tour cancels every confirmed booking, records the notice and emails each, and requires a message.
  - The completion task with frozen time. Events and every email, including none on customer cancel and no admin email for admin-made bookings.
  - Visibility: only bookable tours in the public list; a customer's booked tour stays visible to them; other customers' bookings never. Admin permissions. `module_off` when tours is off, and turning tours off refused with confirmed bookings on a tour not ended. Isolation between agencies. UUID keys on the new models. The Traveller check (exactly one owner).
- Frontend: type-check, lint, format check, web export. Browser check at 1280 and 390 px:
  - Explore's Tours switch and cards, filters and sort; tour detail with photos and options.
  - Booking several options as a guest through the auth gate, a fully booked tour, a limited option running out.
  - Adding travellers at booking up to an option's people, and adding, editing and removing them afterwards.
  - The customer's tour booking and cancel.
  - Admin › Tours: create with options and photos, edit with and without a notice, book for a customer, cancel a booking with a message, and cancel a tour.

## 27. Step 47: Flight passenger details

Goal: every flight booking records who is flying. The customer gives each passenger's details when booking, as the airline will need them, so the admin no longer collects names, dates of birth and passports by phone, email or chat. Passengers use the shared Traveller table and traveller form from step 46. §1's "passenger details" exclusion is removed.

Rules
- A flight booking has exactly `passenger_count` travellers (Traveller.booking). Creating a booking, by the customer or by an admin for a customer, needs them all: 400 when the number differs or a passenger is incomplete.
- **Required for each passenger**: full_name, gender, date_of_birth (not in the future, at most 120 years ago), nationality, document_type, document_number, and document_expiry for a passport (after the last flight's date; a passport expiring sooner is refused with "Passport expires before the trip"). Optional: email, phone, baggage, special_requests.
- **Changes after booking**: the customer edits passengers while the booking is requested; once availability is confirmed only an admin can, until the booking is completed. The number of passengers never changes after booking (as today). No email is sent for passenger changes.
- Bookings made before this step keep no passengers; they show "No passenger details recorded" and are never blocked by these rules.
- Requests for options (Query) do not take passengers.

API
- Booking create (customer `bookings` and admin `admin/bookings`) takes `travellers`, a list of passenger objects.
- Bookings (customer and admin) return `travellers` and `can_edit_travellers`; `bookings/{id}/travellers/{traveller_id}` and `admin/bookings/{id}/travellers/{traveller_id}` (PATCH) edit one passenger. There is no add or delete: the count is fixed.

Emails
- The admin's "new booking" email and every customer email about a booking list the passengers' names (never documents).

App
- **Book** (offer detail's booking page) and the admin's New booking dialog: one passenger form per passenger as the stepper changes (the first prefilled with the customer's name, email and phone), with the required fields marked. The passenger stepper is still limited to 1–9.
- **Booking detail** (customer and admin): a Passengers card with each passenger's name, gender, date of birth, nationality and document (number masked to the last 4 for customers, in full for admins), baggage and requests; Edit on each while `can_edit_travellers`, with the same form in a dialog.
- Admin booking detail shows a Copy button on the Passengers card that copies each passenger as "SURNAME/GIVEN NAMES, gender, date of birth, document, expiry, nationality" lines, for pasting into the GDS.

Tests
- Backend: create refused without passengers, with the wrong number, or with a missing required field; passport expiry against the last flight's date; date of birth limits; edits allowed by the customer while requested and by admins until completed, and refused otherwise; old bookings without passengers keep working through every transition; passengers in the emails (names only); visibility (only the customer and admins); admin-made bookings; isolation between agencies.
- Frontend: type-check, lint, format check, web export. Browser check at 1280 and 390 px: booking with 3 passengers (validation messages, a passport expiring too soon), the admin's New booking with passengers, editing a passenger as customer and admin, the masked document for customers, Copy for GDS.

## 28. Step 48: Hotels

Goal: an agency with the hotels module sells stays at the hotels, lodges and camps it works with. Its admin lists each hotel with its room types and rates, priced per night by season. Customers browse hotels on Explore, choose dates, rooms and a rate, and send a booking request. The agency cannot see the hotel's free rooms, so booking works as for flights: the admin checks availability with the hotel and confirms, possibly at a different price; the customer pays outside the system before the deadline; the admin marks the booking paid; then the admin uploads the hotel's voucher with its confirmation number and sends it. Connections to hotel suppliers (bed banks, channel managers) are out of scope until specified. Prices are USD per room per night, optionally plus a charge per adult (for example breakfast), and include taxes; children are not priced separately. The admin dashboard is revised in the next step (§29).

Model (per agency, app `hotels`)
- **Hotel**: name (≤ 120), destination (≤ 120, free text, e.g. "Diani Beach, Kenya"), address (≤ 200), star_rating (1–5, null = not rated), summary (≤ 300, plain text, shown on cards), description (sanitized rich HTML ≤ 10,000, as tours), amenities (a list of ≤ 30 short lines of ≤ 100), check_in_time, check_out_time, cancellation_policy (plain text ≤ 2,000, required), is_active, created_at, updated_at. Never deleted.
- **HotelPhoto**: as TourPhoto (§26), at most 12 per hotel, public storage `hotels/<schema>/<hotel>/`; the first is the cover.
- **RoomType**: hotel, name (≤ 80, unique within the hotel, e.g. "Deluxe Double", "Family Tent"), description (≤ 300), max_adults (1–10), max_children (0–6), position, is_active. A room type that has been booked cannot be deleted, only deactivated.
- **RoomRate**: room_type, name (≤ 60, unique within the room type, e.g. "Bed & breakfast, single use", "Full board, East Africa resident"), inclusions (a list of ≤ 10 short lines of ≤ 80, e.g. "Breakfast included", "Free cancellation until 7 days before"), max_adults (1 to the room type's max_adults), max_children (0 to the room type's max_children), position, is_active. per_adult_per_night (≥ 0, default 0; the same in every season, e.g. $15 for breakfast). A rate is one row of the hotel's room table: what is offered, for how many people, at its own price. The per-adult charge lets one rate cover a room used by one or two people (one adult pays one breakfast); hotels that price single use some other way enter it as a separate rate (e.g. "single use" for 1 adult). A booked rate cannot be deleted, only deactivated.
- **RatePeriod**: rate, start_date, end_date (≥ start_date), price_per_night (> 0, the room price). A rate's periods never overlap. A night's price for a room with N adults is the price_per_night of the period that contains it plus N × the rate's per_adult_per_night.
  - A stay (check-in to check-out, 1–30 nights) is **offered** at a rate when the hotel, room type and rate are active and every night falls in one of the rate's periods; its price for N adults is the sum of the nights' prices.
  - **Adults priced** when showing a rate: the adults searched or chosen, capped at the rate's max_adults; with none given, the rate's max_adults (what its Sleeps column shows).
  - A hotel's **from price**, without dates, is the lowest night price among periods of its offered rates that have not ended; with dates, it is the lowest stay price; both for the adults priced.
- **HotelBooking**: hotel, user (customer), created_by (the admin when booked for the customer, null otherwise), check_in, check_out (1–30 nights; check-in today or later, Nairobi), status (see below), total (the rooms' sum, copied at booking), changes (old and new total and the admin's note, null when none), changes_accepted, payment_deadline, reminder_sent_at, unavailable_message (≤ 2,000, blank allowed), hotel_confirmation (≤ 40, set on completion), special_requests (≤ 1,000, passed to the hotel), notes (≤ 1,000), created_at.
- **HotelBookingRoom**: booking, room_type, rate, and copied at booking: room_name, rate_name, per_adult_per_night, price (this room's stay price for its adults); adults (1 to the rate's max_adults), children (0 to the rate's max_children). 1–9 rooms per booking; the same room type and rate may appear more than once, each its own room.
- **Traveller** (§26) gains a third owner, hotel_room (a HotelBookingRoom); the database check becomes exactly one of tour_line, booking and hotel_room. Each room has its lead guest (full name required, the rest optional), and may hold more guests, up to its adults plus children.
- **HotelVoucher**: booking, file (private, `hotel_vouchers/<schema>/<booking>/`), original_name, uploaded_at; as boarding passes: PDF/PNG/JPEG ≤ 5 MB, content-checked, ≤ 10 per booking, upload and delete only while paid.
- **HotelBookingEvent**: booking, from_status, to_status, actor (null = system), created_at.

Booking (`hotels/services.py`: atomic, `select_for_update`, validates move and actor, writes an event, queues email on commit; views never set status)

| From | To | Who | Notes |
| --- | --- | --- | --- |
| requested | availability_confirmed | admin | Needs payment instructions. Deadline = now + hold hours. Optional new total with a note (≤ 500), recorded in `changes`. |
| requested / availability_confirmed | unavailable | admin | Optional message to the customer. |
| requested / availability_confirmed | cancelled | customer | No email. |
| requested / availability_confirmed | expired | system | Deadline passed, or still requested on the check-in day. |
| availability_confirmed | paid | admin | Refused after the deadline or while changes await acceptance. |
| availability_confirmed | declined | customer | Only while changes await acceptance. No email. |
| paid | completed | admin | "Send voucher": needs the hotel's confirmation number and at least one voucher. |

- **Creating**: the customer (signed in) or an admin for an active customer sends the dates, rooms (room type, rate, adults, children, lead guest and any more guests), special requests and notes. Every room must be offered for the dates (409 "Deluxe Double is not available for these dates" otherwise) and the occupancy within the rate's limits (400). The booker's account must have a phone (asked for and saved when missing). Prices are worked out by the server and copied; later rate changes never touch a booking. Admin-made bookings start requested too, with no "new booking" email to the admins.
- Customers accept changes with `accept-changes` (the total becomes the new one) or decline them.
- **Guests**: the customer edits them while requested; after that only an admin, until completed. Each room keeps its lead guest.
- The scheduled tasks `expire_unpaid_bookings`, `send_payment_reminders` (`reminder_hours_before`) and `expire_stale_requests` (check-in day reached) also cover hotel bookings.

Emails (HTML plus text, as §6; each shows the hotel, address, dates, nights, check-in and check-out times, each room with its rate, adults and children and lead guest, special requests and the total)
- Agency admin: new hotel booking (customer-made only).
- Customer: availability confirmed (payment instructions, deadline, any new total with the note), unavailable (the admin's message), payment received, booking expired, payment reminder, voucher (the confirmation number, every voucher attached, the cancellation policy).

API (agency host)
- Public: `hotels` (active hotels with at least one offered rate; filters: `search` over name and destination, `check_in` and `check_out` (together: only hotels offered for those dates), `adults` and `children` (some rate fits them), `stars` (minimum), price range on the from price; ordering by from price (default), stars or name) and `hotels/{id}` (with `check_in` and `check_out`: each room type's rates with their inclusions, occupancy, `per_adult_per_night`, `room_price` (the nights' room prices summed), `stay_price` (for the adults priced, `adults` when given) and `nights`, or `available: false`; the app prices other adult counts as room_price + per_adult_per_night × adults × nights). Each hotel returns its fields, `from_price` (per night without dates, for the stay with them), `photos` and room types with their offered rates.
- Signed in (customers): `hotel-bookings` (own; create; `{id}`; `cancel`, `accept-changes`, `decline-changes`), each with its hotel, rooms and guests, status timeline, vouchers, `can_cancel` and `can_edit_guests`; `hotel-bookings/{id}/rooms/{room_id}/guests` (POST) and `hotel-bookings/{id}/guests/{traveller_id}` (PATCH, DELETE; never the lead guest); `hotel-vouchers/{id}/download` (admin, or the customer once completed).
- Admin: `admin/hotels` (all, with room types, rates and periods; filters active / inactive; create; PATCH with room types, rates and periods, the whole list replacing the old one, an omitted booked room type or rate refused (400); no delete), `admin/hotels/{id}/photos` and `admin/hotels/{id}/photos/{photo_id}` (as tours), `admin/hotel-bookings` (status and hotel filters; create for a customer; `{id}`; `confirm-availability {new_total?, note?}`, `mark-unavailable {message?}`, `mark-paid`, `vouchers` (upload), `complete {hotel_confirmation}`; guests as for customers), `admin/hotel-vouchers/{id}` (delete).

App
- **Explore › Hotels**: a search bar with destination, check-in and check-out, and guests (adults, children); stars and price filters (sidebar on wide screens, panel on phones) and sort by price, stars or name. Cards: cover (or a placeholder), name, stars, destination and "From $X per night", or with dates "$Y for N nights". Two to three columns on wide screens, one on phones. Empty state: "No hotels match" or "No hotels right now".
- **Hotel detail** (own URL): gallery as tours, name, stars, destination and address, summary, description, amenities, check-in and check-out times, cancellation policy, and the room table, as on hotel booking sites. Columns: Room type (name and description, spanning its rates' rows), Sleeps (person icons for the rate's adults and children), Price (for the chosen dates' nights and the adults priced, with "+ $15 per adult per night" under it when the rate has a charge; "Choose dates to see prices" without; "Not available for these dates" when not offered), What's included (the rate's inclusions), and Rooms (a 0–9 picker). With guests chosen, rates that cannot hold them are dimmed. A summary beside the table (below it on phones) shows the rooms picked, nights and total, with Request booking. On phones each room type is a card listing its rates as rows.
- **Request booking** (full page, behind the auth gate): dates, per room picked its room type and rate, adults and children (within the rate's limits; the room's price follows its adults) and the lead guest (the first prefilled with the customer's name, email and phone), "Add guest" with the shared traveller form up to the room's guests; phone when the account has none; special requests; notes; the cancellation policy; total; and Request booking, with "The agency will confirm availability with the hotel". On success it opens the booking.
- **Customer Bookings › Hotels**: cards with the cover, hotel, dates, rooms and total. Detail: the hotel and stay, rooms with their guests (edit while `can_edit_guests`), progress tracker or end banner, payment box with countdown, changes box (accept or decline), the agency's message when unavailable, the voucher and confirmation number once completed (preview first), and Cancel while `can_cancel`.
- **Admin › Hotels** (a nav item; on phones it joins "More" as the tab rules say) with two tabs:
  - **Bookings** (default): status tabs and a table (hotel, guest, dates, rooms, total, status); a booking opens beside the slim rail with booker, stay, rooms and guests (edit while allowed), timeline and the action bar: Confirm availability (a dialog with an optional new total and note), Mark unavailable (a dialog with an optional message), Mark paid, voucher upload, and Send voucher (a dialog asking the confirmation number). New booking for a customer (pick an active customer, then the Request booking page filled in for them).
  - **Hotels**: a table with name, destination, stars, room types, from price and Active; a hotel opens beside the rail with its fields, rooms, rates and periods, photos and its bookings; Edit, Activate or Deactivate. **New hotel** and **Edit hotel** are full pages: the fields, rich-text description, amenities lines, check-in and check-out times, cancellation policy, a room type editor (add, edit, reorder, deactivate; delete only when never booked), per room type a rate editor (name, inclusions, adults and children, per-adult charge), per rate a period table (start, end, price per night) that refuses overlaps, and photos (web only, as tours).

Tests
- Backend:
  - Hotel validation: fields, lists, sanitized description, occupancy limits (a rate within its room type's), inclusions, unique names, overlapping periods refused, booked room types and rates only deactivated.
  - Pricing: nights across two periods, the per-adult charge (1 and 2 adults on one rate, 0 charge, the adults priced with and without `adults`), a night not covered (not offered), from price with and without dates, inactive hotel, room type or rate.
  - Booking: create by customer and admin, occupancy, 1–9 rooms, 1–30 nights, check-in in the past, the phone, the 409 when a rate stopped covering the dates, prices copied and unchanged by later edits.
  - Every transition and actor, changes accepted and declined, the deadline and stale-request expiry with frozen time, reminders, voucher upload rules and completion needing a confirmation number and a voucher.
  - Guests: lead guest required per room, the limit per room, edits by the customer while requested and admins until completed, never visible to other customers; the Traveller check with three owners.
  - Every email (and none on customer cancel or decline, no admin email for admin-made bookings). Photos as tours. Filters and ordering. `module_off` when hotels is off, and turning hotels off refused with open hotel bookings. Isolation between agencies. UUID keys on the new models.
- Frontend: type-check, lint, format check, web export. Browser check at 1280 and 390 px: Explore Hotels with and without dates, filters and sort; hotel detail prices across a season change and for 1 and 2 adults on a rate with a per-adult charge; requesting two rooms as a guest through the auth gate; the admin confirming with a new total and the customer accepting; mark paid, voucher upload and send; the customer opening the voucher; unavailable with a message; creating a hotel with rooms, rates, periods (an overlap refused) and photos.

## 29. Step 49: Dashboard and Explore across modules

Goal: the admin dashboard and the visitor's first view of Explore cover whichever modules the agency has (§25) and read as one design, whether it has one module or all three. Sections are organised by job (what needs action, what was sold, what is coming up, what is on sale), not by module, and each holds rows from every module that is on. With one module nothing names the module; with more, rows carry a small module icon (plane, map pin, bed) and labels name the module only where two would otherwise read the same. Explore gains featured offers: admins mark flight offers, tours and hotels as featured, and a visitor opening Explore sees them as cards before choosing anything. Figures from a module that is off are left out (its data is kept, §25). When built, §11 and §21 describe the dashboard and Explore as here.

Model
- **Offer**, **Tour** and **Hotel** gain is_featured (default false). Admins switch it in the item's form and with a star in their tables. There is no limit on how many are featured; Explore shows at most six per module (below).

Definitions
- **A sale**, in USD, in Nairobi months and days:
  - Flight booking: as §21 (Paid or Completed, dated by its Paid event, amount its total).
  - Hotel booking: Paid or Completed, dated by its paid event, amount its total (the new total when changes were accepted).
  - Tour booking: Confirmed or Completed, dated by its creation, amount its total. Tours have no paid step, so a booking counts when booked and stops counting if it is cancelled.
- **Featured on Explore**, per module, at most six cards: the featured items customers can see (flights: public bookable offers; tours: bookable tours; hotels: those the public list shows), then, when fewer than six, the rest filled from the other visible items. Order: featured first, then flights by departure date, tours by start date, hotels by from price (no dates, ties by name).

API
- Public `GET /api/explore`: `{flights, tours, hotels}`, each the module's featured cards (in the shapes its own list returns, with `is_featured`), present only for modules that are on.
- Admin `offers`, `tours` and `hotels` return and accept `is_featured`; their lists take a `featured` filter.
- `GET /api/admin/dashboard` returns `modules` and replaces the §21 fields that were flights only:
  - `needs_action`: counts, each present only when its module is on: flights as today (bookings to confirm, boarding passes due, open requests, awaiting payment, new fares to review); hotels: `hotel_to_confirm` (requested), `hotel_awaiting_payment` (availability confirmed), `hotel_vouchers_due` (paid); tours: `travellers_missing` (confirmed bookings on tours starting in the next 7 days with fewer travellers than people). `overdue_invoice` as §21.
  - `sales`: `{this_month, this_year, all_time, count_this_month}` across modules on, each amount with `by_module` (`{flights, tours, hotels}`, modules on only).
  - `sales_by_month`: the last 12 months, oldest first, `{month, total, count, by_module}`.
  - `payments_due`: flight and hotel bookings awaiting payment with a deadline in the next 48 hours, soonest first, at most 5: `{kind (flight / hotel), id, customer, title (route line or hotel name), total, payment_deadline}`.
  - `this_week`: what starts in the next 7 days, soonest first (ties: flights, tours, hotels), at most 8: flight departures (Paid and Completed, as §21, with `passenger_count` and `boarding_passes_sent`), tour starts (tours not cancelled with confirmed bookings: `booked`, `slots`, `travellers_missing`) and hotel check-ins (Paid and Completed: `customer`, `nights`, `rooms`, `voucher_sent`); each `{kind, id, date, title, ...}`.
  - `top_sellers`: this year's sales grouped by route (origin, destination, trip type), tour and hotel, highest total first, at most 5: `{kind, id (tour or hotel; null for routes), title, count, total}`. Ordered by total instead of §21's count, since a tour or hotel booking holds several people.
  - `customers` as §21.
  - `on_sale`, per module on: flights `{bookable, public_bookable, expiring_soon, featured}` and `searches` as §21; tours `{upcoming (bookable), fully_booked, seats_sold, seats_total (upcoming tours), featured}`; hotels `{listed, prices_ending (listed hotels with no rate covering any night beyond 30 days from today), featured}`.

Admin dashboard (top to bottom; two columns from 900 px where noted, one on phones)
- Title and greeting as today.
- **Needs action**: the overdue invoice tile first when there is one, then the tiles of every module on, in module order, each opening its screen with the matching filter. Labels name the module only when two would read the same: "Bookings to confirm" with one booking module, "Flight bookings to confirm" and "Hotel bookings to confirm" with both. Tiles at zero show as today.
- **Sales**: the three stat cards across modules on. With more than one module each card has a line underneath, "Flights $X · Tours $Y · Hotels $Z", modules at $0 included.
- **Sales by month**: the 12-month bar chart. With one module, plain bars as today; with more, each bar is stacked by module in a fixed colour per module (primary, accent and the slate green, shown with a legend), and each bar's accessible label gives the total and each module's amount.
- Two columns: **Coming up** ("Payments due in 48 hours" and "This week": one list each, rows from every module mixed by date, each with its icon when more than one module is on; a flight row shows customer, route, date, passengers and "Passes not sent"; a tour row shows tour, start date, booked of slots and "N travellers missing"; a hotel row shows customer, hotel, check-in, nights and rooms and "Voucher not sent"; empty lines "Nothing due" and "Nothing this week"; rows open the booking or tour) and **Top sellers this year** (one ranked list of routes, tours and hotels, with icons when more than one module is on; empty: "No sales this year yet").
- Two columns: **Customers** as today and **On sale**: one block per module on, each a heading and a line or two with links: Flights (bookable offers, how many public, "N expire within 7 days", featured count, and the searches bar as §21 when there is an integration), Tours (upcoming tours, seats sold of seats as a bar, "N fully booked", featured count), Hotels (hotels listed, "N have prices for less than 30 days ahead" in the warning colour, featured count). With one module the block has no heading.
- Loading and error states through the one request; no horizontal scrolling at 390 px.

Explore
- **With more than one module**, the module switch (§25) gains a first tab, **All**, the default; the URL keeps the tab. **All** shows:
  - A hero with the agency's name and one large tile per module on ("Flights: find a flight", "Tours: join a tour", "Hotels: book a stay"), each opening its tab. Side by side on wide screens, stacked on phones.
  - A section per module on, in module order, titled "Featured flights", "Featured tours", "Featured hotels", each with up to six cards from `explore` and "See all" opening the tab. Three columns on wide screens; on phones a row of cards scrolled sideways within the section (the page itself never scrolls sideways). A module with nothing to show is left out; with nothing in any, "Nothing on offer right now. Check back soon."
- **With one module**, there is no switch, and that module's page opens with a "Featured" row above its results while no search or filter is applied, hidden once one is.
- **Cards** share one frame, so the three kinds line up in a grid: a top image area of the same height, then title, a detail line, and the price at the bottom in the price colour, with a "Featured" chip on featured items. Tours and hotels use their cards from §26 and §28. Flight offers get a card: the image area in the primary tint with the route large ("NBO → DXB", or "⇄" for return) and the city names under it, airline badge; then dates, trip type and class, and "$X per person". Each card opens the item's detail.

Admin screens
- Offers, Tours and Hotels tables gain a star column (filled when featured, toggled in place) and a Featured filter; their forms gain a "Feature on Explore" switch.

Tests
- Backend: is_featured on the three models and admin endpoints, with the filter; `explore` per module on (featured first, filled to six, only visible items, nothing from modules off, nothing from another agency); each sale rule (hotel paid dating and accepted changes, tour bookings counting when booked and not once cancelled, Nairobi month edges); `by_module` with modules on only; `payments_due`, `this_week` and `top_sellers` mixing kinds with their ordering, limits and windows at the edges; `needs_action` and `on_sale` per module (travellers missing, prices ending); a module turned off drops out of every figure.
- Frontend: type-check, lint, format check, web export. Browser check at 1280 and 390 px: Explore All with three modules (hero tiles, featured sections, See all, a module with nothing to show), a flights-only agency (Featured row, hidden after a search), a tours-only agency; featuring from an admin table; the dashboard with all three modules (stacked chart and legend, mixed Coming up and Top sellers, label rules) and with one (no icons, headings or breakdown lines), and an empty agency.
