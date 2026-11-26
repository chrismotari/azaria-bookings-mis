# Dira Manifest — Specification

A multitenant SaaS for tours & travel agencies. Each agency (tenant) gets its own site, app and data, and sells any of three modules, which the system owner switches on per agency (§4):
- **Flights**: the admin lists flight offers, entered by hand or found through the agency's fare providers; anyone can browse them, and registered customers request options or book with their passengers' details; the admin confirms availability, the customer pays outside the system, the admin marks the booking paid, uploads boarding passes and sends them by email, and the customer can also open them in the app.
- **Tours**: scheduled tours with fixed dates, slots and price options, which customers book at once.
- **Hotels**: the hotels, lodges and camps the agency works with, priced per night by season; customers request a stay, the admin confirms it with the hotel, marks it paid and sends the hotel's voucher.

Around them: customer accounts, featured items on Explore, reviews, the admin dashboard, support chat, agency themes and one shared mobile app. On the root host, the platform's system owner manages agencies, their modules, themes, plans and invoices, and the public sales website lives there.

Many integrations are still to come, so much of the work is done by hand for now: bookings and invoices are paid outside the system and marked paid manually, and booking and ticketing happen in the agent's own GDS. Offers are entered by the admin, or found by searching the agency's routes (by hand or on a schedule) through its fare providers and published after review or automatically; later searches keep published offers' prices up to date.

An agency may connect any fare provider of its choosing (Duffel, Travelport, Sabre or Amadeus for now), several at the same time, or none: the system works fully without one.

Planned (not yet specified or built):
- Payment integrations, replacing the manual "mark paid" steps. When they come, a tour booking will be confirmed on payment; nothing prepares for that yet.

This document describes the system as it stands. Work is delivered in numbered steps (§20); new steps are appended there.

## 1. Rules

- PostgreSQL only (development, tests, production). No Docker; PostgreSQL and Redis run locally.
- No TODOs, stubs, placeholder code, mock data, or unused fields, endpoints, models or dependencies.
- Out of scope until specified in a step: payment processing; booking or ticketing through GDS or airline APIs (providers are used for fare searches only); connections to hotel suppliers (bed banks, channel managers). Out of scope: push notifications, email verification, re-sending passes after completion, multi-currency for bookings, multi-language, social login, packages, blog.
- Agency prices (offers, bookings, tours, hotels) are USD, defined once as `CURRENCY`; no currency column on them. Platform prices use `PLATFORM_CURRENCY`. Fares from providers keep their original currency and are converted to USD for every calculation and comparison; customers only ever see USD.
- Time zone Africa/Nairobi, `USE_TZ = True`; all user-facing times (deadlines, timelines, chats) are Nairobi time, and months and "today" are Nairobi calendar months and days. The one exception is flight times: the local times of the airport concerned, as printed on tickets (an arrival on a later day shows "+1"), stored as date and time with no time zone.
- "Admin" is the agency owner's in-app role (`User.role == "admin"`). Django's admin site is technical support only, mounted at `/django-admin/` for superusers. Never mix the two.
- Every model's primary key is a UUID (`default=uuid.uuid4`), and so is every id in URLs and API bodies. Only Django's framework tables keep numeric keys. Airports are identified by IATA code in the API. A malformed id returns 404.
- State changes (flight, tour and hotel bookings) go through the module's services: atomic, `select_for_update`, validating move and actor, writing an event and queuing email on commit. Views never set status.
- Web first: when web and native conflict, choose web. The app must compile for native but is verified in the browser.
- Files: preview first. Anything the browser can display (PDF, PNG, JPEG, WebP, GIF) opens in a new tab ("Open", "Open PDF"); only other files download, and a blocked tab falls back to download.
- Ambiguities: pick the simplest option and add one line to DECISIONS.md.

## 2. Stack and configuration

- Backend: Django, DRF, Simple JWT (access 30 min, refresh 7 days), django-filter, django-cors-headers, django-environ, django-tenants, Celery + Redis (broker and results, `task_acks_late`, JSON, beat schedule in settings), fpdf2 (invoice PDFs), nh3 (HTML sanitizing), Pillow, httpx (fare providers and the rate feed; Travelport's XML is read with the standard library's parser), cryptography (Fernet, provider credentials). Tests: pytest, pytest-django, freezegun; external APIs through httpx's mock transport, never the network.
- Settings from `backend/.env`: `SECRET_KEY`, `DEBUG`, `DATABASE_URL`, `REDIS_URL`, `ALLOWED_HOSTS`, `TENANT_BASE_DOMAIN`, `CORS_ALLOWED_ORIGIN_REGEXES`, `FRONTEND_URL` (with `{domain}`: the agency's app address, §3), `NUM_PROXIES`, `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `ADMIN_EMAIL`, `PLATFORM_CURRENCY`, `INTEGRATIONS_KEY` (Fernet key), `EXCHANGE_RATES_URL` (default the free ExchangeRate-API USD feed), and optionally `IOS_APP_ID`, `ANDROID_PACKAGE`, `ANDROID_CERT_FINGERPRINTS` (the mobile app's link verification files, §18.4).
- Email: console when `EMAIL_HOST` is empty, SMTP otherwise, locmem in tests.
- DRF: page size 20, JSON (multipart only for uploads), register/login/password-reset throttled at 10/min per IP, Django password validators on registration and reset. Errors use DRF's format; invalid booking transitions return 409.
- Private storage (`backend/private_media/`, never served by URL) for boarding passes, hotel vouchers, invoice PDFs and chat attachments. Public storage (`backend/media/`, served at `/media/`) for airline logos, tour photos and hotel photos. Stored names are random UUIDs plus extension.
- Frontend: Expo + TypeScript with react-native-web, React Navigation (every screen has a browser URL), TanStack Query, axios, react-hook-form + zod, expo-secure-store (native tokens), @expo/vector-icons (Ionicons), react-native-svg (+ transformer for native flags), TipTap (web rich text). `EXPO_PUBLIC_API_URL` may contain `{host}`, replaced by the page's hostname (on native: the stored agency's address); `EXPO_PUBLIC_PLATFORM_HOST` names the root host; `EXPO_PUBLIC_TENANT_BASE_DOMAIN` (e.g. `diramanifest.com`), `EXPO_PUBLIC_APP_STORE_URL` and `EXPO_PUBLIC_PLAY_STORE_URL` serve the mobile app (§18.4).

## 3. Multitenancy and accounts

Tenancy
- One PostgreSQL schema per agency (django-tenants), chosen by hostname. Agency: `<schema>.<TENANT_BASE_DOMAIN>` (its primary domain); extra domains can be added.
- Public schema = the platform: apps `tenants`, `airports`, `airlines`, `rates`, `accounts` (system owner accounts), `support` (platform desk). Agency schemas: `accounts`, `catalog`, `requests`, `bookings`, `core`, `support`, `integrations`, `tours`, `hotels`, `reviews`. The same email may hold separate accounts at different agencies.
- Root host: the platform's API (`/api/platform/`) and `/django-admin/`. Any other `/api/` path there, or any unknown host, returns 404 `{"code": "no_tenant"}`.
- Suspended agency (`is_active` false): every `/api/` call returns 403 `tenant_suspended` with the agency's name as `agency_name` (non-payment message names the billing contact email); its scheduled jobs and emails are skipped. Agencies are never deleted.
- Schema names: 3–30 lowercase letters, digits, hyphens, starting with a letter; reserved `public`, `www`, `api`, `admin`, `app-admin`. Hyphens become underscores in the schema, not in the domain.
- **App address**: every agency is reachable at `<code>.<TENANT_BASE_DOMAIN>` (its code is its schema name with hyphens, as typed). App links only work on addresses the mobile app declares, and it can declare `*.<TENANT_BASE_DOMAIN>` but not agencies' own custom domains, so every link in agency emails (reset links included) uses the app address, even when the agency's primary domain is a custom one; `FRONTEND_URL`'s `{domain}` is that address.
- JWTs carry a tenant claim; a token is refused (401) at any other tenant. Reset links are invalid at other agencies.
- Celery tasks touching agency data take `schema_name` first, run in that schema, and skip missing or inactive agencies. Beat tasks run their job in every active agency in turn; one agency's error is logged and does not stop the rest.
- `tenants.services.create_agency` (used by the platform app, `/django-admin/` and `manage.py create_agency`, which takes `--theme <name>`) validates the name, creates tenant, schema, primary domain and first admin, sets the notification email, takes a theme (default: the default theme) and the modules (flights only when left out), and leaves nothing behind on failure.

Accounts (per agency)
- **User**: email login (unique), full_name, phone, role (customer / admin), is_active, date_joined (set on creation; null for users created before step 41). Registration creates customers only (and sends the welcome email); admins via `create_agency` or `create_admin`.
- Admins manage users: customers, or the agency's admins; deactivate instead of delete, never your own account; email an active user the reset link; promote an active customer to admin. Customers an admin creates get a set-password email.
- Admins can book flights, tours and hotels for an active customer; there is then no "new booking" email to the admins.
- **AppSettings** (single row): payment_instructions, payment_hold_hours (24), reminder_hours_before (4), admin_notification_email.

## 4. Modules

An agency buys flights, tours and hotels as separate modules: any one, any two or all three. The owner switches them on per agency. Modules are not tied to plans: billing is manual, so the owner sets an agency's modules to match what it pays for, as with its search allowance, and plan descriptions say what each plan includes.

- **Tenant**: flights_enabled, tours_enabled, hotels_enabled; at least one is on (database check). New agencies get flights only unless told otherwise.
- **Flights** covers offers, requests for options, flight bookings and boarding passes, flight passengers, fare providers, routes, fares and fare searches (the search allowance), with their emails and scheduled tasks. **Tours** covers §7 and **Hotels** §8. Reviews of each kind and featured items belong to their module.
- Always on: accounts and users, support chat, app settings (payment instructions, hold and reminder hours, notification email), theme, billing and plans.
- A module that is off: its endpoints (public, customer and admin) return 404 `{"code": "module_off"}`; its scheduled tasks skip the agency; a queued email re-checks and is dropped; its figures are left out of the dashboard and Explore; its reviews are kept but not shown. Its data stays and is all back when the module is turned on again.
- Turning a module off is refused (409, e.g. "3 open flight bookings") while it has open bookings: flight bookings requested, availability confirmed or paid; tour bookings confirmed on a tour that has not ended; hotel bookings requested, availability confirmed or paid. Turning the last module off is refused (400). Turning one on is always allowed.
- The agency app reads `modules` with the agency, before the first screen (as the theme), and shows only what they include (§18.2). A `module_off` answer (an old link, or a module turned off while the app is open) shows "This part of the site isn't available" with a link home.

## 5. Flights

### 5.1 Airports and airlines (shared)

- **Airport**: code (IATA, unique), name, city, country, country_code (ISO alpha-2). `seed_airports` loads OurAirports data (IATA code, scheduled service, not closed), idempotent.
- **Airline**: iata_code (unique, 2 chars), icao_code, name, country, is_active, logo (PNG/JPEG/WebP ≤ 200 KB, content-checked; old file deleted on replace/remove), updated_at. `seed_airlines` adds missing active airlines from OpenFlights data (one per IATA code, preferring one with ICAO) and never changes existing rows. Curated by the owner in `/django-admin/`; never deleted.
- `fetch_airline_logos` fills missing logos from Travelpayouts' square airline images (`https://pics.avs.io/al_square/200/200/<IATA>.png`, a 200×200 PNG with the airline's symbol filling the square): for each active airline without a logo, or only the codes given with `--codes KQ,EK`, it downloads the image one at a time (10 s timeout) and saves it through the logo validation; a non-200 answer, a non-PNG or a file the validation refuses is skipped, and one failure never stops the run. It never replaces a logo, and prints how many were saved, not found and failed, with the codes saved. Images are matched by IATA code only, so a reused code can bring another airline's logo: the owner removes or replaces it in `/django-admin/` (a later full run fetches a removed one again; `--codes` limits a run).

### 5.2 Offers and itineraries

Conventions: an itinerary is a list of **segments** (one flight each); connections are derived from consecutive segments. A return price is the total for the round trip per adult; return trips go back from the destination to the origin (no open jaws or multi-city). Baggage is per passenger: checked pieces and their weight, and cabin bag weight (e.g. "1 × 23 kg checked, 7 kg cabin"). Fare conditions are summarised as refund and change policies.

- **Offer**: trip_type (one_way / return, default one_way), origin, destination (Airport), departure_date (the first outbound segment's departure date), return_date (the first return segment's date; null for one-way), ticket_class (economy / premium_economy / business / first), price (per person; for a return, the round trip), airline (the ticketing airline, shown in the badge; active on create/change), baggage per passenger (checked_bags 0–3, checked_bag_kg and cabin_bag_kg, null = not stated), refund_policy and change_policy (not_allowed / with_fee / free, default not_allowed), valid_until, is_public, is_active, is_featured (default false, §11), created_at; source (manual / gds) and, for GDS offers only (null otherwise), integration, route, provider_ref, fare_key, net_amount, net_currency, net_usd, rate, rate_date, fare_type, price_checked_at, price_edited (the admin changed the price since publishing), missing_since (review-mode routes: not found by searches since then). Origin, destination, departure_date and return_date are derived from the segments, not sent. Validation: price > 0, valid_until ≤ departure_date and ≥ today on create. Bookable = active, valid_until ≥ today, departure ≥ today. Non-public offers exist only for one customer's request responses. Never deleted.
- **OfferSegment / BookingSegment** (related_name "segments", cascade): one flight each: direction (outbound / return), position (from 1 within a direction), airline (marketing carrier), flight_number (1–4 digits and an optional letter), operating_airline (null unless a codeshare), origin, destination, departure_date, departure_time, arrival_date, arrival_time (local).
- Validation per direction: 1–5 segments (at most 4 connections); the first leaves from the direction's start (outbound: origin; return: destination) and the last arrives at its end; each leaves from the airport the previous one arrived at and after it lands; origin ≠ destination on each segment; an arrival date is between one day before and two days after its departure date; the outbound flights end elsewhere than they start. One-way offers have no return segments; return offers need both directions, and the first return departure is after the last outbound arrival. Only active airlines on create or change.
- Connections are derived per direction between consecutive segments: airport, wait in minutes (next departure minus arrival, same airport so same local time) and kind (layover < 24 h ≤ stopover). `stop_count` per direction; `max_stopovers` filters on the direction with the most connections.
- Offer visibility for customers: public and active, or attached to a response to one of their queries (detail and booking only).

### 5.3 Requests for options

- **Query**: user, origin, destination (one required), date_from, date_to, trip_type (blank = any, one_way, return), return_date (optional; return only), price_min, price_max, ticket_class, max_stopovers, message, status (open / responded / closed). Requests do not take passengers.
- **QueryResponse**: query, message, offers (M2M; existing offers and new custom ones, non-public), created_at; creating one marks the query responded. Customers can close their queries.

### 5.4 Bookings

- **Booking**: user, offer, airline (the ticketing airline, copied from the offer; confirming with changes may change it), query, passenger_count (1–9; never changes after booking), notes, unit_price (copied), source, integration and fare_key (copied from the offer; null for manual offers), status, payment_deadline, reminder_sent_at, review_requested_at, trip fields (trip type, return date), segments, baggage and fare conditions copied from the offer at creation (later offer edits never change them), changes (JSON of old/new unit_price, airline and segments, as readable lists: flight, route, local times; null when none), changes_accepted, alternatives (Query of suggested options), created_at. Total = unit_price × passengers. No second active (requested / confirmed / paid) booking per user per offer.
- **BookingEvent**: booking, from_status, to_status, actor (null = system), created_at. Written on creation and every change.
- All changes go through `bookings/services.py` (`create_booking`, `transition`).

| From | To | Who | Notes |
| --- | --- | --- | --- |
| requested | availability_confirmed | admin | Needs payment instructions. Sets deadline = now + hold hours. Optional new unit_price/airline/segments (same trip type and route; an active airline or the booking's own) recorded in `changes`. |
| requested / confirmed | unavailable | admin | Optional suggested offers: creates a responded Query (the booking's route, dates and trip type) linked as `alternatives`. |
| requested / confirmed | cancelled | customer | No email. |
| requested / confirmed | expired | system | Stale request (the flight departed) or deadline passed. |
| availability_confirmed | paid | admin | Refused after the deadline or while changes await acceptance. |
| availability_confirmed | declined | customer | Only while changes await acceptance. No email. |
| paid | completed | admin | "Send boarding passes"; needs at least one pass. |

- Customers accept changes with `accept-changes` (409 unless awaiting). Admins can book for an active customer.

### 5.5 Passengers

- A flight booking has exactly `passenger_count` travellers (§9, Traveller.booking). Creating a booking, by the customer or by an admin for a customer, needs them all: 400 when the number differs or a passenger is incomplete.
- **Required for each passenger**: full_name, gender, date_of_birth (not in the future, at most 120 years ago), nationality, document_type, document_number, and document_expiry for a passport (after the last flight's date; a passport expiring sooner is refused with "Passport expires before the trip"). Optional: email, phone, baggage, special_requests.
- The customer edits passengers while the booking is requested; once availability is confirmed only an admin can, until the booking is completed. No add or delete: the count is fixed. No email is sent for passenger changes.
- Bookings made before step 47 have no passengers; they show "No passenger details recorded" and are never blocked by these rules.

### 5.6 Boarding passes

- **BoardingPass**: booking, file (private, `boarding_passes/<schema>/<booking>/`), original_name, uploaded_at. PDF/PNG/JPEG ≤ 5 MB, content-checked, ≤ 10 per booking. Upload and delete only while paid; delete removes the file. The admin can open them; the customer once completed.

## 6. Fare search

An agency connects one or more fare providers and keeps a list of routes; routes are searched by hand or on a schedule, the fares found are reviewed and published as offers with the agency's markup (or published automatically), and later searches refresh published offers. Agencies without an integration see none of this. Booking and ticketing stay manual, in the agent's own GDS terminal; routes, runs, fares and offers work across providers, and a route can search several at once. Code: `integrations/services.py`; providers in `integrations/providers/`.

### 6.1 Integrations and providers

- **Integration**: provider (duffel / travelport / sabre / amadeus), name, mode (test / live), credentials (Fernet-encrypted JSON of the provider's fields, key `INTEGRATIONS_KEY`, never returned by the API), is_active, last_tested_at, last_test_ok, last_test_message, created_at. Several per agency; disabled, never deleted.
- One provider interface (`search(request) -> results`, `test()`). The request holds origin, destination, departure date, return date (or none), cabin and max connections for 1 adult. Each result is normalised to the offer itinerary shape plus net amount and its currency (as the provider priced it), baggage, fare conditions, fare type (public / private / unknown), seats left (or null), the provider's reference and its expiry. Technical stops inside a segment are ignored by every provider.
- **Duffel**: offer requests (`POST /air/offer_requests?return_offers=true`, `Duffel-Version: v2`, one adult, cabin, max connections when set). Credentials: access token. Slices → directions, segments with marketing and operating carriers, flight numbers, airports and local times, checked bags included on every flight → `checked_bags` (weight null when not given), refund and change conditions → policies (no condition: not allowed; a penalty of zero: free; otherwise with a fee), `private_fares` → fare type; seats left are not given. Test connection lists one airline.
- **Travelport** (Universal API, the API its free 30-day trial covers; Air schema v52): `LowFareSearchReq` over its XML/SOAP endpoint (pre-production in test mode, production in live), HTTP Basic auth as `Universal API/<username>` with the password, the target branch on every request; one adult, a leg per direction, the cabin and max connections when set, priced solutions. Credentials: username, password, target branch. Journeys → directions, air segments with marketing and codeshare operating carriers and local times, the fare components' baggage allowance → `checked_bags` and weight, refundable / exchangeable with their penalties → policies, private or negotiated fares → fare type, the fewest booking counts → seats left, the latest ticketing time → expiry. A SOAP fault is a provider error. Test connection pings its System service.
- **Sabre** (REST, Bargain Finder Max v5, grouped itinerary response): `POST /v5/offers/shop` on the certification host in test mode, production in live, with a bearer token from `POST /v2/auth/token` (client credentials; the client id `V1:<user id>:<PCC>:<domain>` and the password each base64-encoded, joined by a colon and base64-encoded again), taken once per provider instance. Credentials: user id (EPR), password, pseudo city code (PCC), domain (`AA` for agencies; Dev Studio accounts are given theirs). Request: the PCC in the point of sale, one adult (ADT), an origin–destination per direction with its date, the cabin as the only cabin allowed, max connections as the most stops when set, penalty information asked for (not filtered on). Mapping: legs → directions; schedules → segments with marketing and operating carriers and flight numbers, airports and local dates and times (the leg's date with the schedule's day adjustments; offsets dropped); the total price and its currency; the validating carrier → ticketing airline; checked baggage allowances → `checked_bags` (fewest across allowances, a weight alone being one bag) and kilograms when every allowance gives them; refund and exchange penalties before departure → policies (no penalty information: not allowed; allowed with a zero amount: free; otherwise with a fee); fare type unknown; the fewest seats available → seats left; the last ticketing date and time → expiry; the itinerary's id → provider reference. An HTTP error, or a response whose messages carry an error and no itineraries, is a provider error with Sabre's message. Test connection takes a token (it searches nothing).
- **Amadeus** (REST, Flight Offers Search v2; Amadeus closed its self-service sign-up in 2026, so agencies get keys through an Amadeus Enterprise agreement): `POST /v2/shopping/flight-offers` with `X-HTTP-Method-Override: GET` on `test.api.amadeus.com` in test mode, `api.amadeus.com` in live, with an OAuth2 bearer token from `POST /v1/security/oauth2/token` (client credentials), taken once per provider instance. Credentials: API key, API secret. Request: one adult, an origin–destination per direction with its date, GDS sources, the cabin as a cabin restriction on every direction, max connections (Amadeus allows at most 2) when set. Mapping: itineraries → directions; segments with marketing and operating carriers, flight numbers, airports and local dates and times; the grand total and its currency; the first validating airline → ticketing airline; included checked bags per segment → `checked_bags` (fewest across segments, a weight alone being one bag) and kilograms when every segment gives them; refund and change policies not allowed (the search does not state conditions); negotiated or corporate fares private, published ones public; bookable seats → seats left; the last ticketing date → expiry; the offer's id → provider reference. An HTTP error is a provider error with Amadeus's error detail. Test connection takes a token (it searches nothing).
- Sabre and Amadeus are built from their documented shapes and tested with recorded responses; they cannot be tried against the live services from here. The README explains how to obtain each provider's test (trial, certification) and production access.
- A result is skipped (and counted in the run's errors) when an airline or airport is not in the shared tables or it breaks the itinerary rules (§5.2) for the route; every other result is valid and stored, whatever its currency.

### 6.2 Currency conversion

- **ExchangeRate** (public, app `rates`): currency (ISO 4217), units_per_usd (8 decimals), date, source (feed / manual), fetched_at; one row per currency per date; USD is always 1 and has no rows.
- `rates.convert(amount, currency, on)` gives the USD amount (÷ rate, half-up to the cent), the rate and its date, from the latest rate on or before `on`; no rate raises, a rate more than 3 days older is used but reported stale. Every stored conversion keeps its rate and rate date, so figures never change when rates do.
- `fetch_exchange_rates` loads the day's rate per currency from `EXCHANGE_RATES_URL` (credited where rates are shown); a manual rate for a currency and date is never overwritten by the feed. The owner can set today's manual rate for a currency.

### 6.3 Routes and searches

- **Route**: origin, destination, trip_type, stay_nights (return only, 1–60), ticket_class, max_connections (0–4, null = any), airlines (M2M, ticketing airlines; empty = any), integrations (M2M; empty = every active one), weekdays (departure weekdays to search, 0 = Monday; empty = every day), schedule (manual / daily / weekly) and schedule_weekday (weekly only), window (fixed: window_from–window_to, at most 60 days; rolling: days_ahead_from to days_ahead_to days ahead, the difference ≤ 60; default rolling 1 to 30), auto_publish (false; otherwise review mode), pick_cheapest, pick_cheapest_direct, max_per_date (1–5), markup_percent and markup_fixed (≥ 0; selling = net USD × (1 + percent/100) + fixed, half-up to the cent), is_active, created_at.
- **SearchRun**: route, trigger (manual / scheduled / recheck: one search for a booking's fare, storing no fares), date_from, date_to, status (queued / running / done / failed / skipped: a scheduled run that could not start, the reason in errors), searches_made (the planned count while queued), fares_found, errors (short messages), started_by, created_at, finished_at.
- **Allowance**: Tenant.monthly_search_allowance (1500) fare searches per Nairobi calendar month, edited by the owner; used = summed `searches_made` of the month's runs (re-checks included).
- **Search now**: over the route's window from today on (a rolling window counted from today, a fixed one without its past days); needed = matching weekdays × the route's active integrations; refused with 409 naming both numbers when more than what is left of the month's allowance, and with 409 when the window has passed, no date falls on the weekdays or there is no active integration.
- **Scheduled**: hourly, from 02:00 Nairobi time, each active daily route without a scheduled run today and each active weekly route on its weekday without one this week gets a run (trigger scheduled) over its window. One that cannot start (over the allowance, or nothing to search) is recorded as a skipped run with the reason, which counts as that day's or week's run.
- The run is a tenant Celery task: one search per date per integration, a provider error recorded and the run going on; failed when every search failed.

### 6.4 Fares, picking and publishing

- **Fare**: every valid result of a run: run, route, integration, itinerary (segments in the offer input shape), trip_type, ticket_class, airline (ticketing), net_amount and net_currency (as priced), net_usd, rate, rate_date (null with no_rate when the currency has no rate), selling_price (USD, net_usd plus markup), baggage and fare conditions, fare_type (public / private / unknown), seats_left, provider_ref, fare_key (each segment's carrier, flight number and date, plus the cabin), expires_at, picked (chosen by the route's pick rule), status (new / published / dismissed), offer (null until published), created_at. Each is converted at the run's date. Kept 30 days for comparison (price history per route and date), published ones longer.
- Picking, per run, in USD: the route's cabin, connections and airlines; one fare per fare_key (the cheapest in USD across integrations); per departure date the `max_per_date` cheapest and/or the cheapest direct. Earlier new fares for the same dates stop being picked (kept for price history). Fares without a rate are never picked or published.
- Publish: a GDS offer from the fare (itinerary, baggage, conditions, source fields including the original amount and conversion, price_checked_at = the run's end) with the admin's price, valid_until (≤ departure, ≥ today) and visibility; an active offer with the same fare_key gets the new price, net and conversion fields and price_checked_at instead (and is no longer missing or edited). Only new fares are published; dismissing hides one (published ones cannot be). Changing a GDS offer's price in the admin's offer form marks it edited.
- Refresh, after every run that is not failed: the route's active GDS offers departing on a date at least one search answered for. One found (a fare with its fare_key, the cheapest in USD) gets the fare's net amount, currency and conversion, the selling price (net USD at the run's rate + markup; on a review-mode route only while not edited) and price_checked_at = the run's end, and is no longer missing; a fare without a rate only clears missing. One not found is deactivated on an auto-publish route, otherwise marked missing (`missing_since`, kept from the first search that missed it; shown to the admin as "Not found in the last search").
- Auto-publish routes then publish the run's picked new fares as the publish dialog's defaults would: selling price, valid until today + 7 days (at most the departure), public. A fare that cannot be published is noted in the run's errors.

### 6.5 Booking re-check

- `integrations.services.recheck_fare`: for a requested booking with a GDS source, the admin searches its flights again: one search of the booking's departure and return dates, route, cabin and trip type, with at most as many connections as the booking has, through the booking's integration, counted against the allowance as a run of the offer's route with trigger recheck. Results pass the same skip rules against the booking's route.
- The answer is the booked fare_key's current original amount, USD equivalent (today's rate), selling price (the route's current markup), ticketing airline and segments, or "not found" with up to 3 cheapest other fares on the same dates. Nothing changes on the booking; the admin applies the answer through confirm availability.
- Refused with 409 for manual bookings, any status but requested, a disabled integration or no search left (naming both numbers); a provider error answers 502 with its message and the search still counts.

## 7. Tours

An agency sells tours, for example "Maasai Mara, 3 days", on fixed dates with a fixed number of slots, each with one or more price options (Regular, VIP, Child, Couple, Group of 6 and so on). A signed-in customer books on their own: as long as slots are left, choosing options books them at once, with no admin step. The booker is the account holder; traveller details are optional and can be added later, since people often buy for others or as gifts. An admin can change or cancel a tour after people have booked, and tell them by email in their own words. Prices are USD.

Model (per agency, app `tours`)
- **Tour**: title (≤ 120), destination (≤ 120, free text, e.g. "Maasai Mara, Kenya"), start_date, end_date (≥ start_date), slots (1–500, the tour's capacity in people), booking_deadline (the last day customers can book; ≤ start_date; the form proposes the day before the start), cancellation_deadline (the last day customers can cancel; ≤ start_date; the form proposes the day before the start), cancellation_policy (plain text ≤ 2,000, required), summary (≤ 300, plain text, shown on cards), description (sanitized rich HTML ≤ 10,000 characters), included and not_included (lists of short lines, ≤ 30 each of ≤ 200 characters), meeting_point (≤ 200, blank allowed), departure_city (≤ 80, blank allowed; where the tour starts, e.g. "Nairobi"), organiser (≤ 120, blank allowed; the company or sponsor running the tour), is_active, is_featured (default false, §11), cancelled_at and cancelled_by (null unless cancelled), created_at, updated_at. Never deleted.
  - Slots left = slots − people on its confirmed bookings. Slots cannot be set below the people already booked. Duration = end − start + 1 days.
  - Every other field can change at any time, bookings or not, except on a cancelled tour (409). Existing bookings keep the prices they were booked at.
- **TourPriceOption**: tour, name (≤ 60, unique within the tour, e.g. "VIP", "Child (3–11)", "Couple", "Group of 6"), description (≤ 200, blank allowed), price (> 0, for one unit), people_per_unit (1–20: 1 for a per-person price, 2 for a couple, 6 for a group of six), units_available (null = limited only by the tour's slots; otherwise how many units of this option can be sold, e.g. 10 VIP places), position, is_active. At least one per tour. An option that has been booked cannot be deleted, only deactivated; an inactive option is not offered. Units left = units_available − units on confirmed bookings (null when unlimited). units_available cannot be set below the units already booked.
  - A tour's **from price** is the lowest price per person across its active options (price ÷ people_per_unit, half-up to the cent).
- **TourPhoto**: tour, image (PNG/JPEG/WebP ≤ 2 MB, content-checked, public storage `tours/<schema>/<tour>/`), position, created_at. At most 8 per tour; the first is the cover. Deleting a photo deletes its file.
- **TourBooking**: tour, user (customer), created_by (the admin when booked for the customer, null otherwise), people (the sum of the lines' people, 1–40), group_name (≤ 80, optional, e.g. "Otieno family"), notes (≤ 1,000), status (confirmed / cancelled / completed), cancelled_by (customer / admin, null otherwise), cancel_reason (≤ 2,000, the admin's message, blank otherwise), review_requested_at, created_at. Total = the sum of its lines.
- **TourBookingLine**: booking, option, and copied at booking: option_name, unit_price, people_per_unit; quantity (≥ 1). Line total = unit_price × quantity; its people = people_per_unit × quantity. One line per option per booking. Its travellers (§9): at most its people (a Couple line of quantity 2 holds up to 4; a Group of 6, up to 6); fewer, or none, is fine.
- **TourBookingEvent**: booking, from_status (null on creation), to_status, actor (null = system), created_at.
- **TourNotice**: tour, kind (change / cancellation), message (≤ 2,000), sent_by, recipients (how many bookings it was emailed to), created_at. The record of every message the admin sent about the tour.

Listed and bookable (for customers)
- **Listed**: active, not cancelled, today (Nairobi) on or before booking_deadline and before start_date, and at least one active price option. Tours whose bookings have closed, and cancelled or inactive tours, are hidden.
- **Bookable**: listed, at least one slot left, and at least one active option with units left (null or above zero). Booking closes at the end of the booking_deadline day.
- **Fully booked**: listed but not bookable for want of slots or units. Fully booked tours stay visible on Explore and in search; only selling stops. `not_bookable_reason`: fully_booked / closed / cancelled.

Booking rules (`tours/services.py`, atomic, the tour locked with `select_for_update`, so two bookings can never take the last slot or the last unit of an option together)
- Booking: one or more lines (active options of the tour, quantity ≥ 1), each with optional travellers (up to its people), an optional group name and notes. The booker's account must have a phone (the form asks for one and saves it to the account when missing); it is the booking's contact. The people must fit in the slots left (409 "Only N slots left") and each line in its option's units left (409 "Only N VIP left"). The booking is confirmed at once.
  - **Customer**: the tour must be bookable (otherwise 409 naming why: fully booked ("This tour is fully booked"), bookings closed, cancelled).
  - **Admin for a customer** (an active customer): the tour must be active, not cancelled and not yet started; the booking deadline does not apply.
- Several bookings by one customer on one tour are allowed (for example a second group).
- **Travellers** are added, edited and removed by the booker or an admin while the booking is confirmed, within each line's people. No email is sent for traveller changes.
- **Customer cancels**: a confirmed booking, until the end of the cancellation_deadline day. Slots and units are freed.
- **Admin cancels one booking**: a confirmed booking, at any time before the tour ends, with an optional message (≤ 2,000) emailed to the customer. Slots and units are freed.
- **System completes**: daily, confirmed bookings whose tour ended before today become completed.
- Every booking change writes a TourBookingEvent and queues its email on commit.

Changing or cancelling a tour that has bookings
- **Save with a notice**: saving a tour (fields, dates or options) that has confirmed bookings may carry a message (≤ 2,000). With a message, the save writes a TourNotice (kind change) and emails every customer with a confirmed booking on it; without one, nobody is emailed. Photo changes alone never send a notice.
- **Cancel tour**: needs a message (required, ≤ 2,000). In one transaction it marks the tour cancelled (cancelled_at, cancelled_by, inactive), cancels every confirmed booking (cancelled_by admin, cancel_reason = the message, an event each), writes a TourNotice (kind cancellation) and emails every one of those customers once per booking. A cancelled tour cannot be reactivated or edited.

## 8. Hotels

An agency sells stays at the hotels, lodges and camps it works with. The admin lists each hotel with its room types and rates, priced per night by season. The agency cannot see the hotel's free rooms, so booking works as for flights: the admin checks availability with the hotel and confirms, possibly at a different price; the customer pays outside the system before the deadline; the admin marks the booking paid; then the admin uploads the hotel's voucher with its confirmation number and sends it. Prices are USD per room per night, optionally plus a charge per adult (for example breakfast), and include taxes; children are not priced separately.

Model (per agency, app `hotels`)
- **Hotel**: name (≤ 120), destination (≤ 120, free text, e.g. "Diani Beach, Kenya"), address (≤ 200), star_rating (1–5, null = not rated), summary (≤ 300, plain text, shown on cards), description (sanitized rich HTML ≤ 10,000), amenities (a list of ≤ 30 short lines of ≤ 100), check_in_time, check_out_time, cancellation_policy (plain text ≤ 2,000, required), is_active, is_featured (default false, §11), created_at, updated_at. Never deleted.
- **HotelPhoto**: as TourPhoto, at most 12 per hotel, public storage `hotels/<schema>/<hotel>/`; the first is the cover.
- **RoomType**: hotel, name (≤ 80, unique within the hotel, e.g. "Deluxe Double", "Family Tent"), description (≤ 300), max_adults (1–10), max_children (0–6), position, is_active. A room type that has been booked cannot be deleted, only deactivated.
- **RoomRate**: room_type, name (≤ 60, unique within the room type, e.g. "Bed & breakfast, single use", "Full board, East Africa resident"), inclusions (a list of ≤ 10 short lines of ≤ 80, e.g. "Breakfast included", "Free cancellation until 7 days before"), max_adults (1 to the room type's max_adults), max_children (0 to the room type's max_children), per_adult_per_night (≥ 0, default 0; the same in every season, e.g. $15 for breakfast), position, is_active. A rate is one row of the hotel's room table: what is offered, for how many people, at its own price. The per-adult charge lets one rate cover a room used by one or two people (one adult pays one breakfast); hotels that price single use some other way enter it as a separate rate (e.g. "single use" for 1 adult). A booked rate cannot be deleted, only deactivated.
- **RatePeriod**: rate, start_date, end_date (≥ start_date), price_per_night (> 0, the room price). A rate's periods never overlap.
- **HotelBooking**: hotel, user (customer), created_by (the admin when booked for the customer, null otherwise), check_in, check_out (1–30 nights; check-in today or later, Nairobi), status, total (the rooms' sum, copied at booking), changes (old and new total and the admin's note, null when none), changes_accepted, payment_deadline, reminder_sent_at, review_requested_at, unavailable_message (≤ 2,000, blank allowed), hotel_confirmation (≤ 40, set on completion), special_requests (≤ 1,000, passed to the hotel), notes (≤ 1,000), created_at.
- **HotelBookingRoom**: booking, room_type, rate, and copied at booking: room_name, rate_name, per_adult_per_night, price (this room's stay price for its adults); adults (1 to the rate's max_adults), children (0 to the rate's max_children). 1–9 rooms per booking; the same room type and rate may appear more than once, each its own room. Its guests (§9): a lead guest (full name required, the rest optional) and more guests up to its adults plus children.
- **HotelVoucher**: booking, file (private, `hotel_vouchers/<schema>/<booking>/`), original_name, uploaded_at; as boarding passes: PDF/PNG/JPEG ≤ 5 MB, content-checked, ≤ 10 per booking, upload and delete only while paid. The admin can open them; the customer once completed.
- **HotelBookingEvent**: booking, from_status, to_status, actor (null = system), created_at.

Pricing
- A night's price for a room with N adults is the price_per_night of the period that contains it plus N × the rate's per_adult_per_night.
- A stay (check-in to check-out, 1–30 nights) is **offered** at a rate when the hotel, room type and rate are active and every night falls in one of the rate's periods; its price for N adults is the sum of the nights' prices.
- **Adults priced** when showing a rate: the adults searched or chosen, capped at the rate's max_adults; with none given, the rate's max_adults (what its Sleeps column shows).
- A hotel's **from price**, without dates, is the lowest night price among periods of its offered rates that have not ended; with dates, it is the lowest stay price; both for the adults priced.
- Listed (public): active hotels with at least one offered rate.

Booking (`hotels/services.py`)

| From | To | Who | Notes |
| --- | --- | --- | --- |
| requested | availability_confirmed | admin | Needs payment instructions. Deadline = now + hold hours. Optional new total with a note (≤ 500), recorded in `changes`. |
| requested / availability_confirmed | unavailable | admin | Optional message to the customer. |
| requested / availability_confirmed | cancelled | customer | No email. |
| requested / availability_confirmed | expired | system | Deadline passed, or still requested on the check-in day. |
| availability_confirmed | paid | admin | Refused after the deadline or while changes await acceptance. |
| availability_confirmed | declined | customer | Only while changes await acceptance. No email. |
| paid | completed | admin | "Send voucher": needs the hotel's confirmation number and at least one voucher. |

- **Creating**: the customer (signed in) or an admin for an active customer sends the dates, rooms (room type, rate, adults, children, lead guest and any more guests), special requests and notes. Every room must be offered for the dates (409 "Deluxe Double is not available for these dates" otherwise) and the occupancy within the rate's limits (400). The booker's account must have a phone (asked for and saved when missing). Prices are worked out by the server and copied; later rate changes never touch a booking. Admin-made bookings start requested too.
- Customers accept changes with `accept-changes` (the total becomes the new one) or decline them.
- **Guests**: the customer edits them while requested; after that only an admin, until completed. Each room keeps its lead guest.

## 9. Travellers

- **Traveller** (`bookings` app) holds the people on a booking: exactly one of tour_line (TourBookingLine), booking (flight Booking) or hotel_room (HotelBookingRoom), enforced by a database check; related_name "travellers", cascade. Fields: full_name (2–100, as on the travel document, required), gender (female / male / blank), date_of_birth, nationality (ISO alpha-2), document_type (passport / national_id / blank), document_number (≤ 30), document_expiry, email, phone, checked_bags (0–5, default 0), checked_bag_kg (per bag, null = not stated), cabin_bag_kg (null = not stated), special_requests (≤ 500: diet, medical, accessibility), created_at, updated_at.
- Baggage uses the same names and units as an offer's allowance, but is what this traveller is bringing. Document number and expiry go together (expiry optional for a national ID).
- On a tour line or a hotel room every field but full_name may be blank; flight passengers have more required fields (§5.5). Limits per owner: §5.5, §7, §8.
- Travellers are personal data: only the booker and the agency's admins ever see them.
- One shared traveller form in the app serves tour travellers, flight passengers and hotel guests.

## 10. Reviews

Customers who have travelled rate what they bought, and the ratings show where other visitors are choosing. Tours and hotels each collect their own reviews. A flight review rates the agency's flight booking service (how the booking was handled), not the airline or the flight, because offers change constantly and the flight is not the agency's product. Reviews go live at once; the admin can hide one and post one public reply to each. Each module's reviews show only while the module is on.

Model (per agency, app `reviews`)
- **Review**: exactly one of booking (flight Booking), tour_booking or hotel_booking, enforced by a database check, with one review per booking (unique on each). Also: kind (flight / tour / hotel, set from the booking), tour or hotel (copied from the booking for listing; null for flights), user (the booking's customer), rating (1–5), comment (≤ 2,000, blank allowed), is_hidden (default false), hidden_by, hidden_at, reply (≤ 2,000, blank = none), replied_by, replied_at, created_at, updated_at.
- **Reviewer name** shown publicly: the customer's first name and the initial of the last name ("Wanjiru K."). Nothing else about the customer is shown.

Rules (`reviews/services.py`)
- **Can review**: only the booking's customer, once per booking, after the trip has ended:
  - Flight: status Completed and the last segment's date before today (Nairobi).
  - Hotel: status Completed and check_out on or before today.
  - Tour: status Completed (the daily task completes bookings after the tour ends).
  - Cancelled and unavailable bookings can never be reviewed. There is no time limit.
- **Customer edits or deletes** their own review at any time. Editing keeps the reply; deleting also removes the reply.
- **Admin hides or shows** a review. A hidden review's text, name and reply are left out of every public list, but its rating still counts in the average, the count and the bars per star level, so hiding never changes a rating. Its author still sees it, marked "Hidden by the agency". No email is sent either way.
- **Admin replies**: one reply per review, which can be edited or removed. A reply can be posted on a hidden review, but it stays hidden with it.
- **Rating** of a tour or hotel: the average of all its reviews, hidden ones included, to one decimal, and their count. The flight service rating is the same over all flight reviews. Nothing is shown when there are no reviews.
- `request_reviews` (daily, each agency) sends "How was your trip?" once per booking when it becomes reviewable and records `review_requested_at` on the booking.

## 11. Featured and Explore

- Offers, tours and hotels have is_featured. Admins switch it in the item's form and with a star in their tables. There is no limit on how many are featured.
- **Featured on Explore**, per module on, at most six cards: the featured items customers can see (flights: public bookable offers; tours: listed tours, so a featured tour that sells out stays in "Featured tours"; hotels: those the public list shows), then, when fewer than six, the rest filled from the other visible items. Order: featured first, then flights by departure date, tours by start date, hotels by from price (no dates, ties by name).
- Explore's layout is in §18.2.

## 12. Agency dashboard

The admin's dashboard shows how the business is doing and what is coming up across the modules on, at the level of detail the platform dashboard gives the owner, built from the same pieces (stat cards, the plain 12-month bar chart, list cards). Sections are organised by job (what needs action, what was sold, what is coming up, what is on sale), not by module, and each holds rows from every module that is on. With one module nothing names the module; with more, rows carry a small module icon (plane, map pin, bed) and labels name the module only where two would otherwise read the same. Every figure is the agency's own data; figures from a module that is off are left out. There are no review figures.

Definitions
- **A sale**, in USD, in Nairobi months and days:
  - Flight booking: Paid or Completed, dated by its Paid timeline event, amount its total (unit price × passengers).
  - Hotel booking: Paid or Completed, dated by its Paid event, amount its total (the new total when changes were accepted).
  - Tour booking: Confirmed or Completed, dated by its creation, amount its total. Tours have no paid step, so a booking counts when booked and stops counting if it is cancelled.

`GET /api/admin/dashboard`
- `modules`.
- `needs_action`: counts, each present only when its module is on: flights: bookings to confirm (requested), boarding passes due (paid), open requests, awaiting payment (availability confirmed), `new_fares` (picked and new); hotels: `hotel_to_confirm` (requested), `hotel_awaiting_payment` (availability confirmed), `hotel_vouchers_due` (paid); tours: `travellers_missing` (confirmed bookings on tours starting in the next 7 days with fewer travellers than people).
- `overdue_invoice`: the Billing screen's object, or null.
- `sales`: `{this_month, this_year, all_time, count_this_month}` across modules on, each amount `{total, by_module}` (`{flights, tours, hotels}`, modules on only).
- `sales_by_month`: the last 12 months, oldest first, `{month, total, count, by_module}`.
- `payments_due`: flight and hotel bookings awaiting payment with a deadline in the next 48 hours, soonest first, at most 5: `{kind (flight / hotel), id, customer, title (route line or hotel name), total, payment_deadline}`.
- `this_week`: what starts in the next 7 days, soonest first (ties: flights, tours, hotels), at most 8: flight departures (Paid and Completed, with `passenger_count` and `boarding_passes_sent`), tour starts (tours not cancelled with confirmed bookings: `booked`, `slots`, `travellers_missing`) and hotel check-ins (Paid and Completed: `customer`, `nights`, `rooms`, `voucher_sent`); each `{kind, id, date, title, ...}`.
- `top_sellers`: this year's sales grouped by route (origin, destination, trip type), tour and hotel, highest total first (a tour or hotel booking holds several people), at most 5: `{kind, id (tour or hotel; null for routes), title, count, total}`.
- `customers`: `{total, new_this_month}`: active customers; new = registered or added this month.
- `on_sale`, per module on: flights `{bookable, public_bookable, expiring_soon, featured}` and `searches` (`{used, allowance}`, or null without an integration); tours `{upcoming (bookable), fully_booked (listed tours not bookable for want of slots or units), seats_sold, seats_total (active, not cancelled tours starting after today, including closed and fully booked ones), featured}`; hotels `{listed, prices_ending (listed hotels with no rate covering any night beyond 30 days from today), featured}`.

Screen (Admins › Dashboard), top to bottom; two columns from 900 px where noted, one column on phones
- Title and greeting.
- **Needs action**: the emphasised "Overdue invoice" tile first when there is one (amount, number and due date, the suspension date, "View billing"), then the tiles of every module on, in module order ("New fares to review" only when there are any), each opening its screen with the matching filter. Labels name the module only when two would read the same: "Bookings to confirm" with one booking module, "Flight bookings to confirm" and "Hotel bookings to confirm" with both. Tiles at zero still show. The app-wide overdue banner (§16.3) stays.
- **Sales**: stat cards for This month (with the number of sales), This year and All time, across modules on. With more than one module each card has a line underneath, "Flights $X · Tours $Y · Hotels $Z", modules at $0 included.
- **Sales by month**: the 12-month bar chart. With one module, plain bars; with more, each bar is stacked by module in a fixed colour per module (primary, accent and the slate green, shown with a legend). Each bar's accessible label gives the total, each module's amount and the count.
- Two columns: **Coming up** ("Payments due in 48 hours" and "This week": one list each, rows from every module mixed by date, each with its icon when more than one module is on; a flight row shows customer, route, date, passengers and "Passes not sent"; a tour row shows tour, start date, booked of slots and "N travellers missing"; a hotel row shows customer, hotel, check-in, nights and rooms and "Voucher not sent"; empty lines "Nothing due" and "Nothing this week"; rows open the booking or tour) and **Top sellers this year** (one ranked list of routes, tours and hotels, with icons when more than one module is on; empty: "No sales this year yet").
- Two columns: **Customers** (total, new this month; links to Users) and **On sale**: one block per module on, each a heading (only with more than one module) and a line or two with links: Flights (bookable offers, how many public, "N expire within 7 days", featured count, and the searches bar when there is an integration), Tours (upcoming tours, seats sold of seats as a bar, "N fully booked", featured count), Hotels (hotels listed, "N have prices for less than 30 days ahead" in the warning colour, featured count).
- Every section has loading and error states through the one dashboard request, and the screen works at 390 px with no horizontal scrolling.

## 13. Emails

HTML (one base layout, table-based, inline CSS, no images; an agency's emails in its theme's colours (the header bar and anything else that uses the primary or accent), the platform's in Dira Manifest's own) plus plain-text fallback, via `EmailMultiAlternatives`. Tasks take ids only, retry with backoff (max 5), and reload and re-check state before sending (a suspended agency or a module that is off drops them). Every link uses the agency's app address (§3).

Content rules
- Flight emails show the itinerary per direction (flight numbers, local times, connections), baggage and fare conditions, as text in both parts, and list the passengers' names (never documents).
- Tour emails (customer) show the tour, its dates and meeting point, the booking's lines, group name, the travellers entered (names only) and total.
- Hotel emails show the hotel, address, dates, nights, check-in and check-out times, each room with its rate, adults and children and lead guest, special requests and the total.

Agency admin (`admin_notification_email`)
- New request; new flight booking (customer-made only); new support message.
- New tour booking (customer-made only); tour booking cancelled by the customer.
- New hotel booking (customer-made only).
- New review, with the rating, comment and a link (no email on edits).

Customer
- Account: welcome on registration (`send_welcome_email(user_id)`, active users only: welcome to <agency>, a link to the agency's site, and "Get the app": the agency's `/app` link with the agency code); account created by an admin (set-password link and the same "Get the app" lines); password reset.
- Flights: request responded; availability confirmed (payment instructions, deadline, any changes); unavailable (with suggestions link if any); payment received; booking expired; payment reminder; boarding passes (all files attached).
- Tours: tour booked (with the cancellation policy and deadline, and "Pay as your agency instructs": the agency's payment instructions from AppSettings); tour changed (the admin's message, then the tour as it now stands); booking cancelled by the agency (the admin's message); tour cancelled (the admin's message).
- Hotels: availability confirmed (payment instructions, deadline, any new total with the note); unavailable (the admin's message); payment received; booking expired; payment reminder; voucher (the confirmation number, every voucher attached, the cancellation policy).
- Reviews: "How was your trip?", once per booking when it becomes reviewable, with a "Leave a review" link to the booking; the flight version says the review is about the booking service.
- Support reply.
- No email when the customer cancels or declines, or for traveller, passenger or guest changes.

Platform
- Invoice (PDF attached, unpaid only), suspended for non-payment, new platform-desk message to `support_email`, reply to platform requester.

## 14. Scheduled tasks (Celery beat)

| Task | Every | Scope |
| --- | --- | --- |
| `expire_unpaid_bookings` | 5 min | each agency: flight and hotel bookings availability confirmed past the deadline → expired |
| `send_payment_reminders` | 15 min | each agency: flight and hotel bookings, one reminder within `reminder_hours_before` of the deadline |
| `expire_stale_requests` | hour | each agency: requested flight bookings whose flight departed, and hotel bookings still requested on the check-in day → expired |
| `close_idle_chats` | hour | public + each agency: close chats 48 h after the last message |
| `run_due_route_searches` | hour | each agency: scheduled route searches that are due (from 02:00) |
| `issue_due_invoices` | day | public: next invoice when `next_period_start - lead days ≤ today` (one per run, catches up) |
| `suspend_overdue_tenants` | day | public: suspend for non-payment when an unpaid, unwaived invoice is > 1 month past due |
| `fetch_exchange_rates` | day | public: today's rate per currency from `EXCHANGE_RATES_URL`; a manual rate for the day is kept |
| `delete_old_fares` | day | each agency: fares older than 30 days, except published ones |
| `complete_finished_tour_bookings` | day | each agency: confirmed tour bookings whose tour ended before today → completed |
| `request_reviews` | day | each agency: "How was your trip?" once per newly reviewable booking |

## 15. Support chat

Two desks with the same design: each agency's (its guests and customers write, its admins answer) and the platform's (root-host visitors and agency admins write, the owner answers).

- Conversation: subject (≤ 150), email, name, requester (user id or null for guests), agency (platform desk only), status (open / closed), closed_at, closed_by, last_message_at, requester_unread, staff_unread. Message: from_staff, author_name, body (≤ 5,000), optional attachment (PDF/PNG/JPEG ≤ 5 MB, private, `support/<schema>/<conversation>/`).
- A guest's chat is one message; replies reach them by email only. Closed chats refuse messages. New guest chats throttled 10/hour per IP.
- Floating message button on every page for requesters (not for whoever answers that desk): panel with open chats and new-chat form; thread polls every 10 s, unread badge every 30 s.
- Support page for signed-in requesters (customers: Account › Support; agency admins: Settings › Support, to the platform). Chats tab for the desk with Open/Closed filter, unread first, unread count on the tab.
- Plan enquiries: "Get started" (website and public pricing) and "Ask to switch" (agency Plans) open a prefilled chat to the platform desk. The website's "Get started" uses the subject "Getting started with Dira Manifest"; on a plan card it keeps the plan-specific subject.

## 16. Platform

### 16.1 Agencies

- **Tenant**: name, schema_name, is_active, created_at, billing_email, suspension_reason (blank / manual / non_payment), suspended_at, monthly_search_allowance (1500, §6.3), theme (§16.2), flights_enabled, tours_enabled, hotels_enabled (§4). **Domain**: domain, tenant, is_primary.
- The owner creates agencies (§3, `create_agency`), adds domains and picks the primary, sets the theme, modules and search allowance, suspends or restores the agency's admins and emails them the agency's reset link (409 while the admin or agency is suspended), and suspends or reactivates the agency.
- **PlatformSettings** (single row): issuer_details, payment_instructions, invoice_due_days (14), invoice_lead_days (7), billing_contact_email, support_email.

### 16.2 Themes

Each agency gives its site, app and emails its own look by choosing a theme from a list the owner manages. Agencies cannot type in their own colours, and the owner cannot save a theme whose text would be hard to read.

- A theme sets **primary** (top bar, links, selected states; white text on it) and **accent** (prices and main calls to action; dark text #252525 on it). The server derives (`tenants/themes.py`) the primary's **tint** (chat bubbles, highlights; the primary blended 9% over white) and its **hover** shade (white 12% over the primary), so the owner enters only the two colours. Everything else is the same in every theme (§18.1).
- **Theme** (public schema): name (unique, ≤ 40 characters), primary and accent (`#rrggbb`, stored lowercase), is_active, is_default, created_at. Exactly one theme is the default, and it is active; the default cannot be deactivated, and an inactive theme cannot be made default. Themes are never deleted.
- Contrast rules, checked on create and on every change, with the WCAG contrast ratio: the primary at least 4.5:1 against white, against its tint and against the background #f2f4f7; white at least 4.5:1 against the hover shade (white text sits on it in Explore's heading cards and tiles); the accent at least 4.5:1 against #252525. The accent at least 3:1 against the bar (the primary when no bar is set), so accent buttons in the top bar and on the heading cards stand out from it. A failing save is refused with 400 naming the rule and the ratio (for example "White text on this primary is 3.1:1; it needs 4.5:1.").
- **Bar colour** (optional, so any light brand colour works, from yellow, lime or orange to pastels, cream, light grey or white, none of which can be the primary): Theme gains `bar` (`#rrggbb`, stored lowercase, blank = the primary). The bar colours the filled brand surfaces: the top bar (wide and narrow), Explore's heading cards and All tiles, the brand panel beside the sign-in, register, forgot and reset password forms (the agency's name, tagline and benefit ticks in bar_text), the theme preview strip and the emails' header bar; the primary keeps everything else (links, selected states, the module switch's current tab, primary buttons). The server derives **bar_text**, white when white reaches 4.5:1 on the bar and #252525 otherwise, and **bar_hover** (the search panels and tiles on the heading cards, hover in the top bar): white 12% over the bar with white text, #252525 10% over it with dark text. A bar with dark text is light, so where it sits on the page (the top bar's bottom edge, the heading cards) it gets a 1 px border in the neutral #a8b1b5, so even a white bar stands apart from the background. Without a bar all three equal the primary's (primary, white, hover), so existing themes look the same. Rules when a bar is set: bar_text at least 4.5:1 against the bar and against bar_hover, refused with 400 like the other rules (e.g. "Text on this bar colour is 3.9:1; it needs 4.5:1."). The API's theme `colors` gain `bar`, `bar_text` and `bar_hover`; the app reads them as tokens like the rest (§18.1), with Dira Manifest's own values equal to its primary's. The platform Themes form has an optional "Bar colour" field ("Same as primary" when empty) checked live like the others, the table shows a third swatch when set, and the preview uses it.
- **Text colours** (optional, so a brand can use the text colours from its own guidelines): Theme gains `primary_text`, `bar_text` and `accent_text` (`#rrggbb`, stored lowercase, blank = automatic: white on the primary; white or #252525 on the bar as above; #252525 on the accent). When given, the API returns the owner's colour in place of the automatic one, and the hover shade follows it (lighter with a light text colour, darker with a dark one). Every rule that names white on the primary or its hover shade checks the primary's text colour instead, the bar rules check the bar's text colour, and the accent rule checks the accent's text colour (at least 4.5:1 against the accent; light or dark both allowed), so a chosen colour must still reach 4.5:1 or the save is refused with its ratio. Because the primary must also reach 4.5:1 on the page background, only light text colours (white, off-white, cream and the like) can pass on it; a brand that wants dark text on its colour puts that colour in the bar. The Themes form has a "Text colour" field beside the primary, the bar and the accent ("Automatic" when empty), checked live like the others, and the preview uses them.
- **Tenant.theme**: FK Theme, protected, required. Choosing a theme for an agency: an active theme, or the one it already has; anything else is refused with 400.
- Eight starting themes (all of which pass the rules):
  - Indigo & Amber (#1800d2 / #ffb400), the default and Dira Manifest's own colours
  - Navy & Gold (#1b3a6b / #f2c14e)
  - Teal & Coral (#00676b / #ff9a7a; the accent was #ff8a65 until step 58 lightened it to pass the accent-on-bar rule)
  - Forest & Lime (#1e5631 / #a4de02)
  - Burgundy & Sand (#7b1e3a / #f4d58d)
  - Plum & Peach (#5b2a86 / #ffb38a)
  - Charcoal & Sky (#2b2d42 / #8ecae6)
  - Ocean & Sunflower (#0057b8 / #ffd100)
- Editing a theme's colours changes every agency that uses it (from their next load). An inactive theme is no longer offered, but agencies already using it keep it until they choose another.
- `/django-admin/` lists themes read-only and shows the agency's theme as a choice.
- **Dira Manifest's own colours** stay in the code and are used wherever there is no agency: the platform app, platform emails (invoices, suspension, platform desk), the web app's loading state and the mobile Find your agency screen.

### 16.3 Plans and billing

Agencies pay outside the system. `tenants/billing.py`.
- **Plan**: name, kind (subscription / support), description (sanitized rich HTML ≤ 5,000 chars), tag (blank / recommended / basic / advanced; subscription plans only, each tag on at most one plan, cleared on deactivation), monthly_price, annual_price (at least one), is_active, created_at. Never deleted.
- **Subscription**: tenant, plan, kind, billing_cycle (monthly / annual, plan must have that price), started_on, next_period_start, ended_on, created_at. At most one running per kind per agency. Plan/cycle changes apply from the next invoice.
- **Invoice**: number (`INV-<year>-<0001>`), tenant, subscription, plan_name, billing_cycle, period_start, period_end, amount (copied at issue), issued_on, due_on, status (unpaid / paid / void), paid_on, suspension_waived, pdf (private, `invoices/<schema>/`), created_at.
- Starting a subscription (billing_email required, active plan) issues its first invoice at once. `issue_invoice` covers one month or year from `next_period_start`, advances it, renders the PDF, and emails it.
- Owner actions: issue next invoice early, resend, void (unpaid), mark paid (date, default today), mark unpaid.
- Marking paid reactivates an agency suspended for non-payment when nothing else is past the limit. Owner reactivation of such an agency waives its overdue invoices. Manual suspensions are never lifted automatically.
- Agency admins see their plans and invoices (read-only) and a warning banner on every admin screen while an invoice is overdue, naming the suspension date.

## 17. API

Agency host, `/api/`. Endpoints of a module that is off return `module_off` (§4).

Public
- `agency`: `{code, name, app_address, theme, modules}`; a theme is `{id, name, colors: {primary, primary_text, primary_tint, primary_hover, accent, accent_text}}`; `modules` are the ones on, in the order flights, tours, hotels (e.g. `["flights", "tours"]`). The `no_tenant` and `tenant_suspended` answers apply.
- `auth/register`, `auth/login`, `auth/refresh`, `auth/password-reset`, `auth/password-reset-confirm` (same response for unknown emails).
- `airports?search=` (exact code first, ≤ 20).
- `offers` (filters: origin/destination text, date range, `trip_type`, return date range `return_from` / `return_to`, price range, class, `max_stopovers` counted in the busier direction; ordering) and `offers/{id}`. The list response and offer detail carry `service_rating`.
- `tours`: listed tours (filters: `departure_city`, `destination`, `title` and `organiser`, each a case-insensitive "contains", start date range, price range on the from price; ordering by start date (default) or from price; fully booked tours keep their place) and `tours/{id}` (a listed tour, or any tour the signed-in customer has booked). Each tour returns its fields, `slots_left`, `duration_days`, `from_price`, `options` (active ones in order, each with `units_left`), `photos` (`[{id, url}]` in order), `bookable`, `not_bookable_reason` when not bookable (fully_booked / closed / cancelled), and `rating`.
- `hotels`: listed hotels (filters: `destination` and `name`, each a case-insensitive "contains", `check_in` and `check_out` (together: only hotels offered for those dates), `adults` and `children` (some rate fits them), `stars` (minimum), price range on the from price; ordering by from price (default), stars or name) and `hotels/{id}` (with `check_in` and `check_out`: each room type's rates with their inclusions, occupancy, `per_adult_per_night`, `room_price` (the nights' room prices summed), `stay_price` (for the adults priced, `adults` when given) and `nights`, or `available: false`; the app prices other adult counts as room_price + per_adult_per_night × adults × nights). Each hotel returns its fields, `from_price` (per night without dates, for the stay with them), `photos`, room types with their offered rates, and `rating`.
- `explore`: `{flights, tours, hotels}`, each the module's featured cards (§11, in the shapes its own list returns, with `is_featured`), present only for modules that are on.
- `reviews` with exactly one of `tour`, `hotel` or `kind=flight`: visible reviews newest first, 10 per page: `{id, rating, comment, reviewer_name, created_at, reply, replied_at}`, with `summary` `{average, count, by_rating: {1..5}}` over all reviews, hidden ones included. `rating` and `service_rating` are `{average, count}`, null with none.
- `POST support/chats`.
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (§18.4).

Signed in (customers; admins where noted)
- `auth/me`.
- `queries` (+ `close`).
- `bookings` (create with `travellers`, the passenger list; + `cancel`, `accept-changes`, `decline-changes`); `bookings/{id}/travellers/{traveller_id}` (PATCH).
- `boarding-passes/{id}/download` (admin, or customer once completed).
- `tour-bookings` (own; create with lines and their travellers; `{id}`; `cancel`); `tour-bookings/{id}/travellers` (POST with the line) and `tour-bookings/{id}/travellers/{traveller_id}` (PATCH, DELETE).
- `hotel-bookings` (own; create; `{id}`; `cancel`, `accept-changes`, `decline-changes`); `hotel-bookings/{id}/rooms/{room_id}/guests` (POST) and `hotel-bookings/{id}/guests/{traveller_id}` (PATCH, DELETE; never the lead guest); `hotel-vouchers/{id}/download` (admin, or the customer once completed).
- `reviews` (own, with `is_hidden` and the booking; create with `{booking | tour_booking | hotel_booking, rating, comment}`); `reviews/{id}` (PATCH rating, comment; DELETE).
- `support/chats`, `support/chats/{id}` (+ `messages`), `support/unread`, `support/attachments/{id}`.

Response shapes
- Offers (public, admin, nested in responses and bookings) return `trip_type`, `return_date`, baggage and fare-condition fields, `source` and `price_checked_at` (never net amounts, rates or fare type outside the admin API), and `itinerary`: `{outbound: {segments, connections, stop_count}, return: {...} | null}`; segments return nested airline, operating airline and airports.
- Segment input (admin create and edit, `new_offers` in respond and mark-unavailable, confirm availability): one ordered list of `{direction, airline (id), flight_number, operating_airline (id, optional), origin, destination (IATA codes), departure_date, departure_time, arrival_date, arrival_time}`; an edit with segments replaces them all.
- Flight bookings return their own trip fields, itinerary, baggage and fare conditions next to the nested offer, `travellers` and `can_edit_travellers`.
- Tour bookings return their tour, lines with their travellers, status timeline, `can_cancel` and `can_edit_travellers`. Hotel bookings return their hotel, rooms and guests, status timeline, vouchers, `can_cancel` and `can_edit_guests`.
- Flight, tour and hotel booking responses return `can_review` and `review` (their own, or null).

Admin (`/api/admin/`, `IsAdminRole`)
- `dashboard` (§12).
- `offers` (with `is_featured` and a `featured` filter; admin offers also return the GDS source fields, `price_edited` and `missing_since`).
- `queries` (+ `respond` with a message, existing offers and `new_offers`).
- `bookings` (create for a customer, with `travellers`; + `confirm-availability {unit_price?, airline?, segments?}`, `recheck-fare`, `mark-unavailable` (optional suggested and new offers), `mark-paid`, `complete`, `boarding-passes`); `bookings/{id}/travellers/{traveller_id}` (PATCH); `boarding-passes/{id}` (delete). Admin bookings return `source`, `integration` ({id, name}) and `fare_key`; `recheck-fare` returns `{found, fare, alternatives}`, each fare with its original amount and currency, net_usd, rate, rate_date, no_rate, selling_price, `segments` (the confirm-availability input shape) and `itinerary`.
- `integrations` (list, create with `credentials`, PATCH name, mode, credentials, is_active; never returns credentials) and `integrations/{id}/test`.
- `routes` (list, create, PATCH; each with its schedule, window, auto_publish, last run and new fares), `routes/{id}/search` (over the window) → the run, `routes/{id}/runs` (booking re-checks included); `search-usage` (allowance, used, left).
- `fares?route=&run=&status=&picked=` (`{run, dates: [{departure_date, fares}]}`, latest run not skipped or a re-check by default, dismissed only when asked, sorted by USD; each fare with its original amount and currency, USD amount, rate date, selling price, and its itinerary as offers return it), `fares/history?route=&departure_date=` (cheapest USD fare per run), `fares/{id}/publish {price, valid_until, is_public}`, `fares/{id}/dismiss`.
- `tours` (all tours with `booked` and `slots_left`; filters upcoming / past / inactive / cancelled and `featured`; create with options; PATCH with options, the whole list replacing the old one: an omitted booked option is refused (400), and an optional `notice` message; no delete; `is_featured`), `tours/{id}/cancel {message}`, `tours/{id}/notices`, `tours/{id}/photos` (upload, one image per request), `tours/{id}/photos/{photo_id}` (delete; PATCH `{position}` to reorder), `tours/{id}/bookings`; `tour-bookings` (status and tour filters; create for a customer; `{id}`; `cancel {message}`; `travellers` as for customers).
- `hotels` (all, with room types, rates and periods; filters active / inactive and `featured`; create; PATCH with room types, rates and periods, the whole list replacing the old one, an omitted booked room type or rate refused (400); no delete; `is_featured`), `hotels/{id}/photos` and `hotels/{id}/photos/{photo_id}` (as tours); `hotel-bookings` (status and hotel filters; create for a customer; `{id}`; `confirm-availability {new_total?, note?}`, `mark-unavailable {message?}`, `mark-paid`, `vouchers` (upload), `complete {hotel_confirmation}`; guests as for customers); `hotel-vouchers/{id}` (delete).
- `reviews` (filters kind, tour, hotel, rating, hidden / visible and replied / not replied; newest first; each with its booking reference and the customer's full name and email; + `hide`, `show`, `reply {reply}` (blank removes the reply)).
- `settings` (app settings; + `theme`, its id, saved on the agency; `modules`, read-only), `themes` (active, default first, then by name).
- `users` (customers, or `?role=admin` the agency's admins; returns `role`; deactivate instead of delete, never your own account; `password-reset` emails an active user the reset link; `make-admin` promotes an active customer), `airlines?search=`.
- `chats` (+ `unread`, `{id}`, `messages`, `close`).
- `plans`, `billing`, `billing/invoices` (+ `pdf`).
- `support/platform-chats` (+ `unread`, `{id}`, `messages`), `support/platform-attachments/{id}`.

Root host, `/api/platform/`
- `login`, `refresh`, `me` (active public-schema superusers only).
- `dashboard` (with `fare_searches`: this month's searches and allowance of each agency that made any, most first).
- `public-plans` and `support/chats` (open), `support/attachments/{id}`, `chats` (+ `unread`, `{id}`, `messages`, `close`).
- `themes` (with inactive ones, each with `is_active`, `is_default`, `agency_count`; create; PATCH name, primary, accent, is_active; + `make-default`, active themes only).
- `tenants` (+ `domains`, `make-primary`, `subscriptions`, `admins` (list; PATCH `{is_active}` suspends or restores; `password-reset` emails the agency's reset link, 409 while the admin or agency is suspended)). Tenants return and accept `monthly_search_allowance`, `theme` (its id; the default when left out on create) and `modules` (create: `["flights"]` when left out; PATCH applies §4's rules), and return `searches_this_month`.
- `plans`, `subscriptions/{id}` (+ `end`, `issue-invoice`), `invoices` (filters tenant, status, overdue; + `mark-paid`, `mark-unpaid`, `void`, `resend`, `pdf`), `settings`.
- `exchange-rates` (latest per currency with `stale`; POST `{currency, units_per_usd}` sets today's manual rate).

## 18. Frontend

### 18.1 Look and layout

- Colours only as tokens in `src/theme.ts`, read while rendering and in `createStyles` style sheets, never into constants: primary and accent (with the primary's tint and hover) come from the agency's theme, applied before the first screen; Dira Manifest's own primary indigo #1800d2 and amber #ffb400 (prices and main calls to action, dark text) wherever there is no agency (§16.2). No screen may keep Dira Manifest's colours once a theme is applied, including styles built when a file loads. The rest is the same in every theme: slate green #4a6660, neutrals (#252525, #2d3434, #6c7171, #a8b1b5, background #f2f4f7, surface #fff), status (success #51d77a, warning #faba2f, danger #fe455f, info #2275ff) with AA-contrast chip tints. Typography scale 28/22/18/15/13/12, system font.
- Wide (≥ 900 px): top bar in the primary with the agency's name (28 px; 22 px on narrow screens; on the platform, "Dira Manifest Platform"), nav items with icons, account menu (initials). Narrow: slim top bar plus bottom tabs; with more than five tabs, four stay in the bar and the rest go under a "More" tab (a menu carrying their badges). No horizontal scrolling at 390 or 1280 px.
- Forms that start new work (Book, Book tour, Request booking, Request options, New offer, New tour, New hotel, Respond) are full pages; short tasks use a shared Dialog (small/large, focus-managed, full screen on phones).
- Every list has loading, empty and error states; zod mirrors server validation; dates via a web date input; uploads and file opening are web only.
- Airline badge: the airline's logo, or its IATA code (e.g. "KQ") when it has none or the logo fails to load, in the same fixed square frame. Country flags (bundled flag-icons SVGs) only in airport pickers, offer detail header and connection rows, decorative.
- Compact route lines (trip cards, admin tables) show "NBO → LHR" for one-way and "NBO ⇄ LHR" for return trips, with both dates.
- **Sign-in brand panel** (sign-in, register, forgot and reset password, wide screens): the agency's name, a tagline naming the modules on ("Flight deals, tours and hotel stays from our travel agents, booked in a few steps.", with only the modules on) and three ticks taken in turn from each module on. Flights: "Hand-picked flight deals", "Ask us for options when nothing fits", "Boarding passes in the app and your inbox". Tours: "Book your places on a tour instantly", "Options for couples, families and groups", "Tour updates in your inbox". Hotels: "Hotels, lodges and camps we work with", "Prices for your dates and party", "Vouchers in the app and your inbox".
- Auth gate: login-required actions store the intended action in memory, send the guest to Login/Register, then resume it.
- `no_tenant` / `tenant_suspended` responses show a full-page message under a top bar with the agency's name (from the response, or the agency stored by the mobile app); "Dira Manifest" when there is no agency.
- A shared **theme preview**: a strip of the top bar in the primary with the agency's name (or "Your agency"), a line of text and a link on the tint, and an accent "Book" button beside a price.

List and detail (`DetailLayout`; Explore has its own split view, §18.2)
- Narrow screens: the detail is full screen with the back link.
- Wide screens, nothing open: the full list (title, intro, filters, tabs, table or cards, pagination).
- Wide screens, an item open: the list shrinks to a **rail** (left, 280 px, surface background, right border): a header with the list's title (e.g. "Chats") and a collapse button («); below it the rows of the page currently loaded, with the current filter and status tab kept but not shown; at the bottom a compact pager (‹ page n of m ›) when there is more than one page.
- **Rail rows**: two lines, no chips, cards, icons or columns. Line 1 is the identifier, line 2 the time (muted, 13 px), both one line with ellipsis. The open item is highlighted (primary left edge and light tint, `aria-current`); unread chats have a bold line 1. Each row is a link; its accessible label also carries the status.

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

- **Detail**: fills the rest of the width, without sliding in or overlapping; it keeps its header with the title and ✕, its own scrolling and its URL (no history entries). Escape and ✕ close it and bring the full list back with its filters, page and scroll position.
- **Escape** closes the detail on every list screen, whether the page was opened from the list or straight from its URL, and wherever the focus is (a text field in the detail included), except while a dialog or menu is open, where Escape closes only that.
- **Not found and errors stay in the detail.** An id that does not exist (or is not visible to this user) shows a "<Item> not found" empty state with "Back to <list>" inside the detail pane; the rail, top bar and navigation stay. Other errors show the error with Try again in the same place. Server wording such as "No Conversation matches the given query." is never shown.
- **Collapse**: « collapses the rail to a 44 px strip holding only an expand button (»); the detail then takes the full width. The choice is remembered for the session across all list screens (in memory) and both buttons are keyboard reachable with labels "Hide list" / "Show list".
- Switching between items keeps the rail's scroll position.

### 18.2 Agency app

- Web: the agency app loads `GET /api/agency` before its first screen and applies its theme and modules; until then a plain loading state in Dira Manifest's colours.
- Every agency site shows a "Get the app" link (account menu and footer of the public pages) to `/app` (§18.4).
- Navigation follows the modules on: **Explore** has a module switch (Flights, Tours, Hotels) only with more than one module; **Customers** see Requests only with flights, and Bookings with a switch like Explore's when more than one module is on; **Admins** see Offers, Routes, Requests and Bookings only with flights, Tours with tours, Hotels with hotels, Reviews while any module is on, and the Integrations card in Settings only with flights. Nav items beyond the bar's room go under "More" on phones.

Explore
- **With more than one module**, the switch's first tab is **All**, the default; the URL keeps the tab. All shows a hero with the agency's name and one large tile per module on ("Flights: find a flight", "Tours: join a tour", "Hotels: book a stay"), each opening its tab, side by side on wide screens and stacked on phones; then a section per module on, in module order, titled "Featured flights", "Featured tours", "Featured hotels", each with up to six cards from `explore` and "See all" opening the tab. Three columns on wide screens; on phones a row of cards scrolled sideways within the section (the page itself never scrolls sideways). A module with nothing to show is left out; with nothing in any, "Nothing on offer right now. Check back soon."
- **With one module**, there is no switch; Explore is that module's page, which opens with a "Featured" row above its results while no search or filter is applied, hidden once one is.
- **Module switch** (Explore, and customer Bookings which uses the same one): a row of pill tabs, each with its module icon and label (All: grid, Flights: airplane, Tours: map, Hotels: bed), centred on a surface strip with a light border and shadow; the current tab is filled in the primary with white text, the others muted, with the primary tint on hover and a focus ring; on phones the tabs share the width equally, with the icon above a smaller label.
- **Tab layout** (Flights, Tours and Hotels, wide screens): the filters card sits in a 260 px column on the left and the results take the full 1,100 px content width beside it, so the page content is 260 + gap + 1,100 px wide, centred, with smaller side margins; the search bar and the featured row span that same width. One shared results toolbar on all three tabs: Sort by on the left and the item count ("12 deals", "8 tours", "5 hotels") at the far right. Narrow screens are unchanged.
- **Heading card** (every tab: All, Flights, Tours and Hotels, and a single module's page): the page opens with one card in the primary, rounded like the other cards, as wide as the tab's content (the same width as the filters and results below it, never edge to edge), holding a white headline (18 px; 15 px on phones) and the tab's search panel. The panel is not white: like the All tiles, it is a rounded block in the theme's hover shade (§16.2, so it follows every theme with no new colour), with white field labels, white inputs, the swap button and trip type on it, and errors in white beside an alert icon with the field's border in the danger colour. Headlines: All "<agency name>" with its module tiles, Flights "Find your next flight deal", Tours "Find your next tour", Hotels "Find your next stay". On wide screens all four cards have the same fixed height, that of a headline and two rows of inputs, with the content centred vertically, so switching tabs never moves the content below; Flights in two rows: trip type, From, swap and To on the first; Departing from, Departing until, then for Return the Returning from and Returning until dates, Class and Search on the second. On phones the card grows with its stacked fields.
- **Cards** share one frame, so the three kinds line up in a grid: a top image area of the same height, then title, a detail line, and the price at the bottom in the price colour, with a "Featured" chip on featured items. Tour and hotel cards show "★ 4.6 (12)" under the title when rated. Each card opens the item's detail.
  - Flight card: the image area shows a bundled plane photo (the same for every agency, cropped to fill) under a dark scrim, with the route large in white ("NBO → DXB", or "⇄" for return), the city names under it and the airline badge at the top right; then dates, trip type and class, and "$X per person".
  - Tour card: cover photo (a neutral placeholder with an icon when there is none), title, destination, dates and number of days, "From $X per person", and an "N slots left" chip from 5 down, or a "Fully booked" chip in the warning colour in its place (the price line stays).
  - Hotel card: cover (or a placeholder), name, stars, destination and "From $X per night", or with dates "$Y for N nights".
- **Split view** (all three modules, like a job board): opening an offer, tour or hotel, from its tab or from All, changes the URL to the item's own link (`/offers/<id>`, `/tours/<id>`, `/hotels/<id>`, so it can be shared) and shows its module's results beside the detail. Wide screens: the results in a left column (380 px, scrolling on its own: flights as compact result rows, tours and hotels as cards, with the current filters, sort and page kept but the search bar, filters and featured row not shown, and a compact pager at the bottom when there is more than one page) and the detail on the right in a card with the item's title and an ✕ at the top right, scrolling on its own. The open item is highlighted in the column; picking another replaces the detail without moving the column. There is no collapse. ✕ and Escape (as in §18.1) close the detail and bring back the full page (search bar, filters, results, featured row) with its filters, page and scroll position; a link opened directly shows the module's unfiltered first page beside it. Narrow screens: the detail is full screen with ✕ at the top right, which closes it the same way. Not found and errors stay in the detail card, as in §18.1. Opening an item from All switches Explore to that module's tab.

Flights
- Flights tab: search panel in the heading card (Any / Return / One way, swap, departure date range, a return date range for Return, class); filter sidebar or panel; sort tabs; result rows with one line per direction (departure and arrival local times with "+1", airport codes, "Direct" or "N stops", airline badge) and a short baggage summary ("23 kg checked" or "Cabin bag only"); empty state with "Request options". "Flight booking service ★ 4.8 (40 reviews)" when there are flight reviews, opening a dialog with the Reviews section headed "How customers rate our flight booking service".
- Offer detail: route header, an itinerary card per direction (each segment with the airline badge, flight number, "Operated by" when set, local departure and arrival times with airports, and connection rows between segments: wait time, Layover/Stopover tag, flag of the connection airport), a "Baggage and fare conditions" card (refund and change policy in plain words), "Price checked <time ago>" on GDS offers, the flight service rating as on the Flights tab, and a price card.
- Book (full page): summary with both directions, passenger stepper (1–9) and live total, and one passenger form per passenger as the stepper changes (the first prefilled with the customer's name, email and phone), with the required fields marked.
- Request options form: criteria including trip type and an optional return date.

Tours
- Tours list: a search bar in two rows, "Departs from" and "Destination" on the first, "Tour name", "Organiser" and Search on the second (stacked on phones); start date range and price range filters (sidebar on wide screens, panel on phones), and sort by date or price. Cards in two to three columns on wide screens, one on phones. Empty state: "No tours right now".
- Tour detail (in Explore's split view): a photo gallery (cover large, the rest as thumbnails; tapping opens the photo large), title, destination, "Departs from <city>" and "Organised by <organiser>" when set, dates and days, the summary, the description, Included and Not included lists, meeting point, the cancellation policy with "Free to cancel until <date>", the Reviews section, and a price card listing the options (name, description, price and what it covers, e.g. "$900 for 2 people", "N left" when limited, "Sold out" on a limited option with no units left) with slots left, booking deadline and Book. When not bookable, the card says why: bookings closed or cancelled, or for a fully booked tour "Fully booked" and "This tour has no places left." in place of Book.
- Book tour (full page, behind the auth gate): a quantity stepper per option (limited by its units left and the slots left), per option an "Add traveller" button that adds a traveller form (full name required, then the optional fields, with baggage) up to the option's people (it disappears at the limit, showing "4 of 6 travellers added"), and a note that travellers can be added later; group name; phone when the account has none; notes; the cancellation policy, live lines and total, and Confirm booking. On success it opens the booking with a "You're booked" banner. A 409 shows its message and refreshes the tour.

Hotels
- Hotels list: a search bar in two rows, "City" (the destination), "Hotel" (the name), check-in and check-out on the first, adults, children and Search on the second (stacked on phones); stars and price filters (sidebar on wide screens, panel on phones) and sort by price, stars or name. Cards in two to three columns on wide screens, one on phones. Empty state: "No hotels match" or "No hotels right now".
- Hotel detail (in Explore's split view): gallery as tours, name, stars, destination and address, summary, description, amenities, check-in and check-out times, cancellation policy, the Reviews section, and the room table, as on hotel booking sites. Columns: Room type (name and description, spanning its rates' rows), Sleeps (person icons for the rate's adults and children), Price (for the chosen dates' nights and the adults priced, with "+ $15 per adult per night" under it when the rate has a charge; "Choose dates to see prices" without; "Not available for these dates" when not offered), What's included (the rate's inclusions), and Rooms (a 0–9 picker). With guests chosen, rates that cannot hold them are dimmed. A summary beside the table (below it on phones) shows the rooms picked, nights and total, with Request booking. On phones each room type is a card listing its rates as rows.
- Request booking (full page, behind the auth gate): dates, per room picked its room type and rate, adults and children (within the rate's limits; the room's price follows its adults) and the lead guest (the first prefilled with the customer's name, email and phone), "Add guest" with the shared traveller form up to the room's guests; phone when the account has none; special requests; notes; the cancellation policy; total; and Request booking, with "The agency will confirm availability with the hotel". On success it opens the booking.

Reviews section (tour and hotel detail, under the description; the flight service dialog)
- The average large with stars, the count, and a bar per star level; then the reviews (stars, name, date, comment, and the agency's reply indented under "Response from <agency>"), with "Show more" loading the next 10; with none: "No reviews yet". The flight rating shows nothing with no reviews.

Customers
- Requests: criteria, responses with offers.
- Bookings (Flights / Tours / Hotels switch when more than one module is on):
  - Flight: trip cards; itinerary, baggage and conditions cards; a Passengers card (each passenger's name, gender, date of birth, nationality and document with the number masked to the last 4, baggage and requests; Edit on each while `can_edit_travellers`, the same form in a dialog); progress tracker or terminal banner; payment box with countdown; changes box to accept or decline; suggested options; boarding passes.
  - Tour: cards with the cover, title, dates, group name, people and total. Detail: tour summary with a link to the tour, lines with their travellers ("4 of 6 added"; Add, Edit and Remove while confirmed, using the traveller form in a dialog), group name, notes, total, status with its timeline, the agency's payment instructions while confirmed, the cancellation policy and deadline, the agency's message when it cancelled, and Cancel booking (confirm dialog) while `can_cancel`.
  - Hotel: cards with the cover, hotel, dates, rooms and total. Detail: the hotel and stay, rooms with their guests (edit while `can_edit_guests`), progress tracker or end banner, payment box with countdown, changes box (accept or decline), the agency's message when unavailable, the voucher and confirmation number once completed (preview first), and Cancel while `can_cancel`.
  - "Rate your trip" card on finished flight, tour and hotel bookings while `can_review`: five tappable stars (required), a comment box and Submit. Once written, the card shows the review with Edit and Delete (confirm dialog), the agency's reply and "Hidden by the agency" when hidden. For flights, the card says: "Rate how we handled your booking: our service, not the airline or the flight itself."
- Account (+ Support, Switch agency on native).

Admins
- **Dashboard** (§12).
- **Offers**: table with a star column (filled when featured, toggled in place) and a Featured filter; form with One way / Return, "Outbound flights" and "Return flights" sections, each a segment editor (airline picker, flight number, optional "Operated by", from and to airport pickers, departure and arrival date and time) with "Add connecting flight", remove and reorder; the next segment's From and the return direction's endpoints are prefilled; connections show live with wait time and a Layover/Stopover tag; a "Baggage and fare conditions" section; a "Feature on Explore" switch. "Not found in the last search" chip and a note in the drawer for missing GDS offers. The same segment editor serves custom offers on Respond and Mark unavailable, and the Confirm availability dialog.
- **Routes** (after Offers; only once the agency has an integration): a warning once 80% of the month's searches are used; table with route, trip and stay, cabin and schedule, last run and new fares; drawer with Search now (the window's dates, searches needed against what is left), recent runs (scheduled or by whom, skipped ones with the reason, booking re-checks marked) with their errors, and the route's settings including departures (days ahead or fixed dates), scheduled search (manual / daily / weekly and day) and publishing (review or automatic); New route dialog.
- **Fares** for a route: Picked / All results switch and a run selector (latest by default); grouped by departure date, sorted by USD, with a small price history per date of the cheapest fare across recent runs; flight rows (itinerary lines, airline badge, baggage summary) with the original amount, its USD equivalent and rate date (on hover), the selling price, a "No rate" note where conversion failed, fare type, seats left and integration; Publish dialog (the original amount, its USD equivalent and rate date, prefilled with the selling price (editable), valid_until (default today + 7 days, never after departure) and public on) and Dismiss; published fares link to their offer.
- **Requests**: Respond (full page, with custom offers).
- **Bookings**: status tabs, action bar, confirm-with-changes (price and flights) and mark-unavailable dialogs, pass upload and send, New booking dialog (with a passenger form per passenger). On requested GDS bookings the confirm dialog's "Re-check price" fills the price, ticketing airline (shown read-only) and flights from the answer, shows the original amount, USD equivalent, rate date and selling price, and when not found lists the alternatives, each with "Use these flights". The Passengers card shows documents in full, Edit while `can_edit_travellers`, and a Copy button that copies each passenger as "SURNAME/GIVEN NAMES, gender, date of birth, document, expiry, nationality" lines, for pasting into the GDS.
- **Tours**: a table with title, dates, booked / slots, from price, status (Upcoming, Fully booked, Closed, Past, Inactive, Cancelled) and a star column, with the upcoming / past / inactive / cancelled and Featured filters. A tour opens beside the slim rail with its fields, options (with units sold), photos, its rating (linking to Reviews filtered to it), its bookings (group name or booker, booker's phone, options, people, travellers added of people, status, created) and its notices (kind, message, sent by, when, recipients). Actions: Edit, Activate or Deactivate, Book for a customer, and Cancel tour.
  - Each booking opens with its booker (name, email, phone), lines with their travellers in full (Add, Edit, Remove while confirmed), group name, notes, timeline and Cancel booking: a dialog with a message box ("Message to the customer", optional) that is emailed when filled.
  - **New tour** and **Edit tour** are full pages: the fields with the two deadlines and the cancellation policy, a rich-text editor for the description, line editors for Included and Not included, a price option editor (add, edit, reorder, deactivate; delete only when never booked), photos (web only: add, delete, move up or down; the first is the cover), and the "Feature on Explore" switch. The form refuses values that break the rules with the server's message.
  - **Saving a booked tour** opens a dialog first: "N bookings (M people) are booked on this tour. Tell them about the change?" with a message box, and Save and notify (needs a message) or Save without notifying.
  - **Cancel tour** opens a dialog: what happens (N bookings cancelled, each customer emailed), the message box (required), and Cancel tour.
  - **Book for a customer**: a dialog to pick an active customer (searchable, as for flight bookings), then the Book tour page filled in for them.
- **Hotels**, with two tabs:
  - **Bookings** (default): status tabs and a table (hotel, guest, dates, rooms, total, status); a booking opens beside the slim rail with booker, stay, rooms and guests (edit while allowed), timeline and the action bar: Confirm availability (a dialog with an optional new total and note), Mark unavailable (a dialog with an optional message), Mark paid, voucher upload, and Send voucher (a dialog asking the confirmation number). New booking for a customer (pick an active customer, then the Request booking page filled in for them).
  - **Hotels**: a table with name, destination, stars, room types, from price, Active and a star column, with a Featured filter; a hotel opens beside the rail with its fields, rooms, rates and periods, photos, its rating (linking to Reviews filtered to it) and its bookings; Edit, Activate or Deactivate. **New hotel** and **Edit hotel** are full pages: the fields, rich-text description, amenities lines, check-in and check-out times, cancellation policy, a room type editor (add, edit, reorder, deactivate; delete only when never booked), per room type a rate editor (name, inclusions, adults and children, per-adult charge), per rate a period table (start, end, price per night) that refuses overlaps, photos (web only, as tours), and the "Feature on Explore" switch.
- **Reviews**: a table of stars, item (tour or hotel name, or "Flight booking" with the route line), customer, comment (first line), date, a Replied chip and a Hidden chip, with filters for kind (column and filter only with more than one module on), visibility, replies and rating, and by tour or hotel. A review opens beside the slim rail with the full comment, the customer and a link to the booking, Hide or Show, and a reply box (Save reply, Remove reply).
- **Users**: System admins button for the admins list; drawer with Send reset link, Make admin for customers, Deactivate except on your own account.
- **Chats**.
- **Settings**: app settings; Integrations (flights only: list with name, provider, mode, status and last test; add with the provider's credentials and help text: Duffel's access token, Travelport's username, password and target branch, Sabre's user id, password, pseudo city code and domain, or Amadeus's API key and secret; Test, Enable/Disable, replace credentials); Billing with Compare plans; Support; and a **Theme** card: a dropdown of the active themes by name, the preview of the selected one, and Save, which applies the theme to the admin's own app at once (the screens re-render; on web the page reloads); other users get it the next time they load the app.

### 18.3 Platform app (root host, web only, Dira Manifest's colours)

Website (home)
- The root host's public home page is Dira Manifest's sales website: the three products (Flights, Tours, Hotels), what each one does for an agency and for its customers, and everything around them, leading visitors to pricing and to a plan enquiry. Its claims cover only what is built: it never promises online payment, GDS booking or ticketing, or anything else §1 lists as out of scope. No stock photos or image files: every visual is drawn in code from the app's own components and tokens.
- Look: Dira Manifest's own brand throughout (indigo primary, amber accent for the main calls to action), on the shared tokens. Generous spacing, large type for headings, and a content width of about 1,200 px centred. Sections alternate between the background and white surface bands, with an indigo band for the hero and the closing call to action.
- Product visuals are **mock screens**: a framed browser window (three dots and an address bar with "youragency.<base domain>") holding a miniature of the real screen, built from the app's real cards and chips with sample content, for example "NBO → DXB, $420 per person", "Maasai Mara, 3 days" and "Diani Beach Resort". They are decorative and hidden from screen readers.
- Wide (≥ 900 px): text and visual side by side, alternating sides from one product to the next. Narrow: stacked, the visual under the text.
- **Website bar** (home and `/pricing`): brand on the left. On wide screens the links are Products, Flights, Tours, Hotels and Pricing; each product link scrolls to its section, and on `/pricing` it goes home first. On the right, "Get started" (accent). On phones, the brand, "Get started" and a menu button that opens the same links in a sheet. The bar stays at the top while scrolling. Nothing links to sign-in; a signed-in owner sees "Open admin" in place of "Get started".
- Page, top to bottom:
  1. **Hero** (indigo band): the headline "Your travel agency, online", and the lead "Sell flights, tours and hotel stays from your own booking site and app. Take one product, two, or all three."; "Get started" (accent) and "See pricing" (secondary); three short ticks: "Your own address and colours", "Web and mobile app", "Nothing to install"; on the right (under it on phones), a mock of an agency's Explore All: hero tiles and a row of featured cards, one flight, one tour and one hotel.
  2. **Three products** (anchor `products`): the title "One platform, three products" and the line "Each is a module: switch on what you sell, add the rest when you're ready." Three large cards, each with its module icon (plane, map pin, bed), name, one line, three ticks and "Learn more", which scrolls to the product's section:
     - Flights: "Publish fares and take booking requests"
     - Tours: "Sell scheduled tours with instant booking"
     - Hotels: "Sell stays with seasonal room rates"
  3. **Flights** (anchor `flights`), the title "Flights: fares your customers can book":
     - Publish one-way and return offers with full itineraries, baggage and fare conditions.
     - Search fares across Travelport, Sabre and Amadeus by route and date, review them and publish with your markup. Saved routes refresh on a schedule.
     - Customers ask for options and you answer with offers.
     - Bookings with passenger details: you confirm availability, and the customer pays before a deadline with automatic reminders.
     - Boarding passes delivered by email and in the app.
     - Visual: an offer detail mock with the route, segments and "Book", beside a small progress tracker (Requested → Confirmed → Paid → Passes sent).
  4. **Tours** (anchor `tours`), the title "Tours: fill every seat":
     - Fixed dates and slots, with price options (Regular, VIP, Couple, Group of 6).
     - Customers book and get confirmed instantly, with travellers added now or later.
     - Booking and cancellation deadlines with your own policy.
     - Tell every booked customer about a change or cancellation in your own words.
     - Fully booked tours stay on show.
     - Visual: a tour card grid with an "N slots left" chip and a "Fully booked" chip, beside the price options card.
  5. **Hotels** (anchor `hotels`), the title "Hotels: your partner stays, priced by season":
     - Room types with seasonal rates, an optional charge per adult, and occupancy rules.
     - Customers choose dates and rooms and send a request; you confirm with the hotel, possibly at a new price, which they accept.
     - Mark paid, then send the hotel's voucher with its confirmation number.
     - Visual: the hotel room table mock (Room type, Sleeps, Price, Select) with "$Y for N nights".
  6. **Everything around the booking**, the title "Everything you need to run the agency": a grid of feature tiles (icon, title, one line), three columns wide, two at mid widths and one on phones: Your own site (address, extra domains, your colours); Mobile app (customers find you by link or code); Featured on Explore; Reviews and ratings; Live support chat; Customer accounts and admin bookings for customers; Emails at every step; A dashboard across your products; Your data kept apart from every other agency.
  7. **Dashboard** band: "See the whole business at a glance", with a dashboard mock: needs-action tiles, the stacked 12-month chart with its legend, and a Coming up list mixing the three products.
  8. **How it works**: three numbered steps, in a row on wide screens and stacked on phones: 1. "Choose a plan and your products" 2. "Add your colours, offers, tours and hotels" 3. "Share your link and start taking bookings".
  9. **Pricing preview**: the title "Simple plans, billed monthly or yearly", PlanShowcase's featured cards (as on `/pricing`, Get started included), and "See all plans" linking to `/pricing`.
  10. **Questions**: an accordion, one open at a time, with these answers:
      - "Do I need a GDS contract?" Fare search is optional; you can publish fares by hand.
      - "Can I sell only tours or only hotels?" Yes, any of the three.
      - "How do customers pay?" As your agency instructs, outside the system; you mark bookings paid.
      - "Can I use my own domain?" Extra domains can be added.
      - "Is there a mobile app?" Yes, one shared app; customers reach your agency by link or code.
      - "How do I get help?" The support chat.
  11. **Closing call to action** (indigo band): "Ready to take bookings online?", with "Get started" and "See pricing".
  12. **Footer**: brand and one line, columns for Products (Flights, Tours, Hotels), Company (Pricing, Contact, which opens the support chat) and the year's "© Dira Manifest". There is no sign-in link.
- Behaviour: "Get started" anywhere opens the platform desk's prefilled chat (§15). Anchors work on web: `/#flights` and the other anchors scroll to the section on load, and the bar links update the hash without adding history entries. Page title "Dira Manifest: booking sites for travel agencies", with a meta description. Headings are real headings (h1 once, h2 per section) for accessibility and search. Contrast meets AA on every band.

Other public pages
- `/pricing` (with the website bar).
- PlanShowcase (public pricing, the website's pricing preview and agency Plans): Monthly/Annual switch with saving, featured Recommended/Basic/Advanced cards, Show all plans, support plans section, "Your plan" for running plans.
- `/login`, `/admin` and `admin.<root host>` lead to sign-in; nothing on the public pages links to it.

Owner
- **Dashboard**: agency counts, revenue, monthly recurring, outstanding/overdue, 12-month bar chart in plain views, agencies per plan, needs attention, fare searches this month per agency against its allowance.
- **Agencies**: table with a Modules column; New agency dialog with a Theme dropdown (active themes, the default preselected) with the preview, and Modules checkboxes (Flights checked; at least one). Each agency opens beside the slim rail (`/agencies/<id>`) with agency (name, address, its theme with preview, changeable), a Modules card with three switches, each saved at once, showing the server's message when refused, admins (suspend/restore, send a password reset link), domains, plan & billing, and fare searches (only with flights: used this month, editable allowance).
- **Plans**: kind tabs, tag column, rich-text dialog, link to pricing.
- **Invoices**: filters, drawer actions behind confirm dialogs.
- **Chats**.
- **Settings**: billing and support; **Themes**: a table of themes (the two colours as swatches, name, agencies using it, a Default chip, Active or Inactive), New theme, and a create/edit dialog with the name, each colour as a hex field with the browser's colour picker beside it (web only), the live preview, and the four contrast checks with their ratios, each passing or failing as the colours change (Save disabled while one fails; the server checks again); rows offer Make default (active themes) and Deactivate or Activate (not on the default). **Exchange rates**: the currencies seen, each with its latest rate, date, source and a stale warning, a manual rate entry for today, and the feed's credit.

### 18.4 Mobile app

One "Dira Manifest" app in the App Store and Google Play serves every agency's customers and admins. It learns its agency from the link the customer is sent (or from a code typed in), stores it, and sends every API request to that agency. On the web, the address decides the agency, and the web build never shows Find your agency. The platform app is web only.

Conventions
- Links in emails are ordinary https links on the agency's app address. They open the app when it is installed (iOS universal links, Android app links) and the web app otherwise. This needs the app to declare its domains at build time and each domain to serve a small verification file.
- No deferred deep linking (it needs a third-party service): a customer who installs the app after tapping a link taps it again, or types the agency code.
- One agency at a time on a device; switching agency signs out.

Backend
- Verification files on every agency host, served by Django: `/.well-known/apple-app-site-association` (from `IOS_APP_ID`, Team ID plus bundle id) and `/.well-known/assetlinks.json` (from `ANDROID_PACKAGE` and `ANDROID_CERT_FINGERPRINTS`); with the settings unset the files answer 404. In production the reverse proxy sends `/.well-known/` to the API.

App (native)
- `{host}` in `EXPO_PUBLIC_API_URL` is replaced by the stored agency's address. The agency (code and name) and its theme are stored in secure storage with the sign-in tokens. On launch the app applies the stored theme at once and refreshes it from `GET /api/agency`; switching agency applies the new agency's theme.
- **First launch, no agency:** a "Find your agency" screen: the agency code, checked with `GET /api/agency` on that address, then a confirmation card with the agency's name and Continue. Clear messages for an unknown code and for a suspended agency. Below: "Got an email from your agency? Tap its link."
- **Opening a link** to `https://<code>.<base>/...` (or the app scheme):
  - no agency stored: check and store it, then open the link's screen;
  - same agency: open the link's screen; for a password reset or set-password link while signed in, first ask "Sign out and continue?" (Sign out / Cancel);
  - another agency: ask "This link is for <B>. You're using <A>. Switch to <B>? You'll be signed out." (Switch / Cancel). Switch signs out, clears the stored tokens, stores B and opens the link's screen; Cancel stays where the user was.
  - a link to the root host or an unknown agency is ignored with a short message.
- "Switch agency" in the account menu (customers and admins): signs out and returns to Find your agency.
- `app.json` / `app.config.ts`: the app scheme `dira`, iOS `associatedDomains` `applinks:*.<base>`, Android intent filters with `autoVerify` for `*.<base>`, bundle id and package from config (checked against the Expo SDK 58 docs).

Web `/app` page (agency sites)
- The agency's name and code, App Store and Google Play buttons, "Already installed? Open in the app" (the `dira://open?agency=<code>` scheme link, for browsers that do not hand https links to the app), and "After installing, tap the link in your email again."

## 19. Tests

General
- Backend (pytest, needs PostgreSQL): two test agencies per session; every rule in this document has tests, including every transition and actor, email per event (and the cases with none) and state re-checks, beat tasks with frozen time, visibility and isolation across agencies, admin and platform permissions, `module_off` per endpoint group (public, customer and admin) for each module, uploads (type, size, content, count, deletion), sanitizing, and UUID primary keys on every model. External APIs only through httpx's mock transport, with recorded provider responses.
- Frontend: `npx tsc --noEmit`, `npm run lint`, `npm run format:check` and `npx expo export --platform web`. UI changes end with a browser check at 390 px and 1280 px (and 900 px for the website).
- Device checks (iOS and Android builds) are done by the user.

Backend coverage by area
- **Flights**: segment validation (chaining, endpoints per direction, connection times, arrival day window, segment limits, one-way without return segments, return needing both, active airlines); derived connections and kinds; `max_stopovers` with the busier direction; `trip_type` and return date filters; API shapes for one-way and return; query trip type and return date, carried over by mark unavailable; bookings copying segments, baggage and conditions and unchanged by later offer edits; changes on confirm availability (price, airline, segments) with accept/decline; emails showing both directions, baggage, conditions and passengers' names only; `fetch_airline_logos` through a mocked transport (saved, 404, not a PNG, over 200 KB, an existing logo left alone, inactive airlines skipped, `--codes`, a failure not stopping the run, the counts printed).
- **Passengers**: create refused without passengers, with the wrong number, or with a missing required field; passport expiry against the last flight's date; date of birth limits; edits by the customer while requested and by admins until completed, refused otherwise; old bookings without passengers through every transition; visibility (only the customer and admins); admin-made bookings.
- **Fare search**: each provider's requests (token, headers, body, test and live hosts, max connections only when set) and mapping from recorded responses (one-way with a connection and codeshare, return, day changes, baggage by pieces and by weight, conditions and penalties, seats and expiry, a non-USD currency), errors (token refused, HTTP error, SOAP fault, error messages without itineraries), and every skip reason; each provider in a run beside another, in a re-check and in the admin API (credentials required, encrypted at rest and never returned); test connection success and failure. Conversion: rounding, latest rate on or before a date, USD identity, no rate (fare stored, not pickable or publishable), stale rate, manual rate surviving the feed, the feed task from a mocked response, stored conversions unchanged when rates change. Every valid result stored; filtering, picking and de-duplication in USD across currencies and integrations, pick rule, markup rounding, earlier new fares replaced; 30-day clean-up keeping published fares. Allowance arithmetic (weekdays, integrations, month boundary) and refusal; a run continuing past a provider error. Due-route selection with frozen time, rolling and fixed windows, skipped runs over the allowance. Publish creating an offer and updating one with the same fare_key; dismiss; refresh updating, deactivating and flagging, edited prices left alone; auto-publish. Booking re-check: found, changed, not found, allowance, manual bookings and other statuses refused. Public API hiding net price and fare type.
- **Tours**: validation (dates and both deadlines, slots and units not below booked, lists, sanitized description, at least one active option, booked options not deletable, edits after bookings keeping booked prices, a cancelled tour refusing edits); photos (type, size, content check, count, order, file deleted with the photo); listed and bookable rules at their edges (the booking_deadline day in Nairobi time, the last slot taken, the last unit of a limited option, every limited option sold out with slots left, a cancelled booking freeing a slot and making the tour bookable again, inactive, cancelled, no active option); fully booked tours in `tours`, `tours/{id}` and `explore`, closed, cancelled and inactive ones absent; admin bookings past the deadline but before the start; booking validation (lines, count limits, the booker's phone, the 409s, a fully booked tour); two bookings racing for the last slot and for the last limited unit (only one succeeds); from price; cancellation (the customer window at the cancellation_deadline edge, admin cancel with and without a message, slots and units freed); notices (a save with a message emailing each confirmed booking's customer once and recording the notice, a save without one emailing nobody, photo changes sending nothing; cancel tour cancelling every confirmed booking, recording the notice, emailing each and requiring a message); the completion task; a customer's booked tour staying visible to them; the `departure_city`, `destination`, `title` and `organiser` filters, alone and together; turning tours off refused with confirmed bookings on a tour not ended.
- **Hotels**: validation (fields, lists, sanitized description, occupancy limits within the room type's, inclusions, unique names, overlapping periods refused, booked room types and rates only deactivated); pricing (nights across two periods, the per-adult charge for 1 and 2 adults on one rate and at 0, the adults priced with and without `adults`, a night not covered, from price with and without dates, inactive hotel, room type or rate); booking (by customer and admin, occupancy, 1–9 rooms, 1–30 nights, check-in in the past, the phone, the 409 when a rate stopped covering the dates, prices copied and unchanged by later edits); every transition, changes accepted and declined, deadline and stale-request expiry, reminders, voucher upload rules and completion needing a confirmation number and a voucher; filters (`destination` and `name` alone and together) and ordering; turning hotels off refused with open hotel bookings.
- **Travellers**: optional on tours, a lead guest required per hotel room; at most a line's people or a room's guests; full name required, document number and expiry together, field limits; edit windows per kind; never visible to other customers; the database check of exactly one of three owners.
- **Reviews**: exactly one booking and one review per booking; who can review and when for each kind at its edge (the last segment date, check_out today, tour completion), refused for cancelled, unavailable and unfinished bookings and for other customers; edit and delete by the author only, delete removing the reply; hide and show (hidden reviews out of public lists but in averages, counts and `by_rating`, and visible to the author); reply rules; averages, `by_rating`, `rating` and `service_rating`; reviewer name formatting; `request_reviews` (once per booking, only when reviewable); the new-review admin email.
- **Featured and dashboard**: is_featured and the `featured` filter on the three admin endpoints; `explore` per module on (featured first, filled to six, only visible items, nothing from modules off or another agency); each sale rule (flights by their Paid event, hotel paid dating and accepted changes, tour bookings counting when booked and not once cancelled, Nairobi month and year edges); `by_module` with modules on only; `payments_due`, `this_week` and `top_sellers` mixing kinds, with ordering, limits and windows at their edges and routes grouped by trip type; `needs_action` and `on_sale` per module (travellers missing, prices ending, offers bookable and expiring, `fully_booked` counting a tour whose limited options are sold out while slots are left, searches null without an integration); customers excluding admins and inactive users; the overdue invoice; a module turned off dropping out of every figure.
- **Modules**: the database check; defaults for existing agencies (flights only) and new ones; scheduled tasks and queued emails skipped when off; turning off refused with open bookings and with no module left; data back when turned on; `agency` and platform `tenants` fields.
- **Platform**: billing periods, suspension and reactivation; themes (the eight starting themes pass every rule, the default is Indigo & Amber and agencies that existed before themes got it; every contrast rule refusing a failing colour with its ratio on create and change; colours stored lowercase, tint and hover derived; exactly one default, make-default moving it, the default not deactivatable, an inactive theme not made default; an inactive theme refused for an agency except the one it already has and missing from the admin list); `create_agency` and the command with and without a theme; admin settings (an admin changes only their own agency's theme); agency emails in the agency's colours, platform emails in Dira Manifest's; the bar colour (blank falling back to the primary's three values, white or dark text picked at the 4.5:1 edge, the border only on a bar with dark text, the hover going lighter or darker with it, both bar rules refusing with their ratio, `colors` in the API, the email header in the bar); text colours (blank keeping the automatic ones, a chosen one returned and moving the hover shade's direction, a dark text colour on the primary refused, a light text colour on a dark accent accepted, the accent against the bar or the primary at the 3:1 edge with its message, each rule refusing a failing chosen colour with its ratio).
- **Mobile**: the web build never shows Find your agency; `GET /api/agency` (active, suspended, root host); the verification files with and without settings; email links using the app address for an agency with a custom primary domain; the welcome email on registration (none for admin-created users, who get the set-password email with the app lines).

Browser checks (1280 and 390 px)
- Flights: create a one-way and a return offer with a connection and a codeshare, find each on Explore with the trip type filter, book the return with 3 passengers (validation messages, a passport expiring too soon), confirm it with a changed segment, accept, and read the itinerary in the booking and the email; the admin's New booking with passengers; editing a passenger as customer and admin; the masked document for customers; Copy for GDS.
- Fare search: add a Duffel test integration, create a route, search, publish a fare, find the offer on Explore, book it.
- Explore split view (1280 and 390 px) for an offer, a tour and a hotel: open from a tab and from All, switch items in the column, ✕ and Escape back to the tab with its filters, page and scroll kept, a shared link opened directly, a made-up id showing not found inside the detail card.
- Explore heading cards (1280 and 390 px): All, Flights (Any and Return), Tours and Hotels, each a primary card at the content width with its headline, the same height on all four at 1280 px.
- List rail (1280 px) on Chats, Admin Bookings and platform Agencies: open an item, check the rail rows, switch items, collapse and expand, Escape back to the full list with its filter and page kept (also after loading a detail URL directly and with the focus in a text field); a made-up id shows not found inside the detail only; at 390 px the detail is still full screen.
- Themes: two agencies with different themes on Explore, offer detail, a booking, Dashboard and Settings, with no leftovers in Dira Manifest's colours; changing the theme in Settings; the platform Themes section (create a theme, a failing pair with Save disabled, edit, make default, deactivate) and the New agency dialog.
- Bar colour: themes with a navy primary and a yellow (#ffd100), a pastel (#f8c8dc) and a white (#ffffff) bar on Explore (top bar, heading cards and tiles with dark text), offer detail, the sign-in page and an email; a bar refused in the Themes form with Save disabled; a theme without a bar unchanged.
- Modules: an agency with flights only (no switch) and one with flights off (no flight screens or nav); a `module_off` link; the platform's Modules card and a refused switch.
- Tours: Explore's Tours tab and cards, the two-row search (departure city, destination, name, organiser), filters and sort; tour detail with photos and options; booking several options as a guest through the auth gate, a fully booked tour (its card in the Tours list and on Explore All, its detail with Book replaced), a limited option running out; adding travellers at booking up to an option's people, and adding, editing and removing them afterwards; the customer's tour booking and cancel; Admin › Tours: create with options and photos, edit with and without a notice, book for a customer, cancel a booking with a message, and cancel a tour.
- Hotels: Explore Hotels with and without dates, filters and sort; hotel detail prices across a season change and for 1 and 2 adults on a rate with a per-adult charge; requesting two rooms as a guest through the auth gate; the admin confirming with a new total and the customer accepting; mark paid, voucher upload and send; the customer opening the voucher; unavailable with a message; creating a hotel with rooms, rates, periods (an overlap refused) and photos.
- Explore and dashboard: Explore All with three modules (hero tiles, featured sections, See all, a module with nothing to show), a flights-only agency (Featured row, hidden after a search), a tours-only agency; featuring from an admin table; the dashboard with all three modules (stacked chart and legend, mixed Coming up and Top sellers, label rules), with one (no icons, headings or breakdown lines), with sales and an overdue invoice, and an empty agency.
- Reviews: a customer reviewing a finished tour, hotel stay and flight booking (with the flight note), then editing and deleting; ratings on cards and the Reviews section with a reply; the flight service rating dialog; Admin › Reviews: filtering, replying and hiding; an agency with no reviews.
- Website (1280, 900 and 390 px): every section; no horizontal overflow; the bar links and anchors (including loading `/#hotels`); the phone menu sheet; the FAQ accordion; Get started opening the prefilled chat; the pricing preview and See all plans; a signed-in owner seeing Open admin; and the `/pricing` page with the new bar.
- Device (the user's): iOS and Android builds; first launch with a code; a link before and after install; a link to another agency (Switch and Cancel); a reset link while signed in; Switch agency from the menu; API calls going to the right agency; the native app taking the agency's theme and changing it on Switch agency.

## 20. Build history

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
34. Return trips and flight details.
35. GDS search: integrations, routes, manual search and review.
36. Scheduled route searches and offer refresh.
37. Re-check a booking's fare.
38. Second provider: Travelport.
39. Mobile app: one shared app, agency from links or code.
40. Detail pages with a slim list rail.
41. Agency dashboard.
42. Third provider: Sabre.
43. Fourth provider: Amadeus.
44. Agency themes.
45. Modules: flights, tours and hotels per agency.
46. Tours.
47. Flight passenger details.
48. Hotels.
49. Dashboard and Explore across modules.
50. Fully booked tours stay visible.
51. Reviews.
52. Platform website.
53. Explore split view, plane photo on flight cards, airline codes in badges.
54. Airline logos from Travelpayouts.
55. Explore: wider tabs with filters on the left, one results toolbar, new module switch, two-row tour and hotel search, tour departure city and organiser.
56. Explore heading cards: one primary card per tab, content width, large headline, fixed height, search panels on the hover shade; white on the hover shade added to the theme contrast rules.
57. Theme bar colour so light brand colours work (bar, bar_text, bar_hover), and optional text colours for the primary, the bar and the accent.
58. Accent buttons stand out from the bar: the accent at least 3:1 against the bar (or primary); Teal & Coral's accent becomes #ff9a7a by migration.
59. Rebrand to Dira Manifest (diramanifest.com): every name, email, page title and footer; mobile bundle id and package `com.diramanifest.app`, link scheme `dira`, stored keys `dira.*` (signed-in users sign in once more).
60. The top bar shows the agency's name instead of the system name.
61. Font sizes swapped: the top bar name 28 px (22 px narrow), the Explore heading card headline 18 px (15 px on phones).
62. The sign-in, register, forgot and reset password brand panel shows the agency's name (Dira Manifest on the platform).
63. The sign-in brand panel's tagline and ticks follow the agency's modules.
64. The agency-unavailable page shows the agency's name; `tenant_suspended` responses carry `agency_name`.
