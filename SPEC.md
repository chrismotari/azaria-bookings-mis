You are building "Azaria Bookings", a flight-offerings and booking portal for a Nairobi travel agency (azariabookings.com). A single admin (the agency owner, who is affiliated with multiple airlines) lists flight deals. Anyone can browse the deals. Registered customers can request options when nothing fits and can book. The admin confirms availability, customers pay outside the system, the admin marks the order paid, then uploads the boarding passes and sends them to the customer by email. Customers can also download them from the app.

A monorepo scaffold already exists and is committed. Build on it. Do not re-create or re-initialise anything that exists.

======================================================================
WHAT ALREADY EXISTS (do not redo)
======================================================================
- Monorepo root with .gitignore.
- backend/: Django project "config" (manage.py at backend/manage.py), a virtualenv at backend/.venv, requirements.txt, .env and .env.example, data/raw/airports.csv and data/raw/countries.csv (OurAirports data). Installed: django, djangorestframework, djangorestframework-simplejwt, django-filter, django-cors-headers, celery, redis, psycopg[binary], django-environ, pytest, pytest-django, freezegun.
- A PostgreSQL database "azaria" (user azaria, with CREATEDB so pytest can create its test database) and a local Redis. Both are running on this machine.
- backend/.env contains FRONTEND_URL (the web app's base URL, http://localhost:8081 in development). Add FRONTEND_URL to .env.example too.
- frontend/: a blank Expo TypeScript app with react-native-web, react-dom and @expo/metro-runtime installed.
There is NO Docker in this project. Do not create Dockerfiles, docker-compose files or container configuration.

======================================================================
HARD RULES
======================================================================
- PostgreSQL is the only database, in development, tests and production. No SQLite fallbacks.
- No TODOs, stubs, placeholder functions, mock data in production code, unused fields, unused endpoints, unused models, or unused dependencies.
- Do not build: passenger details, payment processing or integrations, push notifications, Amadeus or any airline API, email verification, replacing or re-sending boarding passes after a booking is completed, multi-currency, multi-language, social login, reviews, packages, blog or marketing pages.
- Single currency: USD, defined once as a Django setting CURRENCY = "USD". No currency column anywhere.
- When something is ambiguous, choose the simplest option that satisfies this spec and record it in one line in README.md under "Decisions". Do not stop to ask.
- WEB FIRST: whenever web and native conflict, choose web. The frontend is developed and verified in the browser (npx expo start --web). It must still compile for native, but native behaviour is not tested or tuned now.
- Time zone Africa/Nairobi with USE_TZ = True. Times in emails and UI are shown in Nairobi time.
- "Admin" means the agency owner's role in the app (User.role == "admin"). Django's built-in admin site is only for technical support: mount it at /django-admin/, superusers only. Never mix the two in code, naming or docs.
- Access model: guests (no account) may only browse offerings and view offering details, plus airport search. Every other capability needs an account.

======================================================================
BACKEND CONFIGURATION
======================================================================
- Read settings from backend/.env via django-environ (DATABASE_URL, REDIS_URL, SECRET_KEY, DEBUG, ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS, FRONTEND_URL, EMAIL_*, DEFAULT_FROM_EMAIL, ADMIN_EMAIL).
- Dev email backend: console when EMAIL_HOST is empty, SMTP otherwise. Tests use locmem.
- Celery: config/celery.py, broker and result backend from REDIS_URL, task_acks_late=True, JSON serializer, timezone Africa/Nairobi, beat schedule in settings (CELERY_BEAT_SCHEDULE). No django-celery-beat.
- File storage for boarding passes: a custom FileSystemStorage rooted at PRIVATE_MEDIA_ROOT (backend/private_media/, add to .gitignore) with no base_url. Django must never serve this directory by URL; files are only reachable through the authenticated download endpoint. Stored file names are random UUIDs plus the original extension.
- Add gunicorn only if you document a production run command; otherwise do not add it.
- pytest configured through backend/pytest.ini (DJANGO_SETTINGS_MODULE=config.settings). Update requirements.txt whenever dependencies change.
- Apps: accounts, catalog (Airport, Offering), requests (Query, QueryResponse), bookings (Booking, BookingEvent, BoardingPass), core (AppSettings, permissions, email templates).
- DRF defaults: JWT authentication (access 30 min, refresh 7 days), page-number pagination size 20, django-filter backend, JSON by default (multipart only for the boarding pass upload), throttling of register, login and password-reset requests at 10/min per IP. Django's password validators apply to registration and password reset.

======================================================================
MODELS
======================================================================
accounts.User (custom, login by email, no username)
- email (unique), full_name, phone, role ("customer" | "admin", default "customer").
- Public registration creates customers only. The admin user is created with: python manage.py create_admin --email --password --name. Superusers for /django-admin/ are created with Django's createsuperuser.

catalog.Airport
- code (3-letter IATA, unique), name, city, country (full country name).
- Management command seed_airports builds from backend/data/raw/airports.csv and countries.csv: keep rows with a non-empty iata_code and scheduled_service == "yes", exclude type "closed", map iso_country to country name via countries.csv, city = municipality (fall back to name). Idempotent via update_or_create on code. Read-only in the API.

catalog.Offering
- origin (FK Airport), destination (FK Airport), departure_date, ticket_class ("economy" | "premium_economy" | "business" | "first"), price (Decimal 10,2, per person), stopovers (PositiveSmallInteger, default 0), airline (CharField), valid_until (date, inclusive through that day in Nairobi time), is_public (default True), is_active (default True), created_at.
- Validation: origin != destination; price > 0; valid_until <= departure_date; valid_until >= today on create.
- "Bookable" = is_active AND valid_until >= today AND departure_date >= today.
- is_public=False is for offerings the admin creates for one specific query response; they never appear in public lists.
- No delete. The admin deactivates with is_active=false.

requests.Query
- user (FK), origin (FK Airport, null), destination (FK Airport, null), date_from, date_to (null), price_min, price_max (Decimal, null), ticket_class (blank = any), max_stopovers (null), message (blank), status ("open" | "responded" | "closed"), created_at.
- Validation: at least one of origin or destination; date_from <= date_to; price_min <= price_max.
- The customer may close their own query: POST /api/queries/{id}/close.

requests.QueryResponse
- query (FK), message (blank), offerings (ManyToMany Offering), created_at. The admin may respond more than once. Creating a response sets query.status = "responded".

bookings.Booking
- user (FK), offering (FK), query (FK, null), passenger_count (1-9), notes (blank), unit_price (copied from offering.price at creation), status, payment_deadline (datetime, null), reminder_sent_at (datetime, null), created_at. total_price is a computed property = unit_price * passenger_count.
- Statuses: requested, availability_confirmed, paid, completed, unavailable, cancelled, expired.
- On create: the offering must be bookable and visible to the user; the user must not already hold a booking on the same offering in requested, availability_confirmed or paid.

bookings.BookingEvent
- booking (FK), from_status (blank on creation), to_status, actor (FK User, null when the system acted), created_at. Written on every status change including creation. Used for the timeline.

bookings.BoardingPass
- booking (FK, related_name "boarding_passes"), file (FileField on the private storage, upload_to "boarding_passes/<booking_id>/"), original_name, uploaded_at.
- A booking may have several passes (one file per passenger, for example). Max 10 per booking. Each file: PDF, PNG or JPEG (validate extension and content type), max 5 MB.
- Passes can be uploaded or deleted only while the booking is in status paid. Deleting a pass also deletes its file from disk.

core.AppSettings (single row, pk=1, created by a data migration)
- payment_instructions (text), payment_hold_hours (default 24), reminder_hours_before (default 4), admin_notification_email.
- AppSettings.get() returns the row. The data migration seeds admin_notification_email from the ADMIN_EMAIL setting and leaves payment_instructions empty.

No other models or tables. Password reset uses Django's default_token_generator and needs no table.

======================================================================
BOOKING STATE MACHINE
======================================================================
All status changes go through bookings/services.py: transition(booking_id, to_status, actor) -> Booking. Booking creation goes through create_booking(user, data) in the same module, which applies the same locking and validation, writes the creation BookingEvent (from_status blank, to_status requested) and queues email 3.
transition runs inside transaction.atomic, locks the row with select_for_update, validates the move against the table and the actor's role, updates the status, writes a BookingEvent, applies side effects, and queues the matching email with transaction.on_commit. Invalid moves raise a domain error which the API returns as 409 with a clear message. Views never set status directly.

Allowed transitions:
- requested -> availability_confirmed   (admin). Side effects: payment_deadline = now + payment_hold_hours; reminder_sent_at = null. Refuse with 409 if AppSettings.payment_instructions is empty.
- requested -> unavailable              (admin)
- requested -> cancelled                (the booking's customer)
- requested -> expired                  (system, actor null)
- availability_confirmed -> paid        (admin). Refuse with 409 if payment_deadline has passed; the scheduled task will expire the booking and the customer must book again.
- availability_confirmed -> unavailable (admin)
- availability_confirmed -> cancelled   (the booking's customer)
- availability_confirmed -> expired     (system)
- paid -> completed                     (admin). Refuse with 409 if the booking has no boarding passes. This is the "send boarding passes" action.
Terminal: completed, unavailable, cancelled, expired.

Which email each event queues:
- booking created -> 3
- availability_confirmed -> 4
- unavailable -> 5
- paid -> 6
- expired -> 7
- completed -> 9
- cancelled -> none

======================================================================
CELERY TASKS
======================================================================
Email tasks take only IDs, use autoretry_for=(Exception,), retry_backoff=True, max_retries=5, and reload the object and check it is still in the state the email describes before sending (retries and late deliveries are therefore safe). Plain-text templates in core/templates/emails/. Sent with Django's EmailMessage.
1. notify_admin_new_query(query_id) -> admin_notification_email. Customer name and email, route, date range, price range, class, max stopovers, message.
2. notify_customer_query_responded(query_response_id) -> customer. Admin message, number of options, "open the app to view them".
3. notify_admin_new_booking(booking_id) -> admin_notification_email. Customer, route, date, class, airline, passenger count, total price, notes.
4. notify_customer_availability_confirmed(booking_id) -> customer. Route, total price, payment instructions, payment deadline in Nairobi time.
5. notify_customer_unavailable(booking_id) -> customer. Apology and a suggestion to request other options in the app.
6. notify_customer_payment_received(booking_id) -> customer. Payment received, order complete; the boarding pass will be emailed once ready and will also be available to download in the app.
7. notify_customer_booking_expired(booking_id) -> customer. Hold lapsed because payment was not received in time; they can book again if the offering is still available.
8. notify_customer_payment_reminder(booking_id) -> customer. Deadline and payment instructions.
9. notify_customer_boarding_passes(booking_id) -> customer. Boarding pass(es) attached (every BoardingPass file of the booking, with its original name), route and date, and a note that they can also be downloaded from the booking in the app. Runs only if the booking is completed.
10. send_password_reset_email(user_id) -> user. Link of the form {FRONTEND_URL}/reset-password?uid=<urlsafe base64 pk>&token=<default_token_generator token>. Runs only if the user is active.

Scheduled (CELERY_BEAT_SCHEDULE):
- expire_unpaid_bookings, every 5 minutes: availability_confirmed bookings with payment_deadline < now; each is passed to transition(id, "expired", actor=None) in its own transaction, skipping those that raise an invalid-transition error (they were paid in the meantime).
- send_payment_reminders, every 15 minutes: availability_confirmed bookings with reminder_sent_at null and payment_deadline - reminder_hours_before <= now < payment_deadline; per booking, in a transaction with select_for_update, re-check, set reminder_sent_at = now, then queue email 8 on commit.
- expire_stale_requests, hourly: requested bookings whose offering.departure_date < today -> transition to expired with actor=None.

======================================================================
PERMISSIONS
======================================================================
- IsAdminRole permission: authenticated and role == "admin". All /api/admin/ endpoints require it.
- Guests (no auth) may call only: offering list, offering detail (public ones only), airport search, register, login, refresh, password-reset request and confirm. Everything else needs a JWT and returns 401 otherwise.
- Customers see only their own queries and bookings.
- Offering visibility for an authenticated customer: (is_active AND is_public) OR the offering is attached to a QueryResponse of one of that customer's queries. Browse and lists use the first condition only; detail and booking creation also allow the second. Guests get the first condition only.
- Boarding passes: the booking's customer sees and can download its passes only when the booking is completed. Until then they are visible to the admin only. The customer booking serializer includes boarding_passes only when status is completed.

======================================================================
API (under /api/)
======================================================================
Auth
- POST /auth/register {email, password, full_name, phone} -> creates customer, returns tokens + user
- POST /auth/login -> access, refresh, user
- POST /auth/refresh
- GET /auth/me
- POST /auth/password-reset {email} -> always returns 200 with the same body whether or not the account exists; queues email 10 when it does
- POST /auth/password-reset-confirm {uid, token, new_password} -> sets the password if the token is valid, else 400

Airports
- GET /airports?search= (icontains on code, name, city, country; exact code match first; max 20)

Browse (guests allowed)
- GET /offerings with filters: origin, destination (text; each matches airport code exactly OR city/country/name icontains), date_from, date_to (departure_date range), price_min, price_max, ticket_class, max_stopovers (stopovers <= value). Only bookable public offerings. Default order departure_date then price; ordering=price|-price|departure_date.
- GET /offerings/{id}

Customer (login required)
- POST /queries, GET /queries, GET /queries/{id} (includes responses with full offering objects), POST /queries/{id}/close
- POST /bookings {offering, passenger_count, notes, query (optional)}, GET /bookings, GET /bookings/{id} (includes events, and boarding_passes when completed), POST /bookings/{id}/cancel
- GET /boarding-passes/{id}/download -> streams the file as an attachment with its original name. Allowed for the admin, or for the booking's customer when the booking is completed; otherwise 404.

Admin (/api/admin/)
- GET /dashboard -> open_queries, bookings_requested, bookings_awaiting_payment (availability_confirmed), bookings_paid_awaiting_boarding_pass (paid)
- GET, POST /offerings; GET, PATCH /offerings/{id} (list filters as customer plus is_active, is_public; includes non-public)
- GET /queries (filter by status), GET /queries/{id}
- POST /queries/{id}/respond {message, offering_ids, new_offerings} -> at least one offering required; new_offerings are created with is_public=false; everything in one transaction; query becomes responded; queues email 2.
- GET /bookings (filter by status), GET /bookings/{id} (events, customer details, boarding passes at any status)
- POST /bookings/{id}/confirm-availability, /mark-unavailable, /mark-paid, /complete (each calls transition; complete = send boarding passes)
- POST /bookings/{id}/boarding-passes (multipart, field "file", one file per request; only while status paid; enforces type, size and the 10-file cap)
- DELETE /boarding-passes/{id} (only while its booking is paid)
- GET, PATCH /settings

Errors use DRF's standard format; invalid transitions return 409.

======================================================================
FRONTEND (frontend/, Expo + TypeScript, WEB FIRST)
======================================================================
Libraries: React Navigation (with linking configured so every screen has a real browser URL), TanStack Query, axios, react-hook-form + zod, expo-secure-store (native token storage only). Do not add a native date picker or a native document picker.
- Config: API base URL from EXPO_PUBLIC_API_URL (document in frontend/.env.example).
- Token storage: a small storage module using localStorage on web and expo-secure-store on native. axios interceptor refreshes once on 401, then logs out.
- Dates: use a web-native date input on web (<input type="date"> through a small cross-platform DateField component). Native fallback uses a plain text input in YYYY-MM-DD format validated by zod.
- File upload and download are web-only for now: upload through <input type="file"> in a small FileField component, download by fetching the file with the auth header as a blob and triggering a browser download. On native these controls show a short notice that the feature is available on the web app.
- Responsive layout: on wide viewports (>= 900 px) navigation is a left sidebar and content is centred with a max width; on narrow viewports it collapses to bottom tabs. Lists become tables or multi-column grids on wide screens where it helps.

Guest, customer and admin navigation
- Guest (not logged in): Explore and offering detail only, plus Sign in and Create account in the header or sidebar.
- Login-required actions ("Request options", "Book", and the Requests, Bookings and Account screens) go through one auth gate. When a guest triggers one, the gate stores the intended action (screen and params, including the prefilled query filters) in app state, sends the guest to Login (with a link to Register), and after a successful login or registration navigates to that stored action. The stored action is kept in memory only.
- Login screen has a "Forgot password" link to a request screen (/forgot-password) and the reset screen (/reset-password?uid=&token=) that calls the confirm endpoint, then goes to Login.
- Role routing after login: role "customer" -> customer navigation; role "admin" -> admin navigation. Admin screens are also protected by the backend permission.

Customer navigation
1. Explore (open to guests): From and To (airport autocomplete from /airports; free text also allowed), filters (dates, price range, class, max stopovers), results (route, date, class, airline, stopovers, price, valid until). If there are zero results, show an empty state with a "Request options" button that opens the query form pre-filled with the filters (airports only when chosen from autocomplete), through the auth gate.
2. Requests: my queries with status; detail shows my filter and the admin's responses with the offerings listed; each offering opens the offering detail with a Book button.
3. Bookings: list with status chips; detail shows route, total price, payment instructions and deadline when availability_confirmed, the event timeline, a Cancel button when allowed, and, when completed, the list of boarding passes with a Download button each.
4. Account: name, email, phone, logout.
Offering detail (open to guests) has a Book button, through the auth gate, that opens a small form (passenger_count, notes) and creates the booking.

Admin navigation
1. Dashboard: the four counts, each linking to the matching filtered list.
2. Offerings: list with filters; create and edit form (airport pickers, date fields, class, price, stopovers, airline, valid until, public toggle); deactivate toggle.
3. Requests: inbox filtered by status; detail shows the filter and customer; a Respond screen lets the admin select existing offerings (search by route and date), add new custom offerings inline (is_public false), and write a message.
4. Bookings: status tabs; detail shows customer, offering, passenger count, notes, timeline. Action buttons appear only for valid next states (Confirm availability, Mark unavailable, Mark paid) with a confirm dialog. When the booking is paid, show a boarding pass section: upload files, list them with name and a Delete button, and a "Send boarding passes" button (calls /complete) that is disabled until at least one file exists. When completed, show the sent files with Download.
5. Settings: payment instructions, payment hold hours, reminder hours, notification email.

UX requirements: loading, empty and error states on every list; form validation with zod mirroring server rules; prices formatted as USD; dates in a readable format; no horizontal scrolling at any width.

======================================================================
TESTS (backend, pytest)
======================================================================
- Every allowed transition succeeds for the right actor; every other combination returns 409 or 403.
- Each transition and booking creation queues exactly the email listed in the mapping, and cancelled queues none.
- Marking paid while the expiry task runs on the same booking ends in exactly one outcome.
- Expiry, reminder and stale-request tasks using freezegun (before, at and after thresholds; reminder sent only once).
- Offering visibility: a non-public offering is hidden from browse, hidden from guests and other customers, visible to the customer whose query it was attached to.
- Guests can list and view public offerings and search airports; guests get 401 on queries, bookings and passes.
- Offering filters (city, country, airport code, date range, price range, class, stopovers).
- Booking creation rules (not bookable, duplicate active booking, passenger bounds).
- Admin endpoints reject customers; customers cannot read other customers' queries or bookings.
- Boarding passes: upload only while paid; rejects wrong type, oversize, and the 11th file; delete removes the file from disk; complete fails with no passes; customer cannot see or download passes before completion; another customer cannot download them after completion; admin can download at any status; the completion email has every file attached.
- Password reset: request returns the same response for known and unknown emails; a valid token sets the password; a wrong or reused token returns 400.
- Each email task sends to the right recipient with the right content and does nothing if the state has changed.
- confirm-availability fails when payment_instructions is empty.
- The frontend needs only type-checking (tsc --noEmit) and a successful web export (npx expo export --platform web).

======================================================================
DELIVERY ORDER (commit after each step; the app must run at each step)
======================================================================
1. Backend foundation: settings from .env, DRF/JWT/CORS/Celery wiring, accounts app with register, login, refresh, me, password reset and email task 10, create_admin, core AppSettings and migration, catalog.Airport and seed_airports, /django-admin/ mount, private storage setup, migrate and tests passing.
2. Offering model, admin offering endpoints, public offering list with filters, tests. Frontend: API client, storage module, auth screens (login, register, forgot and reset password), auth gate, role routing, admin Offerings screens.
3. Guest-accessible Explore and offering detail screens.
4. Queries: models, endpoints, email tasks 1 and 2, admin Requests and respond flow, customer Requests, no-results prefill through the auth gate.
5. Bookings: models, create_booking and transition services, endpoints, email tasks 3 to 7, admin Bookings screens, customer Bookings screens, admin Dashboard.
6. Boarding passes: model, upload, delete, download endpoint, completion transition and email 9, admin upload and send UI, customer download UI, tests.
7. Celery beat tasks, email task 8, admin Settings screen, all tests green.
8. README.md: prerequisites (Python 3.12, Node 20+, PostgreSQL, Redis), first-time setup, and the four processes to run in separate terminals:
   - cd backend && python manage.py runserver
   - cd backend && celery -A config worker -l info
   - cd backend && celery -A config beat -l info
   - cd frontend && npx expo start --web
   Also: create_admin, seed_airports, running tests, and the Decisions list.

Finish each step before starting the next. At the end, run the full test suite and do a manual browser walkthrough of the entire flow as guest and as customer (browse as a guest -> no result -> sign up -> query -> admin responds -> book -> confirm -> pay -> upload pass -> send -> customer downloads, plus an expiry case and a password reset) and report any deviations from this spec.