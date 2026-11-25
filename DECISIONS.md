# Decisions

Choices made where [SPEC.md](SPEC.md) is ambiguous or silent, one line each.

## Accounts and auth
- Emails are stored lowercased and matched case-insensitively for login, registration and password reset.
- Registration requires `phone`; the model allows it blank because `create_admin` and admin-created customers don't need one.
- Logout is client-side only (tokens discarded); no JWT blacklist.
- Throttles use Django's local-memory cache (per process); password-reset request and confirm share one limit. The client IP is REMOTE_ADDR unless `NUM_PROXIES` says how many X-Forwarded-For hops to trust.
- Auth screens are guest-only; a signed-in user opening them lands on home. To use a reset link, sign out first.
- Signing out lands on the area's `/login`; so does an admin's or the owner's session ending. A customer whose session ends stays on the page. The next sign-in opens the area's home.
- On start-up the app clears stored tokens only on a 401, not when the server is unreachable or the agency suspended.
- Signed-in-only links opened while signed out (e.g. from emails) go through the sign-in gate and open afterwards.

## Offers, airports and airlines
- `GET /api/airports` with an empty search returns an empty list. Airport text filters match the code exactly (any case) and city, country and name by "contains".
- Segment airports are written by IATA code (any case) and airlines by id; airports are returned as nested objects `{id, code, name, city, country, country_code}`. Flight times are sent and returned as `HH:MM`.
- `valid_until >= today` is enforced on create only; edits re-check the other rules.
- Offer detail returns any active public offer with an `is_bookable` flag; only browse is limited to bookable offers. A customer can also open any offer they have booked.
- The admin offer list includes private, deactivated and lapsed offers, filterable by `is_active` and `is_public`.
- Segment positions start at 1 within each direction in list order; an edit without a `segments` key keeps them, and they are rechecked against a changed trip type.
- An operating airline equal to the marketing one is stored as none (not a codeshare).
- Baggage weights are whole kilograms of at least 1; a checked bag weight without checked bags is refused.
- `itinerary.outbound` is always present; `itinerary.return` is null without return flights.
- Durations read "2 h 15 min", "45 min" or "26 h" (no days); emails list each direction's flights one per line, with the connection between them and "+1" for a later arrival day.
- `seed_airlines` drops rows with an empty name; an ICAO code that isn't three letters is left blank.
- The airline search lives on agency hosts for the admin's picker; the list itself is edited only in the platform's Django admin.

## Requests
- The `requests` app lives in the `customer_requests` package (label `requests`) so it doesn't shadow the PyPI `requests` library.
- Closing an already closed query, or responding to a closed one, returns 409; open and responded queries can be closed.
- A response's `offer_ids` must be currently bookable.
- A request's return date needs trip type return and is on or after `date_from`.

## Bookings
- An offer that isn't bookable or visible returns 400 on `offer`; a second active booking of it returns 409.
- A booking's optional `query` must be the customer's own. `POST /bookings` is customers only; the admin books through `POST /admin/bookings`, and the duplicate message then names the customer.
- A move by the wrong actor returns 409 like any invalid move; confirm-availability and mark-unavailable return 409 for impossible moves before validating their body.
- Marking paid exactly at the deadline is allowed. Scheduled expiry re-checks the status under the lock.
- Customer booking detail includes `payment_instructions` only while `availability_confirmed`, and no `boarding_passes` key until completed.
- The timeline shows statuses and times, not the actor.
- Stale requests get the same "booking expired" email as lapsed payment holds. The reminder is skipped if the booking is no longer awaiting payment or the deadline has passed.
- Payment hold and reminder hours must be at least 1; settings accept GET and PATCH only.
- Confirm availability always sends the dialog's price and segments; the server records only values that differ. New segments keep the booking's trip type and route (its origin and destination), and the booking's return date follows them. Accepting changes is not a status change and adds no timeline event. The payment deadline runs from confirmation, including while changes await acceptance.
- Mark unavailable sends the message only together with suggested options. Its offer search starts from the booking's route, dates and trip type, any class.
- Bookings return their own trip type, return date, baggage, fare conditions and itinerary next to the nested offer.
- In the support Django admin, booking status, deadline, reminder and changes are read-only.

## Boarding passes and files
- Uploads must agree on extension, declared content type and leading bytes (`core/files.py`, shared with chat attachments). Wrong type, oversize or an 11th file returns 400 on `file`; outside `paid` returns 409.
- The admin may pick several files at once; the app uploads them one per request. A deleted pass's file is removed once the delete commits.
- Preview first decides by file extension (pdf, png, jpg, jpeg, webp, gif) so the tab opens during the click (later tabs are blocked as pop-ups). The tab shows a blob: URL, so its title is the browser's.

## Agencies and tenancy
- The platform and each agency have separate Django admin sites; tenants and shared airports are only on the platform's.
- `create_agency` runs in one transaction; PostgreSQL rolls back the new schema on failure. Addresses matching an existing schema (e.g. `information-schema`) are refused.
- The platform's own tenant row (schema `public`) and its domain are created by a data migration and hidden from tenant lists.
- Tenant tasks take the schema name first; beat tasks return the total across agencies.
- A host outside ALLOWED_HOSTS gets Django's plain 404; allowed hosts without an agency get the `no_tenant` JSON.
- Domains equal to the root host or used by any agency are refused; reaching a new hostname still needs ALLOWED_HOSTS and CORS.
- Settings singletons are fetched with `objects.get()`; their data migrations create the row only when missing.
- Tests: the session's agency uses the test client's default host (`testserver`); a second agency (`other.localhost`) backs isolation tests. One test fails on any model without a UUID primary key.

## Billing
- Subscription stores its plan's kind so "one running plan per kind" is a DB constraint; a plan's kind can't change.
- Periods keep the start day of month, clamped to shorter months (31 Jan → 28 Feb → 31 Mar).
- "More than a month past due" means `due_on` + one calendar month < today.
- Voiding an invoice lifts a non-payment suspension like marking it paid does. The overdue notice shows the oldest unpaid, unwaived invoice past due.
- The invoice PDF is re-rendered (old file deleted) on every status change. It uses fpdf2's Helvetica: Latin-1 only, other characters print as "?".
- A plan price can't be cleared while a running subscription pays on that cycle.
- Plans, invoices and subscriptions return the currency so the app can format amounts.
- Suspending and reactivating in `/django-admin/` use the same `billing.set_active` as the platform app.
- An inactive plan never holds a tag. `public-plans` ignores any Authorization header.

## Support chat
- `Conversation.requester` is a plain UUID because on the platform desk it names a user in an agency's schema; `Conversation.agency` has no DB constraint because the table exists in every schema.
- Requesters list and create through `support/chats`; only POST is open to guests (throttled). The desk can't start chats with itself (403).
- Replies keep the chat's own subject and email. The desk list puts unread first, then most recent.
- The floating panel lists only open chats and points to Account > Support for closed ones.
- Agency admins' platform chats go through their own host (`support/platform-chats`); reply emails link to `/admin/support/<id>` on the agency's domain.
- With `PlatformSettings.support_email` blank no desk email is sent; the Settings screen warns.
- Plan enquiries open the floating panel on the pricing page and a dialog in the agency app, after which the admin lands on the chat in Settings > Support.

## App layout and navigation
- On phones the admin bar keeps Dashboard, Offers, Requests and Bookings, and the platform bar Dashboard, Agencies, Invoices and Chats; the rest are under More, which shows their unread counts added up and stays highlighted on any of them.
- React Navigation, not Expo Router.
- The selected item is a route parameter of its list (e.g. `/bookings/<id>`), so the list stays mounted; Explore's URL is `/offers` (`/` also opens it). Opening a detail replaces the history entry.
- Offer detail opens in Explore's drawer, including from a request's response; its price summary is sticky on the right when the detail is ≥ 640 px wide.
- Lists show tables only on wide screens with no detail open; otherwise cards. Explore switches to its narrow layout while a detail is open.
- Explore's From/To send the airport code when picked, otherwise the typed text. Filter chips apply at once, prices on Enter or blur, the search bar on Search; "Clear all" clears the sidebar only.
- The trip type and return dates sit in the search bar; return dates are sent only with Return. Request options takes "Returning from" as the request's return date.
- Every page has the top bar: form pages (New offer, Respond, Request options, Book) and Billing/Plans are hidden tabs with their parent tab highlighted, a back link, and a fresh form on each visit.
- Auth screens show the brand bar without Sign in / Create account.
- Ended bookings show the status banner only, no chip. Booking status filters wrap to a second row.
- "Send boarding passes" sits in the action bar, disabled until a file is uploaded and while uploads run. The request drawer's Respond button is its action bar.
- The admin drawer keeps the changes card after the customer answers.
- The Users list is ordered by name, with search only (the `is_active` filter has no UI). New user, New booking and other forms use large dialogs; dialogs show save errors above the footer buttons, and content with its own buttons has no footer bar.
- The New booking dialog shows up to six customers; its offer search lists active offers with unbookable ones disabled. After saving, Bookings switches to Requested.
- Paged lists return to page 1 when the filter changes or the page no longer exists. Platform Agencies and Invoices keep their status filter in the URL.
- The platform app assigns the signed-in account the role "owner" client-side. Platform sign-out returns to the public home; platform pages opened signed out go to `/login`.
- Admin-address redirects (`admin.<root host>`, `/admin`) happen in the web app before it starts (`config.ts`).
- Dashboard: owner-suspended agencies count as "suspended", the other inactive ones as "for non-payment"; cards link to the matching filtered lists.
- Emails' highlighted box is a light indigo tint with an indigo left edge; shared pieces are includes under `emails/`.

## Frontend libraries
- The web Flag component is `Flag.tsx` (Metro picks `Flag.native.tsx` on native); `flagCodes.ts` and `flags.native.ts` are generated from `public/flags/`.
- `@expo/metro-config` is a dev dependency so react-native-svg-transformer can find Expo's Babel transformer.
- The airline badge is a rounded square for logos and initials alike.
- TipTap: link and underline come with the starter kit. The H1/H2 buttons produce h3/h4; links use the browser prompt; toolbar buttons cancel mousedown to keep focus in the text.
- Web form elements (select, date input, rich text) use `WEB_SYSTEM_FONT` from `theme.ts`.

## GDS search
- Duffel is the first provider (free test mode); booking and ticketing stay manual in the agent's own GDS.
- Fares found are reviewed before publishing by default; auto-publish is an opt-in per route.
- The monthly search allowance is a per-agency number (default 1500) edited by the platform owner, not tied to plans.
- Provider fares are stored and shown to admins in their original currency, converted to USD (rate and date stored) for picking, markup and comparison; customers see USD offers only.
- Exchange rates come from a daily feed (ExchangeRate-API by default) with manual override on the platform.
- All valid search results are kept 30 days for comparison; published ones are kept.
- Technical stops inside a flight are not recorded.
- Pick rule: `pick_cheapest` picks the `max_per_date` cheapest fares of each date; `pick_cheapest_direct` adds the cheapest direct one on top of that limit; at least one of the two is on.
- A route's airlines filter on the ticketing airline.
- "Earlier new fares replaced": a run un-picks the earlier runs' new fares for the dates it searched; they stay stored for the price history.
- A run's `searches_made` holds its planned count from the moment it is queued (the tenant row is locked while checking), so two quick starts cannot both fit in what is left; it ends as the searches actually made.
- A result whose trip type differs from the route, or that does not start and end at the route's airports, is skipped like any other broken itinerary.
- Provider errors and skipped results are recorded once per distinct message, with "(n×)" when repeated.
- A fare's departure date is read from its itinerary's first segment; no extra column.
- `admin/fares` needs `route`; dismissed fares are listed only with `status=dismissed`. Integrations are listed unpaginated.
- Only new fares can be published or dismissed (409 otherwise; published ones cannot be dismissed). Publishing over an active offer with the same fare_key changes only its price, net and conversion fields and price_checked_at; price_checked_at is the run's end.
- Changing an integration's credentials clears its last test result; a failed test is a 200 with `last_test_ok` false.
- Net amounts are stored with 3 decimals (some currencies have 3).
- Duffel: mode is a label (the token decides test or live; one URL). "Any" connections sends no `max_connections` (Duffel's default of one connection applies).
- Duffel: checked bags are the fewest included on any flight (first passenger); carry-on bags have no count field here, and weights are null as Duffel's offer gives none.
- Duffel: a missing refund or change condition is not allowed; allowed with a zero penalty is free; otherwise (including an unstated penalty) with a fee.
- Duffel: a non-empty `private_fares` is a private fare, an empty one public, a missing one unknown; seats left are always null (Duffel does not give them).
- Exchange rates: the feed's rates are stored under the Nairobi date of the fetch; a failed feed stores nothing and the task errors. The platform screen lists every currency with a stored rate.
- A scheduled run that cannot start (over the allowance, window passed, no date on the weekdays, no active integration) is a SearchRun with status `skipped`, no searches and the reason in its errors; Search now refuses the same cases with 409.
- Only scheduled runs (skipped ones included) count as a route's run for the day or week, so a skip is recorded once and a manual search does not replace the scheduled one. Weeks run Monday to Sunday in Nairobi time.
- A rolling window counts from the Nairobi date the run starts, both ends included, with M − N ≤ 60 as written; a fixed window keeps Search now's 60 dates and is searched without its past days. New routes default to 1 to 30 days ahead.
- "Edited since publishing" is the offer's `price_edited` flag: set when the admin's offer form saves a different price on a GDS offer, cleared when a fare is published onto it.
- Refresh judges an offer "not found" only on departure dates at least one search answered for (a failed run refreshes nothing); a matching fare without a rate counts as found but changes no figures; `missing_since` keeps the first search that missed it.
- Refresh runs before auto-publish; a fare auto-publish cannot publish is noted in the run's errors.
- The platform dashboard lists only agencies with searches this month, most first. The Fares screen opens on the latest run that was not skipped.
- A booking re-check is a SearchRun of the offer's route with trigger `recheck` (one search, no fares stored); it shows in the route's recent runs but never as a Fares screen run, and counts even when the provider fails.
- Re-check refusals are 409 (manual booking, status not requested, disabled integration, no search left); a provider error is 502 with the provider's message.
- A re-check searches the booking's first departure date, return date, route and the offer's cabin, with max connections set to the booking's own (busier direction) so its flights can be found.
- Re-check prices use today's rate and the offer's route's markup as it is now, even if the route was changed or deactivated (routes are never deleted).
- Not found returns the 3 cheapest other fares in the booking's cabin with a rate, one per fare_key; a found fare without a rate fills only the flights.
- Choosing a re-check alternative changes only price, ticketing airline and flights through confirm availability; the booking keeps its baggage and fare conditions.
- Travelport: EMEA gateways (pre-production for test mode, production for live), Air schema v52 and the Galileo (1G) host; one adult (ADT), a leg per direction with the cabin as a permitted cabin and `MaxConnections` only when set, and `SolutionResult` true so each priced solution is one itinerary.
- Travelport: test connection is a System service ping with the target branch (it searches nothing and counts against no allowance).
- Travelport: journeys are the directions; checked bags are the fewest pieces of the solution's fare components (a weight allowance alone counts as one bag), with the weight only when every component states kilograms; cabin bag weight is not read (free text only).
- Travelport: refund or change is not allowed unless the pricing says Refundable or Exchangeable; then a zero penalty is free and any other (or none stated) a fee. A private or negotiated fare component makes the fare private, otherwise public.
- Travelport: seats left are the fewest booking counts given (null when none), the provider ref is the solution key, the expiry its latest ticketing time; any SOAP fault, including "no availability", is a provider error with its description.
- A booking keeps its own ticketing airline (copied from the offer, like its price); the Confirm availability dialog shows it read-only and changes it only with a re-checked fare, and `changes` records it as old and new airline names.
- Mobile app: the agency code is the schema name with hyphens, the app address `<code>.<TENANT_BASE_DOMAIN>` is computed (every agency has it as a domain); the platform's own emails keep the root host.
- Mobile app: the verification files are served on the root host too, since Android verifies a `*.<base>` intent filter there.
- Mobile app: the bundle id and Android package are `com.azariabookings.app`, fixed in `app.config.ts`; the base domain comes from `EXPO_PUBLIC_TENANT_BASE_DOMAIN`, and without it the build declares no link domains.
- Mobile app: guests switch agency from the sign-in screen ("Signing in to <agency> · Switch agency"), and the "Agency not available" page offers Switch agency, so a suspended or wrong agency never traps the app.
- Mobile app: switching agency, or signing out to follow a password link, rebuilds the whole session (query cache, auth, navigation); a link to `/app` or `azaria://open` opens the app's home, and an admin link while signed out reopens after sign-in, as on the web.
- Mobile app: link prompts are the platform's native alerts; Find your agency and link handling are native-only files, so the web bundle does not contain them.
- The welcome email is sent only on self-registration; its subject is "Welcome to <agency>".
- Migrations are flattened to one initial migration per app (catalog needs two: it and integrations reference each other), plus the two seed-data migrations; there is no upgrade path from older databases.
- An agency's "super users" on the platform are its admins (role admin); the owner suspends/restores them (is_active) and sends the usual reset link. Suspending the last admin is allowed.
- The platform's agency detail is a full page at the same URL `/agencies/<id>` instead of a drawer; the list stays mounted underneath so its search and page are kept. (Replaced in step 40: it opens beside the slim rail.)
- An agency admin can make an active customer an admin (one way; they keep their requests and bookings). Users › System admins lists the admins with the same drawer: admins can edit, deactivate and send reset links to each other, but never deactivate themselves (409). New users are always customers.
- Step 40: the slim rail hides the list's filters and tabs (they stay applied); its collapsed state lasts for the session only, not across reloads.
- Step 41: users had no creation date, so `date_joined` was added (nullable); users from before it count as customers but never as new.
- Step 41: the overdue invoice is a tile under Needs action, not a second banner, since every admin screen already shows the overdue banner.
- Sabre: Bargain Finder Max v5 (`/v5/offers/shop`) with its default grouped itinerary response, on `api.cert.platform.sabre.com` (test) and `api.platform.sabre.com` (live); a token is taken per provider instance (one per search), not cached between searches.
- Sabre: the cabin is sent with PreferLevel Only; max connections is `MaxStopsQuantity`; penalty information comes from `VoluntaryChanges Match="Info"`, which asks without filtering; the requestor is the usual `TN` company code.
- Sabre: only the first pricing of an itinerary and its first passenger are read; cabin codes Y economy, S/W premium economy, C/J business, F/P first.
- Sabre: refund (exchange) is allowed when a "Before" (or unlabelled) penalty says refundable (changeable); free only when every such penalty states a zero amount; no penalty information is not allowed. Fare type is always unknown (the grouped response does not state private fares reliably).
- Sabre: checked bags count only allowances with provision type A; the last ticketing date and time are read in the agency's time zone (23:59 when no time); error messages with no itineraries, such as "no complete journey", are a provider error with the first message.
- Amadeus: the REST Flight Offers Search (the API Enterprise customers keep since self-service closed), not the SOAP Master Pricer; up to 50 offers, GDS sources only, the cabin with coverage ALL_SEGMENTS; a route's max connections above 2 asks for 2 (Amadeus's most); a token per provider instance.
- Amadeus: the grand total is the net amount; only the first traveller pricing is read; checked bags are the fewest included across segments (a segment with none counts as 0), weight only when every segment gives kilograms; fare type private for NEGOTIATED or CORPORATE, public for PUBLISHED, otherwise unknown.
- Amadeus: refund and change are not allowed on every fare (the search states no conditions); the expiry is 23:59 on the last ticketing date in the agency's time zone; an empty offer list is no results, not an error.
- Step 44: theming approach: `colors` in theme.ts is live (applyTheme replaces its six brand colours), every style sheet is made with `createStyles(() => ...)`, which rebuilds after a theme change, and colours are only read while rendering; a theme change re-mounts the screens below the agency (native keeps the navigation state; the web reloads the page instead).
- Step 44: the primary's hover shade is opaque, white at 12% over the primary (what the bar's hover looked like before themes), and shades are rounded half up on server and app alike.
- Step 44: contrast ratios are shown rounded down to one decimal, so a ratio shown as 4.5:1 always passes.
- Step 44: tenants return and accept `theme` as the theme's id (like admin settings); the platform app names it from the themes list.
- Step 44: making an inactive theme the default answers 409; the platform themes list is not paginated and is sorted default first, then by name, like the admins' list.
- Step 44: platform emails sent in an agency's schema for its links (invoice, suspension, the platform desk's reply) are marked as platform emails and keep Azaria's colours; the email header text stays "Azaria Bookings" (only colours are themed).
- Step 44: on web, when GET /api/agency fails, the app starts in Azaria's colours (and shows the no-agency or suspended page as before); on native a failed theme refresh keeps the stored theme.
- Step 45: tours and hotels have no screens until steps 46 and 48, so their Explore and customer Bookings tabs show an empty "No tours yet" / "No hotels yet" page, and admins get no Tours or Hotels nav entry yet.
- Step 45: airport and airline lookups stay on for every agency (shared reference data, not part of the flights module).
- Step 45: an admin or customer screen of a module that is off stays reachable by its link and shows "This part of the site isn't available"; a `module_off` answer also makes the app re-read the agency's modules, so its nav follows at once.
- Step 45: a link to a flight item (`/offers/<id>`, `/bookings/<id>`) always opens the flights page, without the module switch.
- Step 45: when flights is off the admin dashboard leaves out every flight key (the API returns only `customers` and `overdue_invoice`); `manage.py create_agency` is unchanged (flights only).
- Step 45: the last module is checked before open bookings, so turning off the only module answers 400 even when it has open bookings.
- Step 46: Traveller gets both owners now (tour_line, and the flight `booking` that step 47 uses), as §26 defines it, so the database check of exactly one owner holds from the start.
- Step 46: a tour's summary is required and its description optional; option names are unique ignoring case; units_available is at least 1 (blank = no limit); an option left out of a PATCH list is deleted only when never booked.
- Step 46: traveller rules: nationality is two letters (the app lists countries from the bundled flag codes); a document number needs its type, an expiry needs a number, and a passport number needs its expiry.
- Step 46: not_bookable_reason is cancelled first, then closed (inactive, no active option, deadline passed or started), then fully_booked; a tour customers can no longer book is not found for those who have not booked it (as the API defines), so a 409 on Book shows its message with a link to other tours.
- Step 46: change notices and tour cancellations are emailed once per confirmed booking (`recipients` counts bookings); an admin cancelling one booking emails the customer only when there is a message, and may do so until the tour's end date.
- Step 46: photo positions start at 0 (the cover); PATCH {position} moves a photo and renumbers the rest; photo changes on a cancelled tour answer 409; photos chosen on New tour are uploaded once the tour is created; tapping a gallery photo opens it large in a dialog.
- Step 46: admin tours also return `confirmed_bookings` (for "N bookings (M people)" in the notice dialog); the table's status is worked out in the app; filters: upcoming and inactive are not cancelled and not ended, past is ended, cancelled is cancelled. Activate / Deactivate never asks for a notice.
- Step 46: URLs: /tours/<id> and /tours/<id>/book; a customer's tour booking is /bookings?tour=<id>; admins have /admin/tours/<id> (a booking: ?booking=<id>), /admin/tours/new, /admin/tours/<id>/edit and /admin/tours/<id>/book?customer=<id>.
- Step 47: the passport check uses the latest flight date of the booking (of the offer when booking): the expiry must be after it, so a passport expiring on that day is refused; a national ID's expiry is not checked against the trip.
- Step 47: admins edit passengers while the booking is requested, availability confirmed or paid; any other status (completed, cancelled, unavailable, expired, declined) answers 409, as does a customer edit after requested.
- Step 47: `travellers` and `can_edit_travellers` are on booking detail responses (customer and admin), not in the lists; the API gives the booker full document numbers and the app masks them to the last 4 on the customer's Passengers card.
- Step 47: emails list passenger names after the passenger count (new booking, seats confirmed) or as a Passengers row (other customer emails), and leave it out for bookings with no passengers.
- Step 47: Copy for GDS is web only (no clipboard without a new dependency); each line is "SURNAME/GIVEN NAMES, F or M, 17MAY1990, PASSPORT number, expiry, KE", the surname being the full name's last word.
- Step 47: passenger forms mark required fields with "*" and the gender, nationality and document selects start on "Choose"; the first passenger is prefilled once, when the customer is chosen (admin) or from the signed-in account.
- Step 48: a hotel's from price, and its place in the public list, use only rates that fit the adults and children searched (a rate's own limits); adults above a rate's max are priced at its max, as §28 says.
- Step 48: the public list is worked out in Python (from prices need each rate's periods) and paginated as a list; ordering `from_price` (default), `-from_price`, `-star_rating` (unrated last, then price) and `name`; check-in must be today or later and the stay 1–30 nights (400 otherwise).
- Step 48: `hotels/{id}` shows any active hotel with its active rates that still have a period not ended; without dates each rate's `available`, `nights`, `room_price` and `stay_price` are null.
- Step 48: `changes` is `{total: {old, new}, note}`; it is set only when the new total differs from the booking's, and a note without a new total is refused (400). The booking's total becomes the new one on accept-changes.
- Step 48: the lead guest is a room's first guest (rooms are created guest by guest); guests are edited by the customer while requested and by admins while requested, availability confirmed or paid; the lead guest can be edited, never removed (409).
- Step 48: rooms of a booking are listed by room type and rate position (no position field); a rate cannot move to another room type in a PATCH (400), and a PATCH replaces each kept rate's periods with those sent.
- Step 48: the shared booking tasks (`expire_unpaid_bookings`, `send_payment_reminders`, `expire_stale_requests`) run the flight job in agencies with flights and the hotel job in agencies with hotels, and return the sum.
- Step 48: URLs: /hotels/<id> (stay and guests as query params), /hotels/<id>/book?rooms=<rate ids>; a customer's hotel booking is /bookings?hotel=<id>; admins have /admin/hotels/<booking id> (bookings tab), /admin/hotels/<hotel id>?tab=hotels, /admin/hotels/new, /admin/hotels/<id>/edit and /admin/hotels/<id>/book?customer=<id>.
- Step 48: the admin's New booking dialog picks the customer and a hotel from the public hotels search (only hotels customers can book); the Request booking page then starts with one room and lets dates, rooms, rates and occupancy be chosen there, for customers and admins alike.
- Step 48: guests are optional in the search (Adults "Any"); with none chosen nothing is dimmed and rates are priced for their max adults. The room picker shows only for rates offered for the chosen dates.
- Step 48: the cover, gallery, photo editor, lines editor and payment box from the tour and flight screens became shared components; the boarding pass list also opens hotel vouchers (preview first).
- Step 49: `explore` lives in `core` (`GET /api/explore`); each module's cards are ordered featured first, then flights by departure date and price, tours by start date and title, hotels by from price and name; a card list is the module's own public serializer.
- Step 49: dashboard tour figures: `travellers_missing` and the tour rows of `this_week` count tours starting from today to 7 days ahead; `on_sale.tours.fully_booked`, `seats_sold` and `seats_total` cover active, not cancelled tours starting after today; route rows in `top_sellers` group by their route line ("NBO → LHR" / "NBO ⇄ LHR") and ties go to the larger count, then the title.
- Step 49: dashboard tiles: flight tiles open Bookings with their status, hotel tiles open Hotels › Bookings with theirs ("Paid, voucher due" for paid hotel bookings), "Travellers missing this week" opens Tours on Upcoming; paired labels read "Flight/Hotel bookings to confirm" and "Flights/Hotels awaiting payment" only when both are on.
- Step 49: Coming up rows open the flight booking, the hotel booking or the tour; top seller rows open the tour or hotel, route rows open nothing; the sales cards' "View bookings" opens the first module's bookings (flights, then hotel bookings, then tours).
- Step 49: the stacked chart puts flights at the bottom, then tours, then hotels; its legend shows each module's amount for the chosen month.
- Step 49: the single-module "Featured" row shows the module's `explore` cards as returned (featured first, then filled), is hidden while any search or filter is applied (sorting does not count) and is left out when there are none.
- Step 49: Explore's tab is the `tab` query parameter (`all`, `flights`, `tours`, `hotels`); without it the All tab shows.
- Step 49: the table star saves `is_featured` at once and is disabled on cancelled tours (they refuse edits); the Featured filter is a "Featured only" switch above each admin list, kept in screen state; the "Feature on Explore" switch sits in the offer form's Visibility section (not on custom offers in a request response) and at the end of the tour and hotel forms' main section.
- Step 50: the 409 for a fully booked tour stays "This tour is fully booked." (with the full stop every 409 message carries).
- Step 50: a tour whose active options are all limited and sold out reports `not_bookable_reason` `fully_booked` (closed and cancelled still win), and the admin Tours status shows it as "Fully booked" rather than "Closed".
- Step 50: on tour detail, "Sold out" replaces "None left" on a limited option with no units left; the tour-not-found message drops "fully booked" since fully booked tours now open.
- Step 51: `GET reviews` with `tour`, `hotel` or `kind=flight` is the public list; without any of them it is the signed-in customer's own reviews (401 for guests); a malformed id, or two scopes, is a 400.
- Step 51: a flight booking's "last segment's date" is the latest segment departure date (the offer's departure date for bookings without segments); reviewable from the day after it.
- Step 51: `summary` with no reviews is `{average: null, count: 0, by_rating}` with every level at 0; `rating` and `service_rating` are null.
- Step 51: reviewing someone else's booking answers 404 (it is not among the customer's bookings); an admin posting a review gets 403; a booking that cannot be reviewed yet or ever answers 409.
- Step 51: `can_review` and `review` are on the customer's booking responses only, not the admin ones; review responses carry `booking` as `{kind, id, title}` (the tour or hotel name, or the route line), and admin reviews add `customer {id, full_name, email}` and `item` (the tour or hotel, null for flights).
- Step 51: admins also have `GET admin/reviews/{id}` for the review opened beside the rail; Admin › Reviews keeps its filters in the URL, and the tour and hotel filters are set from the rating link on the admin tour and hotel pages (shown as "Reviews of <name>" with Show all) rather than with a picker.
- Step 51: the "Rate your trip" card sits right under the booking's status card; on tour and hotel detail the Reviews card follows the description card (after the price card on phones).
- Step 51: with more than eight items in the wide top bar, items sit closer with smaller labels and the account menu shows only the initials, so the bar fits at 1280 px.
- Step 51: `request_reviews` also emails bookings that finished before the step was deployed, once each.
