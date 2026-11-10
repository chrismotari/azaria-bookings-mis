You are building "Azaria Bookings", a flight-offers and booking portal for a Nairobi travel agency (azariabookings.com). A single admin (the agency owner, who is affiliated with multiple airlines) lists flight deals. Anyone can browse the deals. Registered customers can request options when nothing fits and can book. The admin confirms availability, customers pay outside the system, the admin marks the order paid, then uploads the boarding passes and sends them to the customer by email. Customers can also download them from the app.

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
- Access model: guests (no account) may only browse offers and view offer details, plus airport search. Every other capability needs an account.

======================================================================
BACKEND CONFIGURATION
======================================================================
- Read settings from backend/.env via django-environ (DATABASE_URL, REDIS_URL, SECRET_KEY, DEBUG, ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS, FRONTEND_URL, EMAIL_*, DEFAULT_FROM_EMAIL, ADMIN_EMAIL).
- Dev email backend: console when EMAIL_HOST is empty, SMTP otherwise. Tests use locmem.
- Celery: config/celery.py, broker and result backend from REDIS_URL, task_acks_late=True, JSON serializer, timezone Africa/Nairobi, beat schedule in settings (CELERY_BEAT_SCHEDULE). No django-celery-beat.
- File storage for boarding passes: a custom FileSystemStorage rooted at PRIVATE_MEDIA_ROOT (backend/private_media/, add to .gitignore) with no base_url. Django must never serve this directory by URL; files are only reachable through the authenticated download endpoint. Stored file names are random UUIDs plus the original extension.
- Add gunicorn only if you document a production run command; otherwise do not add it.
- pytest configured through backend/pytest.ini (DJANGO_SETTINGS_MODULE=config.settings). Update requirements.txt whenever dependencies change.
- Apps: accounts, catalog (Airport, Offer), requests (Query, QueryResponse), bookings (Booking, BookingEvent, BoardingPass), core (AppSettings, permissions, email templates).
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

catalog.Offer
- origin (FK Airport), destination (FK Airport), departure_date, ticket_class ("economy" | "premium_economy" | "business" | "first"), price (Decimal 10,2, per person), stopovers (PositiveSmallInteger, default 0), airline (CharField), valid_until (date, inclusive through that day in Nairobi time), is_public (default True), is_active (default True), created_at.
- Validation: origin != destination; price > 0; valid_until <= departure_date; valid_until >= today on create.
- "Bookable" = is_active AND valid_until >= today AND departure_date >= today.
- is_public=False is for offers the admin creates for one specific query response; they never appear in public lists.
- No delete. The admin deactivates with is_active=false.

requests.Query
- user (FK), origin (FK Airport, null), destination (FK Airport, null), date_from, date_to (null), price_min, price_max (Decimal, null), ticket_class (blank = any), max_stopovers (null), message (blank), status ("open" | "responded" | "closed"), created_at.
- Validation: at least one of origin or destination; date_from <= date_to; price_min <= price_max.
- The customer may close their own query: POST /api/queries/{id}/close.

requests.QueryResponse
- query (FK), message (blank), offers (ManyToMany Offer), created_at. The admin may respond more than once. Creating a response sets query.status = "responded".

bookings.Booking
- user (FK), offer (FK), query (FK, null), passenger_count (1-9), notes (blank), unit_price (copied from offer.price at creation), status, payment_deadline (datetime, null), reminder_sent_at (datetime, null), created_at. total_price is a computed property = unit_price * passenger_count.
- Statuses: requested, availability_confirmed, paid, completed, unavailable, cancelled, expired.
- On create: the offer must be bookable and visible to the user; the user must not already hold a booking on the same offer in requested, availability_confirmed or paid.

bookings.BookingEvent
- booking (FK), from_status (blank on creation), to_status, actor (FK User, null when the system acted), created_at. Written on every status change including creation. Used for the timeline.

bookings.BoardingPass
- booking (FK, related_name "boarding_passes"), file (FileField on the private storage, upload_to "boarding_passes/<booking_id>/"), original_name, uploaded_at.
- A booking may have several passes (one file per passenger, for example). Max 10 per booking. Each file: PDF, PNG or JPEG (validate extension and content type), max 5 MB.
- Passes can be uploaded or deleted only while the booking is in status paid. Deleting a pass also deletes its file from disk.

core.AppSettings (single row, pk=1, created by a data migration)
- payment_instructions (text), payment_hold_hours (default 24), reminder_hours_before (default 4), admin_notification_email.
- AppSettings.get() returns the row. The data migration seeds admin_notification_email from the ADMIN_EMAIL setting and leaves payment_instructions empty.

No other models or tables, apart from those in ADMIN AND BOOKING ADDITIONS. Password reset uses Django's default_token_generator and needs no table.

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
Email tasks take only IDs, use autoretry_for=(Exception,), retry_backoff=True, max_retries=5, and reload the object and check it is still in the state the email describes before sending (retries and late deliveries are therefore safe). Plain-text templates in core/templates/emails/. Sent with Django's EmailMessage (replaced by HTML plus plain-text emails in step 12, see HTML EMAILS).
1. notify_admin_new_query(query_id) -> admin_notification_email. Customer name and email, route, date range, price range, class, max stopovers, message.
2. notify_customer_query_responded(query_response_id) -> customer. Admin message, number of options, "open the app to view them".
3. notify_admin_new_booking(booking_id) -> admin_notification_email. Customer, route, date, class, airline, passenger count, total price, notes.
4. notify_customer_availability_confirmed(booking_id) -> customer. Route, total price, payment instructions, payment deadline in Nairobi time.
5. notify_customer_unavailable(booking_id) -> customer. Apology and a suggestion to request other options in the app.
6. notify_customer_payment_received(booking_id) -> customer. Payment received, order complete; the boarding pass will be emailed once ready and will also be available to download in the app.
7. notify_customer_booking_expired(booking_id) -> customer. Hold lapsed because payment was not received in time; they can book again if the offer is still available.
8. notify_customer_payment_reminder(booking_id) -> customer. Deadline and payment instructions.
9. notify_customer_boarding_passes(booking_id) -> customer. Boarding pass(es) attached (every BoardingPass file of the booking, with its original name), route and date, and a note that they can also be downloaded from the booking in the app. Runs only if the booking is completed.
10. send_password_reset_email(user_id) -> user. Link of the form {FRONTEND_URL}/reset-password?uid=<urlsafe base64 pk>&token=<default_token_generator token>. Runs only if the user is active.

Scheduled (CELERY_BEAT_SCHEDULE):
- expire_unpaid_bookings, every 5 minutes: availability_confirmed bookings with payment_deadline < now; each is passed to transition(id, "expired", actor=None) in its own transaction, skipping those that raise an invalid-transition error (they were paid in the meantime).
- send_payment_reminders, every 15 minutes: availability_confirmed bookings with reminder_sent_at null and payment_deadline - reminder_hours_before <= now < payment_deadline; per booking, in a transaction with select_for_update, re-check, set reminder_sent_at = now, then queue email 8 on commit.
- expire_stale_requests, hourly: requested bookings whose offer.departure_date < today -> transition to expired with actor=None.

======================================================================
PERMISSIONS
======================================================================
- IsAdminRole permission: authenticated and role == "admin". All /api/admin/ endpoints require it.
- Guests (no auth) may call only: offer list, offer detail (public ones only), airport search, register, login, refresh, password-reset request and confirm. Everything else needs a JWT and returns 401 otherwise.
- Customers see only their own queries and bookings.
- Offer visibility for an authenticated customer: (is_active AND is_public) OR the offer is attached to a QueryResponse of one of that customer's queries. Browse and lists use the first condition only; detail and booking creation also allow the second. Guests get the first condition only.
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
- GET /offers with filters: origin, destination (text; each matches airport code exactly OR city/country/name icontains), date_from, date_to (departure_date range), price_min, price_max, ticket_class, max_stopovers (stopovers <= value). Only bookable public offers. Default order departure_date then price; ordering=price|-price|departure_date.
- GET /offers/{id}

Customer (login required)
- POST /queries, GET /queries, GET /queries/{id} (includes responses with full offer objects), POST /queries/{id}/close
- POST /bookings {offer, passenger_count, notes, query (optional)}, GET /bookings, GET /bookings/{id} (includes events, and boarding_passes when completed), POST /bookings/{id}/cancel
- GET /boarding-passes/{id}/download -> streams the file as an attachment with its original name. Allowed for the admin, or for the booking's customer when the booking is completed; otherwise 404.

Admin (/api/admin/)
- GET /dashboard -> open_queries, bookings_requested, bookings_awaiting_payment (availability_confirmed), bookings_paid_awaiting_boarding_pass (paid)
- GET, POST /offers; GET, PATCH /offers/{id} (list filters as customer plus is_active, is_public; includes non-public)
- GET /queries (filter by status), GET /queries/{id}
- POST /queries/{id}/respond {message, offer_ids, new_offers} -> at least one offer required; new_offers are created with is_public=false; everything in one transaction; query becomes responded; queues email 2.
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
- File upload and download are web-only for now: upload through <input type="file"> in a small FileField component; files are fetched with the auth header as a blob. On native these controls show a short notice that the feature is available on the web app.
- Preview first (step 28): a file the browser can display (PDF, PNG, JPEG, WebP, GIF) opens in a new tab for preview, from an Open button ("Open PDF" for invoices). Only a file that cannot be previewed is downloaded, and if the browser blocks the new tab the file is downloaded instead. This applies to every file the app offers (boarding passes, invoice PDFs) and to any file type added later.
- Responsive layout: on wide viewports (>= 900 px) navigation is a top bar and content is centred with a max width; on narrow viewports it collapses to bottom tabs. Lists become tables or multi-column grids on wide screens where it helps. See LOOK AND LAYOUT for the details (this replaces the earlier left sidebar).

Guest, customer and admin navigation
- Guest (not logged in): Explore and offer detail only, plus Sign in and Create account in the header or sidebar.
- Login-required actions ("Request options", "Book", and the Requests, Bookings and Account screens) go through one auth gate. When a guest triggers one, the gate stores the intended action (screen and params, including the prefilled query filters) in app state, sends the guest to Login (with a link to Register), and after a successful login or registration navigates to that stored action. The stored action is kept in memory only.
- Login screen has a "Forgot password" link to a request screen (/forgot-password) and the reset screen (/reset-password?uid=&token=) that calls the confirm endpoint, then goes to Login.
- Role routing after login: role "customer" -> customer navigation; role "admin" -> admin navigation. Admin screens are also protected by the backend permission.

Customer navigation
1. Explore (open to guests): From and To (airport autocomplete from /airports; free text also allowed), filters (dates, price range, class, max stopovers), results (route, date, class, airline, stopovers, price, valid until). If there are zero results, show an empty state with a "Request options" button that opens the query form pre-filled with the filters (airports only when chosen from autocomplete), through the auth gate.
2. Requests: my queries with status; detail shows my filter and the admin's responses with the offers listed; each offer opens the offer detail with a Book button.
3. Bookings: list with status chips; detail shows route, total price, payment instructions and deadline when availability_confirmed, the event timeline, a Cancel button when allowed, and, when completed, the list of boarding passes with an Open button each (preview first, see FRONTEND).
4. Account: name, email, phone, logout.
Offer detail (open to guests) has a Book button, through the auth gate, that opens a small form (passenger_count, notes) and creates the booking.

Admin navigation
1. Dashboard: the four counts, each linking to the matching filtered list.
2. Offers: list with filters; create and edit form (airport pickers, date fields, class, price, stopovers, airline, valid until, public toggle); deactivate toggle.
3. Requests: inbox filtered by status; detail shows the filter and customer; a Respond screen lets the admin select existing offers (search by route and date), add new custom offers inline (is_public false), and write a message.
4. Bookings: status tabs; detail shows customer, offer, passenger count, notes, timeline. Action buttons appear only for valid next states (Confirm availability, Mark unavailable, Mark paid) with a confirm dialog. When the booking is paid, show a boarding pass section: upload files, list them with name and a Delete button, and a "Send boarding passes" button (calls /complete) that is disabled until at least one file exists. When completed, show the sent files with Open.
5. Settings: payment instructions, payment hold hours, reminder hours, notification email.

UX requirements: loading, empty and error states on every list; form validation with zod mirroring server rules; prices formatted as USD; dates in a readable format; no horizontal scrolling at any width.

======================================================================
TESTS (backend, pytest)
======================================================================
- Every allowed transition succeeds for the right actor; every other combination returns 409 or 403.
- Each transition and booking creation queues exactly the email listed in the mapping, and cancelled queues none.
- Marking paid while the expiry task runs on the same booking ends in exactly one outcome.
- Expiry, reminder and stale-request tasks using freezegun (before, at and after thresholds; reminder sent only once).
- Offer visibility: a non-public offer is hidden from browse, hidden from guests and other customers, visible to the customer whose query it was attached to.
- Guests can list and view public offers and search airports; guests get 401 on queries, bookings and passes.
- Offer filters (city, country, airport code, date range, price range, class, stopovers).
- Booking creation rules (not bookable, duplicate active booking, passenger bounds).
- Admin endpoints reject customers; customers cannot read other customers' queries or bookings.
- Boarding passes: upload only while paid; rejects wrong type, oversize, and the 11th file; delete removes the file from disk; complete fails with no passes; customer cannot see or download passes before completion; another customer cannot download them after completion; admin can download at any status; the completion email has every file attached.
- Password reset: request returns the same response for known and unknown emails; a valid token sets the password; a wrong or reused token returns 400.
- Each email task sends to the right recipient with the right content and does nothing if the state has changed.
- confirm-availability fails when payment_instructions is empty.
- The frontend needs only type-checking (tsc --noEmit) and a successful web export (npx expo export --platform web).

======================================================================
LOOK AND LAYOUT (UI refresh)
======================================================================
Goal: the app should look like part of azariabookings.com instead of a single-colour admin tool, use a top bar instead of a sidebar, and let users read an item's details without losing the list. Frontend only: no backend, API or data changes, and no new screens or features.

Colours (taken from azariabookings.com, assets/css/sections/variables.css)
- Primary (brand indigo) #1800d2: top bar, primary buttons, links, focused navigation item, active filters.
- Secondary (amber) #ffb400: prices and the main call to action on an offer (Book, Request options), with dark text (#252525) on it for contrast.
- Tertiary (slate green) #4a6660: secondary buttons and section headings.
- Neutrals: text #252525, dark #2d3434, muted #6c7171, light #a8b1b5, page background #f2f4f7, surface #ffffff, borders derived from the light grey.
- Status: success #51d77a, warning #faba2f, danger #fe455f, info #2275ff. Status chips use a light tint of the colour as background and a darker shade as text so the text meets WCAG AA contrast (4.5:1).
- All colours are defined once in src/theme.ts as named tokens. No hex values in screens or components outside theme.ts.
- The site's heading font (Gilroy) is proprietary and is not used. Keep the system font; headings get a heavier weight.

Navigation layout
- Wide (>= 900 px): a full-width top bar in the primary colour: "Azaria Bookings" on the left (links home), the navigation items next to it, and on the right the signed-in user's name with a menu (Account, Sign out) or, for guests, Sign in and Create account. The focused item is underlined or highlighted in amber. Content sits below, centred with a max width. The left sidebar is removed.
- Narrow (< 900 px): a slim top bar with the brand and the Sign in / account control, and bottom tabs for the navigation items (customer: Explore, Requests, Bookings, Account; admin: Dashboard, Offers, Requests, Bookings, Settings).
- Customer and admin use the same bar component; only the items differ.

Detail drawer (list stays visible)
- Applies to these list -> detail pairs: Explore -> offer detail; customer Requests -> request detail; customer Bookings -> booking detail; admin Offers -> offer edit; admin Requests -> request detail; admin Bookings -> booking detail.
- Wide (>= 900 px): selecting a row opens the detail in a panel sliding in from the right (about 480 px wide, full height under the top bar). The list stays visible and usable on the left; the selected row is highlighted; choosing another row swaps the panel content. The panel closes with a close button or the Escape key. While it is open the list area narrows rather than being covered, so no content is hidden and nothing scrolls horizontally.
- Narrow (< 900 px): there is no room for both, so the detail opens full screen as it does today (with a back button to the list). This is the expected mobile behaviour, not a missing feature.
- URLs: the open detail keeps its own URL (for example /offers/12, /bookings/7), so reloads and shared links work. Opening that URL directly on a wide screen shows the list with the panel open. Opening and switching items does not add browser history entries: the browser back button leaves the list rather than closing the panel.
- Forms that start new work stay full-page screens, not drawers: Book, Request options, admin New offer, admin Respond to a request. Buttons inside a drawer that open them navigate as today.
- Actions inside a drawer (cancel booking, confirm availability, mark paid, upload or delete boarding passes, send, deactivate) refresh both the panel and the list behind it.

General polish
- Cards and table rows: white surface, subtle border and shadow, 8 px radius, consistent spacing scale (4, 8, 12, 16, 24, 32).
- Explore: offer results show the price in amber. (Step 14 replaces the Explore layout, see UI REFINEMENT.)
- Buttons: primary (indigo), call to action (amber), secondary (outline tertiary), danger (red). Visible focus outline on web for keyboard users.
- Loading, empty and error states keep working and use the new colours.

Delivery (each is its own step and commit; see DELIVERY ORDER 9 to 11)
- [x] 9. Theme: new colour tokens in theme.ts, every component and screen moved onto them (no stray hex values), buttons, chips, cards and Explore header restyled.
- [x] 10. Top bar navigation replacing the sidebar on wide screens; slim top bar plus bottom tabs on narrow screens; guest and signed-in controls in the bar.
- [x] 11. Detail drawer on wide screens for the six list -> detail pairs above, with URLs, Escape and close handling and list refresh after actions; full-screen detail on narrow screens. Browser check at 1280 px and 390 px widths.

======================================================================
HTML EMAILS
======================================================================
Goal: every email (1 to 10) is sent as formatted HTML that matches the app's theme, with the existing plain-text version kept as the fallback part.
- Send with Django's EmailMultiAlternatives: body = the existing .txt template, plus an HTML alternative rendered from a matching .html template in core/templates/emails/. Attachments (email 9) work as before.
- One base HTML layout (emails/base.html) that every HTML email extends: an indigo (#1800d2) header band with "Azaria Bookings", a white content card on a light grey (#f2f4f7) background, and a short footer (agency name, azariabookings.com link).
- Details such as route, dates, passengers and total price are laid out as a two-column table; prices are shown in amber (#ffb400) with dark text; payment instructions sit in a highlighted box; links (password reset, open the app) are amber buttons.
- Email-client safe: table-based layout, inline CSS only (no <style> blocks relied on for layout, no external CSS, no web fonts, no JavaScript), max width 600 px, readable on phones. No images, so nothing breaks when a client blocks them.
- The brand colours are written once as template context or a base-template block, not repeated per template.
- Content and recipients are unchanged; only the presentation changes. No new email types.
- Tests: each email has both a text and an HTML part, the HTML part contains the key details (route, total, deadline, reset link as applicable), and email 9 still carries every boarding pass attachment.

======================================================================
UI REFINEMENT (steps 13 to 16)
======================================================================
Goal: move the app from plain cards of label/value text to a polished travel-booking look, using the layout patterns of large booking sites such as trip.com (compact search bar, filter sidebar, sort tabs, flight result rows, sticky price summary, booking progress) in Azaria's own colours. Patterns only: no copied branding, imagery or wording. Frontend only: no backend, API or data changes. Everything shown comes from fields that already exist (there are no departure times or durations, so none are shown or invented).

Shared building blocks (step 13)
- Icons: @expo/vector-icons (Ionicons set) is the one new dependency allowed by this section. One Icon wrapper component; icons are decorative (hidden from screen readers) unless they are the only content of a button, which then gets an accessibility label.
- Typography scale in theme.ts (display 28, title 22, heading 18, body 15, small 13, caption 12) with weights, used by every screen instead of ad-hoc font sizes.
- Top bar: icons beside the nav items on wide screens; bottom tabs get an icon above each label. The account control shows the user's initials in a circle with the name and a chevron; its menu is unchanged (Account, Sign out).
- Hover (web) and pressed states on cards, rows, chips and buttons; the visible focus outline stays.
- Auth screens (Sign in, Create account, Forgot and Reset password): on wide screens a split layout with an indigo brand panel on the left (name, one-line tagline, three short benefit lines with icons) and the form card on the right; on narrow screens the form card alone under the slim top bar.
- Empty states: an icon in a tinted circle, a short title, one line of help text and, where one already exists, the action button.
- Status chips get a small leading icon or dot in the status colour.

Explore and offer detail (step 14)
- Hero: an indigo band across the top of Explore with a headline ("Find your next flight deal") and a white search bar on it: From, a swap button (⇄) that exchanges From and To, To, the departure date range (from / until), Class, and an amber Search button. On narrow screens the bar's fields stack inside the band.
- Filter sidebar on wide screens, left of the results: Price per person (min and max), Max stopovers as chips (Any, Direct, Up to 1, Up to 2), and Clear all. On narrow screens a "Filters" button with a count of active filters opens the same filters in a panel above the results.
- Sort tabs above the results (Soonest departure, Lowest price, Highest price) as a segmented control that fits in one row at 390 px; the result count sits beside them.
- Flight result rows (one per offer, full width of the results column): an airline badge (initials in a tinted circle; no logos until step 25, see AIRLINES, LOGOS AND FLAGS), airline name and class; a route line: origin code and city, a line with one dot per stopover and the label "Direct" or "N stop(s)", destination code and city; the departure date; on the right the amber price with "per person" and a "View deal" button. "Offer valid until" in small muted text. The selected row (drawer open) is highlighted.
- Zero results: the empty state with the existing "Request options" call to action, styled as an amber button.
- Offer detail (drawer and full screen): a header with the route line from the result rows drawn larger (codes, cities, airport names), a details grid with icons (departure date, airline, class, stopovers, valid until), and a price summary card with the price per person and the Book button. On the full-screen detail on wide screens the summary card sits on the right and stays in view while scrolling.
- Book form: the offer summary on top (route line, date, airline), a passenger stepper (− / +, within the existing bounds) in place of a bare number field, notes, and a live total (passengers × price) above the Book button.

Customer requests and bookings (step 15)
- Lists: trip cards showing the route line, date, airline and passengers (bookings) or dates and criteria (requests), the status chip, and for bookings the total in the price style. A thin left edge in the status colour.
- Booking detail: a progress tracker across the top for the normal path, Requested → Confirmed → Paid → Completed, with done, current and upcoming steps; a terminal status (unavailable, cancelled, expired) shows as a single banner in its status colour instead. The existing event timeline stays below as "History".
- While availability_confirmed: a highlighted payment box with the payment instructions, the deadline in Nairobi time and a countdown ("12 h 30 min left", updated each minute on the client; "Deadline passed" after it). The Cancel button stays where allowed.
- Completed: boarding passes as file rows with a file icon, name, upload time and an Open button (a Download button before step 28).
- Request detail: the criteria as a compact summary with icons; each response as a card with the admin's message and the offers as the same flight result rows used on Explore.

Admin screens (step 16)
- Dashboard: a greeting line, the four count tiles with an icon each, a coloured accent and a "View" link, each opening its filtered list as today. Tiles with a non-zero count that need action (bookings to confirm, paid awaiting boarding pass) are emphasised.
- Tables (Offers, Requests, Bookings): header row on a light tint, row hover, the route as codes with cities underneath, prices in the price style, status chips, and enough row height to read comfortably. Status filters are a segmented control or tabs with the active one in indigo.
- Detail drawers: the actions available for the current status sit together in an action bar at the top of the panel (primary action in indigo, Mark unavailable in danger style); the boarding pass section uses the file rows from step 15 and a dashed drop-style upload area (clicking it opens the existing file picker; no drag and drop required).
- Forms (New offer, Respond, Settings): grouped into titled sections inside cards, two columns on wide screens, with the save button in a footer bar.

Across all four steps: no hex values outside theme.ts, no horizontal scrolling at 390 px or 1280 px, loading/empty/error states keep working, and every step ends with a browser check at both widths.

Delivery (each is its own step and commit; see DELIVERY ORDER 13 to 16)
- [x] 13. Shared building blocks: icons, typography scale, top bar and tab icons, hover states, auth split layout, empty states, status chip icons.
- [x] 14. Explore and offer detail: hero search bar, filter sidebar, sort tabs, flight result rows, offer detail, book form.
- [x] 15. Customer requests and bookings: trip cards, progress tracker, payment box with countdown, boarding pass rows, request detail.
- [x] 16. Admin screens: dashboard tiles, tables, drawer action bars and upload area, sectioned forms.

======================================================================
UUID IDENTIFIERS (step 18, before the models added in steps 19 to 24)
======================================================================
Goal: replace sequential numeric ids with UUIDs so ids in URLs and the API cannot be guessed or counted.
- Primary keys of User, Airport, Offer, Query, QueryResponse, Booking, BookingEvent and BoardingPass become UUIDField(primary_key=True, default=uuid.uuid4, editable=False). AppSettings stays an integer singleton with pk=1. Airport's public identifier in the API is still its IATA code where it is used today.
- All foreign keys and many-to-many links follow automatically. API URLs, request bodies and responses carry UUID strings (for example /api/bookings/<uuid>); URL patterns use the uuid path converter.
- Frontend: id types become string; navigation linking paths and params use the UUID strings (for example /bookings/<uuid>).
- Boarding pass upload path becomes boarding_passes/<booking uuid>/. The password reset uid is the urlsafe base64 of the UUID pk.
- Migrations: there is no production data yet, so the migrations are regenerated from scratch rather than converting existing rows. After this step the local database is reset (drop, migrate, seed_airports, create_admin), and README.md says so.
- Tests updated to use UUIDs; a request with a malformed id returns 404, not 500.

======================================================================
ADMIN AND BOOKING ADDITIONS (steps 17, 19 to 21, 23 and 24)
======================================================================
Models added here (OfferStop, BookingStop) use UUID primary keys like the rest (step 18 comes first). Every backend change comes with tests; every UI change ends with a browser check at 390 px and 1280 px.

Admin booking progress and dialogs (step 17, frontend only)
- The admin booking drawer shows the same progress tracker as the customer booking detail (Requested -> Confirmed -> Paid -> Completed), or the terminal banner, above the booking summary.
- A shared Dialog component: a modal card over a dimmed page with a title, a scrollable body and a footer with the action buttons. Escape, the close button and a click on the dimmed area close it (except while saving); focus moves into it on open and back on close. On narrow screens it fills the screen. Sizes: small (confirmations) and large (forms).
- The browser confirm prompts (Cancel booking, Close request, Confirm availability, Mark unavailable, Mark paid, Send boarding passes, Delete file) become small dialogs built on it, with the action button in its usual style (danger for destructive actions).
- Steps 20, 21, 23 and 24 use dialogs for short tasks started from a list or drawer, so the admin keeps their place instead of navigating to a new screen. Long forms that already are screens (Book, Request options, New offer, Respond) stay screens.

Stops: layovers and stopovers (step 19)
- catalog.OfferStop: offer (FK, related_name "stops", cascade), position (PositiveSmallInteger, unique per offer, ordered), airport (FK Airport), duration_minutes (PositiveInteger, > 0).
- A stop is a "layover" when it lasts under 24 hours and a "stopover" when it lasts 24 hours or more. The kind is derived from the duration, never stored; the API returns it as kind.
- Offer.stopovers is removed. The number of stops is derived from the stop list (stop_count in the API). Validation: at most 4 stops; a stop's airport differs from the origin, the destination and the stop before it.
- API: offers return stops as an ordered list of {airport, duration_minutes, kind} plus stop_count. Admin create and edit, and new_offers in the respond endpoint, take stops as an ordered list of {airport (IATA code), duration_minutes}; an edit replaces the whole list. The max_stopovers filters (offers and queries) count all stops, layovers and stopovers alike.
- bookings.BookingStop: booking (FK, related_name "stops", cascade), position, airport, duration_minutes. Copied from the offer's stops when the booking is created, like unit_price, so later offer edits do not change existing bookings. Bookings show their own stops.
- UI: route lines show one dot per stop; offer and booking details list each stop with airport code, city, duration ("2 h 15 min") and a Layover or Stopover tag. The admin offer form (and custom offers on the Respond screen) gets a stop editor: add, remove and reorder stops, each with an airport picker and a duration in hours and minutes. Emails that show a flight show its stops.

Confirm availability with changes (step 20)
- POST /admin/bookings/{id}/confirm-availability accepts an optional body {unit_price, stops}. Values that differ from the booking's are applied to the booking (unit price, booking stops) in the same transition.
- New Booking fields: changes (JSON, null) records what changed as {"unit_price": {"old", "new"}, "stops": {"old", "new"}} with only the changed keys (stops as lists of airport code, city and duration), null when nothing changed; changes_accepted (Boolean, default false) becomes true when the customer accepts. Changes "await acceptance" while changes is set and changes_accepted is false.
- Customer: POST /bookings/{id}/accept-changes sets changes_accepted to true (only while availability_confirmed with changes awaiting acceptance, otherwise 409). POST /bookings/{id}/decline-changes moves the booking to the new terminal status "declined".
- State machine additions: availability_confirmed -> declined (the booking's customer, only while changes await acceptance), queues no email, like cancelled. availability_confirmed -> paid is refused with 409 while changes await acceptance. The payment deadline, reminders and expiry work as before.
- Email 4 lists the changes (old -> new) when there are any and asks the customer to accept or decline them in the app before paying.
- Customer UI: while changes await acceptance, the booking detail shows a changes box (each change as old -> new) with "Accept changes" and "Decline" (with a confirmation dialog) in place of the payment box; the payment box shows after accepting. Declined shows as a terminal banner. Booking lists and filters gain the Declined status.
- Admin UI: "Confirm availability" opens a large dialog with the price per person and the stop list prefilled and editable, a summary of what will change, and the Confirm availability button. The drawer shows when changes are waiting for the customer; Mark paid is disabled until they are accepted.

Mark unavailable with suggested options (step 21)
- POST /admin/bookings/{id}/mark-unavailable accepts an optional body {message, offer_ids, new_offers} in the format of the respond endpoint. With at least one offer, the same transaction creates a Query for the booking's customer (origin, destination, date_from and ticket_class from the booking's offer; status responded) and a QueryResponse with the message and offers, and links it to the booking (new Booking field alternatives, FK Query, null). Without offers it works as before.
- Email 5 then also carries the admin's message, the number of suggested options and a link to the request in the app; emails 1 and 2 are not sent for this request.
- Customer UI: the unavailable banner has a "View suggested options" button that opens that request when there are suggestions, and keeps "Request other options" otherwise.
- Admin UI: "Mark unavailable" opens a large dialog: the message, existing offers searched from the booking's route and date (selectable, as on Respond), an "Add custom offer" form, and a danger "Mark unavailable" button; choosing options is optional.

User management (step 23)
- Admin endpoints for customers: GET /admin/users (search on name, email and phone; filter is_active), POST /admin/users {email, full_name, phone}, GET and PATCH /admin/users/{id} (full_name, email, phone, is_active). Only role customer is listed or managed; the role cannot be changed here.
- Created users get an unusable password and email 11, send_account_created_email(user_id): a welcome with a set-password link in the email 10 format, using the same reset screen. Runs only if the user is active. Sent as HTML plus plain text like the others (see HTML EMAILS).
- Delete means deactivate (is_active false): the user cannot sign in or refresh a token, their requests and bookings stay, and the admin can reactivate them.
- Admin UI: a Users tab with a table (name, email, phone, status) and search, a drawer with the editable details and Deactivate or Reactivate in the action bar (with a confirmation dialog), and a "New user" button that opens a dialog (email, name, phone).

Admin books for a customer (step 24)
- POST /admin/bookings {user, offer, passenger_count, notes} creates the booking through create_booking with the admin as the event actor. The user must be an active customer; the offer must be bookable (public or private). The same duplicate-booking rule applies. Email 3 is not sent, since the admin made the booking. The booking then follows the normal flow from requested.
- Admin UI: a "New booking" button on Bookings opens a large dialog: customer (searchable dropdown of active customers), offer (search of bookable offers, as on the Respond screen), passenger stepper, notes and live total. Saving closes the dialog and opens the new booking in its drawer.

======================================================================
MULTITENANCY (step 22)
======================================================================
Goal: one installation serves many travel agencies. Each agency (a tenant) has its own PostgreSQL schema, so its users, offers, requests, bookings, files and settings are separate from every other agency's. The public schema is the platform itself ("app_admin"), used only by the system owner to create and manage tenants. Everything else in this spec describes one tenant unless it says otherwise.

Library and apps
- django-tenants (schema per tenant, tenant chosen from the request's hostname), the only new dependency. The PostgreSQL backend becomes django_tenants.postgresql_backend and the router django_tenants.routers.TenantSyncRouter.
- New shared app tenants: Tenant (TenantMixin: schema_name, name, is_active default true, created_at; auto_create_schema true, auto_drop_schema false) and Domain (DomainMixin: domain, tenant, is_primary).
- Airport moves out of catalog into a new shared app airports (model and seed_airports unchanged), so the 4,000+ airports are seeded once in public and every tenant's offers, stops and queries point at them.
- SHARED_APPS (public schema): django_tenants, tenants, airports, accounts, and the django.contrib apps. TENANT_APPS (each tenant schema): accounts, catalog (Offer, OfferStop), requests, bookings, core, and the django.contrib apps they need. accounts is in both: the public user table holds only the system owner's accounts, each tenant's user table holds that agency's admins and customers. The same email may hold separate accounts at different agencies.
- No production data exists yet, so migrations are regenerated from scratch (as in step 18) and the local database is reset; README.md says so. migrate_schemas replaces migrate. The core data migration that creates AppSettings (pk=1) runs in every tenant schema.

Hosts and routing
- New settings from .env: TENANT_BASE_DOMAIN (the platform's root host: localhost in development, azariabookings.com in production). FRONTEND_URL becomes a template with a {domain} placeholder (development: http://{domain}:8081; production: https://{domain}). ALLOWED_HOSTS includes the base domain and its subdomains (e.g. .localhost). CORS uses CORS_ALLOWED_ORIGIN_REGEXES from .env (development: ^http://([a-z0-9-]+\.)?localhost:8081$).
- Each tenant is reached at <schema_name>.<TENANT_BASE_DOMAIN> (its primary domain, created with it). Extra domains can be added in /django-admin/ on the root host (for example a nip.io name to reach the dev machine from a phone).
- The root host (TENANT_BASE_DOMAIN) is the public schema and uses its own URL conf (PUBLIC_SCHEMA_URLCONF): only /django-admin/. Any /api/ request there returns 404 {"detail": "There is no agency at this address.", "code": "no_tenant"}. An unknown host returns the same 404.
- A tenant with is_active false is suspended: every /api/ request on its hosts returns 403 {"detail": "This agency is not available at the moment.", "code": "tenant_suspended"}, its scheduled tasks are skipped, and its queued emails are not sent. Tenants are never deleted.
- schema_name: 3 to 30 lowercase letters, digits and hyphens, starting with a letter; reserved: public, www, api, admin, app-admin. Hyphens become underscores in the schema itself (django-tenants requires a valid schema name), but the domain keeps the hyphen.

Tenant isolation rules
- JWT access and refresh tokens carry a tenant claim (the schema_name). The authentication class rejects a token whose claim differs from the request's tenant with 401, so a token from one agency never works at another.
- Password reset and set-password links point at the tenant's primary domain (FRONTEND_URL with {domain}); a uid/token pair from one tenant is invalid at another.
- Boarding passes are stored under boarding_passes/<schema_name>/<booking uuid>/.
- Throttling stays per IP across all hosts (no change).
- Email links use the tenant's primary domain; email content is otherwise unchanged. Branding (the name "Azaria Bookings", colours, sender address) stays the same for every tenant; per-tenant branding is out of scope.

Celery
- Every task that touches tenant data takes schema_name as its first argument and runs inside schema_context(schema_name), after checking the tenant still exists and is active. The places that queue emails pass connection.schema_name. Email tasks otherwise keep their rules (IDs only, reload and re-check state).
- Beat keeps the same three schedules, each now a public-level task that runs the job in every active tenant's schema in turn; an error in one tenant is logged and does not stop the others.

The system owner (app_admin, public schema)
- System owner accounts are Django superusers in the public schema, created with python manage.py createsuperuser. They sign in to /django-admin/ on the root host. There is no app_admin screen in the Expo app (until step 26, see PLATFORM APP: AGENCIES).
- /django-admin/ on the root host lists tenants (name, schema, primary domain, active, created) with search and an active filter, lets the owner rename, suspend and reactivate a tenant and manage its domains, and has an "Add tenant" form: name, schema_name, and the first admin's full name, email and password.
- Adding a tenant, from that form or from python manage.py create_agency --schema --name --admin-email --admin-password --admin-name, goes through one function, tenants.services.create_agency: it validates the schema name, creates the Tenant (which creates and migrates its schema), the primary Domain, sets AppSettings.admin_notification_email to the first admin's email, and creates that admin (role admin) inside the new schema. If any part fails, nothing is left behind (no tenant row, no schema).
- /django-admin/ on a tenant host stays what it was: technical support for that tenant's data, superusers of that tenant's schema only (created with tenant_command createsuperuser --schema=<schema>).
- create_admin keeps working per tenant through tenant_command create_admin --schema=<schema>.

First tenant
- After the reset, Azaria itself is the first tenant: create_agency --schema azaria --name "Azaria Bookings" ..., reached at azaria.localhost in development and azaria.azariabookings.com in production. The root host stays platform-only.

Frontend
- The API base URL comes from EXPO_PUBLIC_API_URL, which may contain {host}, replaced by the page's hostname (development: http://{host}:8000/api), so the app at azaria.localhost:8081 talks to azaria.localhost:8000.
- When any API call returns code no_tenant or tenant_suspended, the app shows a full-page message with the server's detail instead of the screen (no navigation, no sign-in).
- Stored tokens are per origin already (each tenant host has its own browser storage), so no change is needed there.

Tests
- conftest.py creates one test tenant per test session and runs every existing test inside its schema, with requests made to its domain.
- New tests: data created in one tenant is invisible in another (offers, bookings, users with the same email); a token from tenant A gets 401 at tenant B; a reset link from A fails at B; the root host serves /django-admin/ and returns no_tenant for /api/; an unknown host returns no_tenant; a suspended tenant returns tenant_suspended and its beat jobs and emails are skipped; each beat task runs its job in every active tenant and survives an error in one; create_agency creates schema, domain, settings and admin, rejects bad or reserved names, and leaves nothing behind on failure; boarding pass paths include the schema.

README
- Local hosts (azaria.localhost works in Chrome and Firefox without setup; nip.io for other devices), migrate_schemas, seed_airports on public, createsuperuser for the system owner, create_agency for each tenant, and the database reset.

======================================================================
AIRLINES, LOGOS AND FLAGS (step 25)
======================================================================
Goal: offers name a real airline chosen from a shared list instead of typed text, the airline badge shows the airline's logo where the system owner has uploaded one, and airports show their country's flag. The airline list and the logos belong to the platform: only the system owner maintains them, in the platform's /django-admin/; every agency picks from the same list.

Model and data
- New shared app airlines (public schema, like airports): Airline with id (UUID), iata_code (2 characters, letters and digits, unique), icao_code (3 letters, blank allowed), name, country, is_active (default true), logo (file, blank allowed), updated_at.
- Offer.airline (CharField) is replaced by airline (FK Airline, PROTECT). There is no production data, so the migrations are regenerated and the local database is reset again (as in steps 18 and 22); README.md says so. Only an active airline can be chosen when an offer is created or its airline changed; existing offers keep an airline that is later deactivated.
- seed_airlines builds the list from backend/data/raw/airlines.dat (OpenFlights airline data, Open Database License; README.md credits it): keep rows marked active ("Y") whose IATA code is two letters or digits, take the country as given, and where several rows share an IATA code keep the one with an ICAO code (then the first). It creates airlines that are missing and never changes existing ones, so the system owner's corrections, deactivations and logos survive a re-run. The data is old (largely 2014 to 2017) and its active flag is unreliable, so the seed is a starting point and the system owner curates the list.

Logos
- Uploaded by the system owner per airline in the platform admin: PNG, JPEG or WebP (no SVG), at most 200 KB, the content checked against the type as for boarding passes. Replacing or removing a logo deletes the old file once the change is saved.
- Logos are public files, unlike boarding passes: a separate public storage rooted at PUBLIC_MEDIA_ROOT (backend/media/, added to .gitignore) and served under MEDIA_URL (/media/). In development Django serves /media/ on every host when DEBUG is true; in production the reverse proxy serves the folder (README.md says so). Stored names are random UUIDs plus the extension, under airline_logos/.
- No logos are bundled, downloaded or fetched from third parties.

Platform admin (root host)
- Airlines: list with a logo thumbnail, IATA and ICAO codes, name, country and active; search on codes and name; filter on active and on "has logo"; add, edit, deactivate and reactivate (never delete); logo upload, replace and remove on the edit form.

API
- GET /airlines?search= (admin only, like the other admin pickers): active airlines whose IATA or ICAO code matches exactly or whose name contains the text, exact code matches first, at most 20.
- Offers (public browse and detail, admin, query responses, and the offer nested in bookings) return airline as {id, iata_code, name, logo_url}, logo_url being an absolute URL on the request's host, or null without a logo. Admin create and edit, and new_offers in the respond and mark-unavailable bodies, take airline as the airline's id.

Frontend
- The airline badge (step 14: flight rows, offer detail, book form, trip cards, booking summary, admin tables and the Respond and Mark unavailable offer lists) shows the logo when there is one, and the initials otherwise or if the image fails to load. Both use the same frame, so a list mixing logos and initials looks even: a fixed square the size of today's badge, rounded corners, white background and a hairline border, the logo scaled down to fit without cropping or stretching, the initials in the tinted style inside the same square. The airline's name stays next to it as text.
- The offer form (and custom offers on Respond and Mark unavailable) replaces the airline text field with an airline picker: search as you type (from two characters), each result with its badge, IATA code and name; the chosen airline shows with a Change link, like the airport picker. The airline is required.
- Emails keep showing the airline's name as text (no images).

Country flags
- Airport gets country_code (ISO 3166-1 alpha-2, e.g. "KE"), filled by seed_airports from the iso_country column it already reads; re-running seed_airports fills it for existing airports (it updates rows in place). The airport API (search results and every nested airport object) returns country_code.
- frontend/public/flags/ holds the 4x3 SVG flags of the flag-icons project (MIT licence, credited in README.md and with its licence file kept next to the flags), copied in once as files (flag-icons itself is not a dependency). A Flag component shows the flag for a country code (small, rounded corners, a hairline border so white flags stay visible), and nothing when the code is empty or unknown; no emoji flags anywhere. It is split by platform: on web (Flag.web.tsx) an image of /flags/<code>.svg, which the web app serves from public/, so only the flags on screen are downloaded; on native (Flag.native.tsx) the same files bundled into the app and drawn with react-native-svg, through a map from code to file. New dependencies for this: react-native-svg, and react-native-svg-transformer as a dev dependency configured in metro.config.js so the SVG files can be imported on native.
- Flags appear only where the user is choosing or reading about a place: the airport picker and search-field suggestions (before each result) and the chosen airport, the offer detail header (beside "City, Country"), and the stop list. They do not appear on the compact route line (flight rows, trip cards, booking summaries, the book form), in the request criteria, or in admin tables, so dense rows stay uncluttered. Flags are small (about 16 x 12 px), never larger than the text beside them, and decoration only: the country name or city stays as text, and the flag is hidden from screen readers.
- Emails show no flags.

Tests
- seed_airports storing country_code; the airport API returning it;
- (browser check) flight rows and trip cards at 390 px show no flags and keep their layout; a list mixing airlines with and without logos shows badges of one size;
- seed_airlines filtering, duplicate codes, idempotence and leaving curated rows alone; offer create and edit by airline id, refusing an inactive or unknown airline; the API shape with and without a logo (absolute URL on the request's host); the airline search; logo upload rules (type, content, size) and file deletion on replace and remove; the platform admin listing airlines and tenant hosts not exposing them.

======================================================================
PLATFORM APP: AGENCIES (step 26)
======================================================================
Goal: the system owner manages agencies (tenants) in the Expo web app on the root host instead of only in /django-admin/. Same look as the agency admin (theme, top bar, tables, detail drawer, confirm dialogs). /django-admin/ on the root host keeps working unchanged as the technical fallback; airlines and logos stay there.

Who signs in
- Only active superusers of the public schema (the same system owner accounts as /django-admin/). Anyone else gets 401 {"detail": "No platform account found with the given credentials."}.
- Tokens are issued on the root host and so carry tenant "public"; the existing tenant check already refuses them at every agency and refuses agency tokens here.
- No registration and no password reset on the platform; owners use createsuperuser and changepassword.

API (root host only, added to PUBLIC_SCHEMA_URLCONF; every other /api/ path there still returns no_tenant)
- POST /api/platform/login, POST /api/platform/refresh, GET /api/platform/me (id, email, full_name).
- All endpoints below require a platform superuser (IsPlatformOwner).
- GET /api/platform/tenants?search=&is_active=: paginated like the other lists; search on name, schema name and domains; each row: id, name, slug (schema name with hyphens, as typed), primary_domain, is_active, created_at. The public schema's row is never listed.
- POST /api/platform/tenants: name, slug, admin_name, admin_email, admin_password; goes through tenants.services.create_agency; field errors come back under the same names.
- GET /api/platform/tenants/<id>: the row plus domains [{id, domain, is_primary}].
- PATCH /api/platform/tenants/<id>: name and/or is_active (suspend and reactivate). Tenants are never deleted.
- POST /api/platform/tenants/<id>/domains {domain}: adds a non-primary domain (a valid hostname not used by any tenant). DELETE /api/platform/tenants/<id>/domains/<domain_id> removes it; the primary domain cannot be removed (409). POST .../domains/<domain_id>/make-primary moves the primary flag to it.

Frontend
- New setting EXPO_PUBLIC_PLATFORM_HOST (development: localhost). When the web app's hostname equals it, the app shows the platform instead of an agency: its own sign-in screen and its own screens; the agency screens are not reachable there, and the no_tenant page is not shown. The platform is web only.
- Top bar: Agencies, and Sign out.
- Agencies: table (name, address, status chip Active/Suspended, created), search box, active filter, "New agency" button. A row opens the detail drawer.
- Detail drawer, in sections so later sections (plans and billing, step 27) slot in: Agency (name with an Edit action, address, created, status with a Suspend or Reactivate button behind a confirm dialog), Domains (list with the primary marked, Make primary and Remove on the others, an add field).
- New agency form: name, address (with the live hint "<address>.<base domain>"), first admin's full name, email and password; server field errors shown on their fields.

Tests
- Platform login: superuser ok; non-superuser, inactive user and agency users refused; a platform token refused at an agency and an agency token refused on the root host; agency hosts have no /api/platform/.
- Tenant list, search, filter, public row hidden; create through create_agency (errors mapped to fields, nothing left behind on failure); rename; suspend and reactivate (the agency then answers tenant_suspended or works again); domain add, duplicate refused, remove, primary not removable, make-primary.
- Browser check at 390 px and 1280 px: sign in, create an agency, open it at its address, suspend it, see the suspended page there, reactivate.

======================================================================
PLANS, INVOICES AND SUSPENSION FOR NON-PAYMENT (step 27)
======================================================================
Goal: agencies pay the platform for a plan. Payment happens outside the system; the platform issues invoices, the system owner marks them paid, and agencies whose invoices stay unpaid are suspended. Everything here lives in the public schema (shared app tenants) and is managed in the platform app.

Settings
- PLATFORM_CURRENCY in .env (e.g. KES). Every plan and invoice uses it; amounts are decimals with 2 places.
- PlatformSettings (singleton, pk=1, created by a data migration in public): issuer_details (the platform's name and address as printed on invoices), payment_instructions (printed on invoices and in invoice emails), invoice_due_days (default 14), invoice_lead_days (default 7), billing_contact_email (shown to agencies). Edited on the platform Settings screen.

Models
- Plan: id (UUID), name, kind (subscription or support), description (blank allowed), monthly_price and annual_price (each nullable; at least one set), is_active (default true), created_at. The owner creates and edits plans as needed; plans are deactivated, never deleted. An inactive plan cannot be chosen for a new or changed subscription; existing subscriptions keep it.
- Tenant gains billing_email (used for invoices; required before a subscription can start), suspension_reason (blank, manual or non_payment) and suspended_at. Suspending from the platform sets manual; the overdue job sets non_payment; reactivating clears both.
- Subscription: id (UUID), tenant, plan, billing_cycle (monthly or annual; the plan must have that price), started_on (date), next_period_start (date), ended_on (date, null while running), created_at. An agency has at most one running subscription per plan kind (so one subscription plan and at most one support plan, each on its own cycle). Changing the plan or cycle edits the running subscription and applies from the next invoice issued; invoices already issued are unchanged (no proration). Ending a subscription sets ended_on; no further invoices are issued.
- Invoice: id (UUID), number (INV-<year>-<4-digit sequence per year>, unique), tenant, subscription, plan_name, billing_cycle, period_start, period_end, amount (all copied at issue, so later plan edits never change it), issued_on, due_on (issued_on + invoice_due_days), status (unpaid, paid or void), paid_on (date, set when marked paid), suspension_waived (default false), pdf (private file, like boarding passes, under invoices/<schema_name>/), created_at. One invoice covers one subscription for one period. A paid invoice means the agency is in good standing for that period.

Issuing
- issue_invoice(subscription) in tenants/billing.py: creates the invoice for next_period_start to the day before next_period_start + one month or one year, advances next_period_start, renders the PDF and queues the invoice email on commit. Starting a subscription issues its first invoice at once for the period starting on started_on.
- Beat, daily: issue_due_invoices issues the next invoice for every running subscription whose next_period_start - invoice_lead_days <= today (one per subscription per run, so a missed day catches up the next).
- The owner can also issue the next invoice of a subscription early ("Issue next invoice"), resend an invoice email, void an unpaid invoice, mark an unpaid invoice paid (paid_on today unless another date is given) and mark a paid invoice unpaid again (to correct a mistake).

Suspension and reactivation
- Beat, daily: suspend_overdue_tenants suspends (is_active false, reason non_payment) every active tenant with an unpaid, not waived invoice whose due_on + one month < today, and queues the suspension email. An error for one tenant is logged and does not stop the others.
- Marking an invoice paid reactivates a tenant suspended for non_payment when it has no other unpaid, not waived invoice past that limit. Manual suspensions are never lifted automatically.
- The owner may reactivate a tenant suspended for non_payment while its invoices are unpaid: every unpaid invoice past the limit gets suspension_waived true, so the job does not suspend it again for them. A later invoice that goes past the limit suspends it again.
- A tenant suspended for non_payment answers tenant_suspended with detail "This agency's account is suspended for non-payment. Contact <billing_contact_email>." Manual suspensions keep the existing message.

Invoice PDF and emails (public-level tasks, IDs only, same retry and re-check rules as the other email tasks, HTML plus plain text in the app's theme)
- PDF: issuer_details, agency name and billing_email, number, issued and due dates, plan, cycle, period, amount with currency, payment instructions, status. Generated with fpdf2 (the only new dependency; pure Python, no system libraries).
- 11. send_invoice(invoice_id) -> tenant billing_email, PDF attached: number, period, amount, due date, payment instructions. Runs only if the invoice is unpaid.
- 12. notify_tenant_suspended_non_payment(tenant_id) -> tenant billing_email: the overdue invoice numbers and amounts, how to pay, and that access returns once payment is recorded. Runs only if the tenant is still suspended for non_payment.

Platform API (root host, IsPlatformOwner)
- /api/platform/plans: list (kind and is_active filters), create, edit (PATCH, including is_active). No delete.
- /api/platform/tenants/<id>: also returns and accepts billing_email; returns suspension_reason and suspended_at.
- /api/platform/tenants/<id>/subscriptions: list, create {plan, billing_cycle, started_on}; /api/platform/subscriptions/<id>: PATCH {plan, billing_cycle}, POST .../end, POST .../issue-invoice.
- /api/platform/invoices?tenant=&status=&overdue=: paginated, newest first; /api/platform/invoices/<id>: detail; POST .../mark-paid {paid_on?}, .../mark-unpaid, .../void, .../resend; GET .../pdf (download).
- /api/platform/settings: GET and PATCH.

Agency API (tenant host, IsAdminRole, read-only)
- GET /api/admin/billing: the agency's running subscriptions (plan name, kind, cycle, price, next_period_start), billing_contact_email, and an overdue notice when an unpaid, not waived invoice is past due_on: {invoice number, amount, due_on, suspends_on (due_on + one month)}.
- GET /api/admin/billing/invoices: paginated, newest first (number, period, amount, due_on, status, paid_on); GET /api/admin/billing/invoices/<id>/pdf.

Frontend
- Platform top bar: Agencies, Plans, Invoices, Settings, Sign out.
- Plans: table with kind tabs (Subscription, Support), name, monthly and annual price, active; create and edit form; deactivate toggle.
- Agency drawer gains a "Plan & billing" section: billing email (editable), the running subscription and support plan (plan, cycle, price, next invoice date) with Start, Change, End and Issue next invoice actions, and the agency's invoices; the status shows "Suspended for non-payment" when that is the reason.
- Invoices: table (number, agency, period, amount, due, status chip Unpaid / Overdue / Paid / Void) with status and overdue filters; the drawer shows the invoice with Open PDF (Download PDF before step 28), Mark paid (date field, default today), Mark unpaid, Void and Resend, each behind a confirm dialog.
- Settings: the PlatformSettings fields.
- Agency app, admins only: a Billing screen (Settings area) with the plans, the invoices with Open PDF (Download PDF before step 28), and the billing contact; and, on every admin screen, a warning banner while the overdue notice is present: "Invoice <number> is overdue. This agency will be suspended on <suspends_on> unless payment is received."

Tests
- Plans: price rules, inactive plans refused for new or changed subscriptions, no delete.
- Subscriptions: one running per kind, billing_email required, the first invoice at start, plan changes applying only to later invoices, end stops invoicing.
- Issuing: periods for monthly and annual (month ends, leap years), lead days, catching up a missed day, numbering per year, amounts copied, PDF stored under the tenant's folder, email 11 sent with the PDF and skipped once paid or void.
- Suspension: suspended only past due_on + one month, not for paid, void or waived invoices, inactive tenants skipped, one tenant's error not stopping others, email 12; marking paid reactivates only non_payment suspensions with nothing else overdue; owner reactivation waives and a later overdue invoice suspends again; the non-payment message.
- Permissions: platform endpoints for platform owners only; agency billing endpoints for that agency's admins only, never another agency's invoices.
- Browser check at 390 px and 1280 px: create plans, start a subscription, see the invoice and its PDF, mark it paid; with frozen dates, an overdue banner at the agency, suspension, owner reactivation.

======================================================================
PLATFORM HOME PAGE AND DASHBOARD (step 29)
======================================================================
Goal: the root host opens on a short public introduction to the system, and the system owner lands on a dashboard of agencies, revenue and what needs attention.

Root host home page
- / on the root host is a short public introduction to the system for travel agencies, whether or not the owner is signed in: a headline and one or two sentences on what Azaria Bookings is (a booking platform where each travel agency gets its own site to publish flight deals, answer customers' requests, take bookings and send boarding passes), three short points (own address and data per agency; deals, requests and bookings in one place; boarding passes by email and in the app), and two links: "See pricing" (/pricing) and "Admin sign in" (/login; "Open admin" when the owner is already signed in, going to the Dashboard).
- The root host's pages share a slim public bar: the brand (linking to /), Pricing, and Admin sign in (or Open admin).
- The owner's sign-in moves to /login and Agencies to /agencies; / no longer opens Agencies.
- Until step 30 adds the pricing page, "See pricing" and Pricing are left out.

Platform dashboard
- The owner's home after signing in: /dashboard, first in the platform's top bar (Dashboard, Agencies, Plans, Invoices, Settings).
- GET /api/platform/dashboard (IsPlatformOwner), all amounts in PLATFORM_CURRENCY, "this month" and "this year" in Nairobi time:
  - agencies: total, active, suspended (manual) and suspended for non-payment, and how many have no running subscription plan.
  - revenue: paid invoices summed by paid_on, for this month, this year and all time.
  - recurring: the monthly value of all running subscriptions (a monthly price as is, an annual price divided by 12), and the count of running subscription and support plans.
  - outstanding: unpaid invoices (count and total), and of those the overdue ones (count and total).
  - revenue_by_month: paid totals for each of the last 12 months, oldest first, months without payments as 0.
  - plans: for each plan with running subscriptions, its name, kind and how many agencies are on it, most first.
  - attention: up to 5 overdue invoices, oldest due first (number, agency, amount, due_on, suspends_on or null when waived).
- Screen: a row of summary cards (Agencies, Revenue this month, Monthly recurring, Outstanding, Overdue), each linking to the matching list (Agencies with the Suspended filter for the suspended count, Invoices with the Unpaid or Overdue filter); a simple bar chart of revenue_by_month drawn with plain views (no chart library), each bar labelled with its month and showing its amount on hover or press; "Agencies per plan"; and "Needs attention" with the overdue invoices, each opening the invoice. Empty states when there are no agencies or invoices yet.

Tests
- Dashboard: each figure against known data (revenue by paid_on across month and year boundaries, annual prices counted as a twelfth, void and unpaid invoices left out of revenue, waived invoices with suspends_on null), months without payments as 0, platform owners only.
- / and /login on the root host open without signing in; /dashboard needs the owner's sign-in.
- Browser check at 390 px and 1280 px: the root host's home page signed out and signed in (its links), signing in landing on the dashboard, each summary card's link, the chart, Agencies per plan and Needs attention, and the empty states.

======================================================================
PLANS PAGE AND RICH DESCRIPTIONS (step 30)
======================================================================
Goal: plans are presented like a pricing page (three featured cards, one highlighted, with every other plan one click away), to prospective agencies on a public page and to agencies' admins in their app, and plan descriptions are written in a rich text editor. Layout patterns only, after pricing pages such as Google One's: no copied branding, imagery or wording.

Model
- Plan gains tag: blank, recommended, basic or advanced (default blank). Only subscription plans can be tagged, and each tag is held by at most one plan (a database constraint on non-blank tags). Deactivating a plan clears its tag.
- Plan.description becomes rich text, stored as sanitized HTML (at most 5,000 characters after sanitizing). The server keeps only p, br, strong, em, u, s, h3, h4, ul, ol, li and a (href with http, https or mailto only; rel="noopener noreferrer" and target="_blank" added); everything else is stripped, with nh3 (the only new backend dependency). A data migration turns existing plain-text descriptions into escaped paragraphs.

API
- Platform: plans accept and return tag; giving a tag held by another plan is refused on the tag field ("Already used by <plan name>."), as is tagging a support plan.
- GET /api/platform/public-plans on the root host, open without signing in: the active plans (id, name, kind, tag, description, monthly_price, annual_price, currency), plus billing_contact_email.
- GET /api/admin/plans on an agency host (IsAdminRole): the same list, plus the ids of the agency's running plans (current_plan_ids) and billing_contact_email.

Plans page (one shared PlanShowcase component, used by both pages below)
- A Monthly / Annual switch on top (Monthly first). Annual shows the yearly price and, when the plan has both prices, the saving against twelve monthly payments ("Save 17%"). A plan without a price on the chosen cycle shows "Annual only" or "Monthly only" in place of the price.
- The featured grid: the subscription plans tagged recommended, basic and advanced, always in that order (Recommended first, Basic second, Advanced third), each with its tag as a chip. Three cards side by side on wide screens, stacked in the same order on narrow ones. The Recommended card stands out (brand-coloured border and chip, slightly raised). A missing tag leaves its place out; with no tagged plans, all plans show and there is no "Show all plans".
- Each card: tag chip, plan name, price for the chosen cycle, the rich description, and one action button.
- "Show all plans" under the grid reveals every other active subscription plan as cards in the same style, cheapest first (by monthly price, else annual), and turns into "Show fewer".
- Support plans: a separate "Add support" section below, cheapest first, in a smaller card style.
- Payment is outside the system, so actions are mailto links to billing_contact_email with the plan in the subject: "Get started" on the public page, "Ask to switch" in the agency app. The agency's running plans show "Your plan" instead of a button. Without a billing contact email the buttons are left out.

Where it shows
- Public: http://<root host>/pricing (e.g. localhost:8081/pricing), open without signing in. The rest of the platform still needs the owner's sign-in.
- The root host's home page gains its "See pricing" link and the public bar its Pricing item (see step 29).
- Agency app: a Plans page for admins (admin/plans), opened from the Billing screen ("Compare plans").
- Platform Plans screen: a "View pricing page" link that opens /pricing in a new tab, and a Tag column.

Rich text
- Editor: TipTap on web (@tiptap/react, @tiptap/pm and @tiptap/starter-kit, the new frontend dependencies) with a toolbar for bold, italic, underline, strike, headings (two sizes), bullet and numbered lists, link and undo/redo, in an editing area at least 200 px tall that grows with its content. It replaces the description field in the plan dialog, which is widened for it. On native the field is a multiline text box (descriptions are edited on the web).
- Display: a RichText component renders the sanitized HTML on web with the app's typography (lists indented, links in the brand colour); on native it shows the text without tags.

Tests
- Sanitizing: allowed tags kept, scripts, styles, event attributes and javascript: links removed, rel and target added to links, the length limit; the migration of plain text.
- Tags: one plan per tag, support plans refused, deactivating clears the tag, the error names the plan holding it.
- public-plans open without signing in on the root host, only active plans, and absent on agency hosts; admin/plans for that agency's admins only, with its current plan ids.
- Browser check at 390 px and 1280 px: the grid order Recommended, Basic, Advanced, the Monthly/Annual switch, Show all plans and Show fewer, the support section, "Your plan" in the agency app, the public page signed out, and the editor's toolbar saving formatted text that then shows on the cards.

======================================================================
DELIVERY ORDER (commit after each step; the app must run at each step)
======================================================================
1. Backend foundation: settings from .env, DRF/JWT/CORS/Celery wiring, accounts app with register, login, refresh, me, password reset and email task 10, create_admin, core AppSettings and migration, catalog.Airport and seed_airports, /django-admin/ mount, private storage setup, migrate and tests passing.
2. Offer model, admin offer endpoints, public offer list with filters, tests. Frontend: API client, storage module, auth screens (login, register, forgot and reset password), auth gate, role routing, admin Offers screens.
3. Guest-accessible Explore and offer detail screens.
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
9. Look and layout: theme colours (see LOOK AND LAYOUT).
10. Look and layout: top bar navigation.
11. Look and layout: detail drawer for list screens.
12. HTML emails (see HTML EMAILS).
13. UI refinement: shared building blocks (see UI REFINEMENT).
14. UI refinement: Explore and offer detail.
15. UI refinement: customer requests and bookings.
16. UI refinement: admin screens.
17. Admin booking progress tracker and dialogs (see ADMIN AND BOOKING ADDITIONS).
18. UUID identifiers (see UUID IDENTIFIERS). Only after steps 9 to 17 are done.
19. Stops: layovers and stopovers.
20. Confirm availability with changes.
21. Mark unavailable with suggested options.
22. Multitenancy (see MULTITENANCY).
23. User management.
24. Admin books for a customer.
25. Airlines, logos and flags (see AIRLINES, LOGOS AND FLAGS).
26. Platform app: agencies (see PLATFORM APP: AGENCIES).
27. Plans, invoices and suspension for non-payment (see PLANS, INVOICES AND SUSPENSION FOR NON-PAYMENT).
28. Preview first: boarding passes and invoice PDFs open in a new tab instead of downloading (see FRONTEND). Browser check: a PDF and a PNG boarding pass and an invoice open in a new tab showing the right file.
29. Platform home page and dashboard (see PLATFORM HOME PAGE AND DASHBOARD).
30. Plans page and rich descriptions (see PLANS PAGE AND RICH DESCRIPTIONS).

Finish each step before starting the next. At the end, run the full test suite and do a manual browser walkthrough of the entire flow as guest and as customer (browse as a guest -> no result -> sign up -> query -> admin responds -> book -> confirm -> pay -> upload pass -> send -> customer opens them, plus an expiry case and a password reset) and report any deviations from this spec.