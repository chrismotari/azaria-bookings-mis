# Decisions

Choices made where [SPEC.md](SPEC.md) is ambiguous or silent, one line each.

## Rules and accounts
- Emails are stored lowercased and matched case-insensitively for login, registration and password reset.
- Registration requires `phone`; the model allows it blank because `create_admin` and admin-created customers don't need one.
- Logout is client-side only (tokens discarded); no JWT blacklist.
- Throttles use Django's local-memory cache (per process); password-reset request and confirm share one limit. The client IP is REMOTE_ADDR unless `NUM_PROXIES` says how many X-Forwarded-For hops to trust.
- Auth screens are guest-only; a signed-in user opening them lands on home. To use a reset link, sign out first.
- Signing out lands on the area's `/login` (the platform's too); so does an admin's or the owner's session ending. A customer whose session ends stays on the page. The next sign-in opens the area's home.
- On start-up the app clears stored tokens only on a 401, not when the server is unreachable or the agency suspended.
- Signed-in-only links opened while signed out (e.g. from emails) go through the sign-in gate and open afterwards.
- An admin made from a customer keeps their requests and bookings; admins can edit, deactivate and send reset links to each other, never deactivate themselves (409). New users are always customers.

## Multitenancy
- The platform and each agency have separate Django admin sites; tenants, themes and shared airports and airlines are only on the platform's.
- `create_agency` runs in one transaction; PostgreSQL rolls back the new schema on failure. Addresses matching an existing schema (e.g. `information-schema`) are refused. `manage.py create_agency` has no modules option, so it makes flights-only agencies.
- The platform's own tenant row (schema `public`) and its domain are created by a data migration and hidden from tenant lists.
- Beat tasks return the total across agencies (a shared booking task sums its flight and hotel jobs).
- A host outside ALLOWED_HOSTS gets Django's plain 404; allowed hosts without an agency get the `no_tenant` JSON.
- Domains equal to the root host or used by any agency are refused; reaching a new hostname still needs ALLOWED_HOSTS and CORS.
- Settings singletons are fetched with `objects.get()`; their data migrations create the row only when missing.
- Emails sent in the public schema (the platform desk's) link to the root host; everything sent in an agency's schema, platform emails for its links included, uses its app address.

## Modules
- Airport and airline lookups stay on for every agency (shared reference data, not part of the flights module).
- A `module_off` answer also makes the app re-read the agency's modules, so its nav follows at once.
- A link to a flight item (`/offers/<id>`, `/bookings/<id>`) always opens the flights page, without the module switch.
- The last module is checked before open bookings, so turning off the only module answers 400 even when it has open bookings.

## Flights
- `GET /api/airports` with an empty search returns an empty list. The offers' airport text filters match the code exactly (any case) and city, country and name by "contains".
- Airports are returned as nested objects `{id, code, name, city, country, country_code}`; flight times are sent and returned as `HH:MM`.
- Offer detail returns any active public offer with an `is_bookable` flag; only browse is limited to bookable offers. A customer can also open any offer they have booked.
- The admin offer list includes private, deactivated and lapsed offers, filterable by `is_active` and `is_public`.
- Segment positions start at 1 within each direction in list order; an edit without a `segments` key keeps them, and they are rechecked against a changed trip type.
- An operating airline equal to the marketing one is stored as none (not a codeshare).
- Baggage weights are whole kilograms of at least 1; a checked bag weight without checked bags is refused.
- Durations read "2 h 15 min", "45 min" or "26 h" (no days); emails list each direction's flights one per line, with the connection between them and "+1" for a later arrival day.
- `seed_airlines` drops rows with an empty name; an ICAO code that isn't three letters is left blank.
- The `requests` app lives in the `customer_requests` package (label `requests`) so it doesn't shadow the PyPI `requests` library.
- Closing an already closed query, or responding to a closed one, returns 409; open and responded queries can be closed.
- A response's `offer_ids` must be currently bookable. A request's return date is on or after `date_from`.
- An offer that isn't bookable or visible returns 400 on `offer`; a second active booking of it returns 409 (naming the customer when the admin books).
- A booking's optional `query` must be the customer's own.
- A move by the wrong actor returns 409 like any invalid move; confirm-availability and mark-unavailable return 409 for impossible moves before validating their body.
- Marking paid exactly at the deadline is allowed. Scheduled expiry re-checks the status under the lock.
- Customer booking detail includes `payment_instructions` only while `availability_confirmed`, and no `boarding_passes` key until completed.
- The timeline shows statuses and times, not the actor.
- Stale requests get the same "booking expired" email as lapsed payment holds. The reminder is skipped if the booking is no longer awaiting payment or the deadline has passed.
- Payment hold and reminder hours must be at least 1; settings accept GET and PATCH only.
- Confirm availability always sends the dialog's price, airline and segments; the server records only values that differ, and the booking's return date follows the new segments. Accepting changes is not a status change and adds no timeline event. The payment deadline runs from confirmation, including while changes await acceptance.
- The ticketing airline is changed only by applying a re-checked fare; `changes` records it as old and new airline names.
- Mark unavailable sends the message only together with suggested options. Its offer search starts from the booking's route, dates and trip type, any class.
- In the support Django admin, booking status, deadline, reminder and changes are read-only.
- Uploads must agree on extension, declared content type and leading bytes (`core/files.py`, shared with vouchers and chat attachments). Wrong type, oversize or an 11th file returns 400 on `file`; outside `paid` returns 409.
- The admin may pick several files at once; the app uploads them one per request. A deleted pass's file is removed once the delete commits.
- Passport expiry is checked against the latest flight date of the booking (of the offer when booking): a passport expiring on that day is refused; a national ID's expiry is not checked against the trip.
- Passenger edits outside their window (customer after requested; admin once completed or ended) answer 409.
- `travellers` and `can_edit_travellers` are on booking detail responses only, not in the lists; the API gives the booker full document numbers and the app masks them.
- Emails list passenger names after the passenger count (new booking, seats confirmed) or as a Passengers row (other customer emails), and leave it out for bookings with no passengers.
- Copy for GDS is web only (no clipboard without a new dependency); each line is "SURNAME/GIVEN NAMES, F or M, 17MAY1990, PASSPORT number, expiry, KE", the surname being the full name's last word.
- Passenger forms mark required fields with "*" and the gender, nationality and document selects start on "Choose"; the first passenger is prefilled once, when the customer is chosen (admin) or from the signed-in account.

## Fare search
- Pick rule: `pick_cheapest_direct` adds the cheapest direct fare on top of `max_per_date`; at least one of `pick_cheapest` and `pick_cheapest_direct` is on.
- While queued, the tenant row is locked to check the allowance, so two quick starts cannot both fit in what is left; `searches_made` ends as the searches actually made.
- Provider errors and skipped results are recorded once per distinct message, with "(n×)" when repeated.
- A fare's departure date is read from its itinerary's first segment; no extra column.
- `admin/fares` needs `route`. Integrations are listed unpaginated.
- Publishing or dismissing a fare that is not new answers 409.
- Changing an integration's credentials clears its last test result; a failed test is a 200 with `last_test_ok` false.
- Net amounts are stored with 3 decimals (some currencies have 3).
- Exchange rates: the feed's rates are stored under the Nairobi date of the fetch; a failed feed stores nothing and the task errors. The platform screen lists every currency with a stored rate.
- Only scheduled runs (skipped ones included) count as a route's run for the day or week, so a manual search does not replace the scheduled one. Weeks run Monday to Sunday in Nairobi time.
- A rolling window counts from the Nairobi date the run starts, both ends included, with M − N ≤ 60 as written; a fixed window keeps Search now's 60 dates.
- A re-check sets max connections to the booking's busier direction, so its own flights can be found.
- A re-check uses the offer's route's markup even if the route was changed or deactivated (routes are never deleted).
- A not-found re-check lists the 3 cheapest other fares in the booking's cabin with a rate, one per fare_key; a found fare without a rate fills only the flights.
- Choosing a re-check alternative changes only price, ticketing airline and flights through confirm availability; the booking keeps its baggage and fare conditions.
- Duffel: mode is a label (the token decides test or live; one URL). "Any" connections sends no `max_connections` (Duffel's default of one connection applies).
- Duffel: checked bags are the fewest included on any flight (first passenger); carry-on bags have no count field here, and weights are null as Duffel's offer gives none. An allowed change or refund with an unstated penalty is "with a fee".
- Duffel: a non-empty `private_fares` is a private fare, an empty one public, a missing one unknown.
- Travelport: EMEA gateways and the Galileo (1G) host; a leg per direction with the cabin as a permitted cabin, `MaxConnections` only when set, and `SolutionResult` true so each priced solution is one itinerary. The test ping counts against no allowance.
- Travelport: checked bags are the fewest pieces of the solution's fare components (a weight allowance alone counts as one bag), with the weight only when every component states kilograms; cabin bag weight is not read (free text only).
- Travelport: refund or change is not allowed unless the pricing says Refundable or Exchangeable; then a zero penalty is free and any other (or none stated) a fee. Any SOAP fault, including "no availability", is a provider error with its description; the provider ref is the solution key.
- Sabre: hosts `api.cert.platform.sabre.com` (test) and `api.platform.sabre.com` (live), default grouped itinerary response; the token is not cached between searches.
- Sabre: the cabin is sent with PreferLevel Only; max connections is `MaxStopsQuantity`; penalty information comes from `VoluntaryChanges Match="Info"`; the requestor is the usual `TN` company code.
- Sabre: only the first pricing of an itinerary and its first passenger are read; cabin codes Y economy, S/W premium economy, C/J business, F/P first.
- Sabre: refund (exchange) is allowed when a "Before" (or unlabelled) penalty says refundable (changeable); free only when every such penalty states a zero amount.
- Sabre: checked bags count only allowances with provision type A; the last ticketing date and time are read in Nairobi time (23:59 when no time); an error without itineraries uses the first message.
- Amadeus: up to 50 offers, the cabin with coverage ALL_SEGMENTS; a route's max connections above 2 asks for 2.
- Amadeus: only the first traveller pricing is read; a segment with no checked bags counts as 0; fare type is unknown unless NEGOTIATED/CORPORATE (private) or PUBLISHED (public).
- Amadeus: the expiry is 23:59 Nairobi time on the last ticketing date; an empty offer list is no results, not an error.

## Tours
- A tour's summary is required and its description optional; option names are unique ignoring case; units_available is at least 1 (blank = no limit).
- `not_bookable_reason` is cancelled first, then closed (inactive, no active option, deadline passed or started), then fully_booked (every active option limited and sold out counts too). A 409 on Book shows its message with a link to other tours.
- The fully booked 409 reads "This tour is fully booked." (with the full stop every 409 message carries). Tour detail's not-found message no longer mentions "fully booked".
- Change notices and tour cancellations are emailed once per confirmed booking (`recipients` counts bookings); an admin cancelling one booking emails the customer only when there is a message, and may do so until the tour's end date.
- Photo positions start at 0 (the cover); a PATCH of `position` renumbers the rest; photo changes on a cancelled tour answer 409; photos chosen on New tour are uploaded once the tour is created.
- Admin tours also return `confirmed_bookings` (for "N bookings (M people)" in the notice dialog); the table's status is worked out in the app; filters: upcoming and inactive are not cancelled and not ended, past is ended, cancelled is cancelled. Activate / Deactivate never asks for a notice.
- URLs: /tours/<id> and /tours/<id>/book; a customer's tour booking is /bookings?tour=<id>; admins have /admin/tours/<id> (a booking: ?booking=<id>), /admin/tours/new, /admin/tours/<id>/edit and /admin/tours/<id>/book?customer=<id>.
- "City" on the tours search is the tour's new `departure_city` (where it starts); organiser is free text on the tour, not a managed list, and the single `search` filter on tours and hotels is replaced by one filter per search field.

## Hotels
- A hotel's from price, and its place in the public list, use only rates that fit the adults and children searched.
- The public list is worked out in Python (from prices need each rate's periods) and paginated as a list; ordering `from_price` (default), `-from_price`, `-star_rating` (unrated last, then price) and `name`; a check-in before today or a stay outside 1–30 nights answers 400.
- `hotels/{id}` shows any active hotel with its active rates that still have a period not ended; without dates each rate's `available`, `nights`, `room_price` and `stay_price` are null.
- `changes` is `{total: {old, new}, note}`; it is set only when the new total differs from the booking's, and a note without a new total is refused (400).
- The lead guest is a room's first guest (rooms are created guest by guest); removing it answers 409.
- Rooms of a booking are listed by room type and rate position (no position field); a rate cannot move to another room type in a PATCH (400), and a PATCH replaces each kept rate's periods with those sent.
- URLs: /hotels/<id> (stay and guests as query params), /hotels/<id>/book?rooms=<rate ids>; a customer's hotel booking is /bookings?hotel=<id>; admins have /admin/hotels/<booking id> (bookings tab), /admin/hotels/<hotel id>?tab=hotels, /admin/hotels/new, /admin/hotels/<id>/edit and /admin/hotels/<id>/book?customer=<id>.
- The admin's New booking dialog picks the customer and a hotel from the public hotels search; the Request booking page then starts with one room and lets dates, rooms, rates and occupancy be chosen there, for customers and admins alike.
- Guests are optional in the search (Adults "Any"), and nothing is dimmed without them. The room picker shows only for rates offered for the chosen dates.
- The cover, gallery, photo editor, lines editor and payment box are shared with tours and flights; the boarding pass list also opens hotel vouchers.

## Travellers
- Nationality is two letters (the app lists countries from the bundled flag codes); a document number needs its type, an expiry needs a number, and a passport number needs its expiry.

## Reviews
- `GET reviews` without a scope is the signed-in customer's own reviews (401 for guests); a malformed id, or two scopes, is a 400.
- A flight booking's "last segment's date" is the latest segment departure date (the offer's departure date for bookings without segments).
- `summary` with no reviews is `{average: null, count: 0, by_rating}` with every level at 0.
- Reviewing someone else's booking answers 404 (it is not among the customer's bookings); an admin posting a review gets 403; a booking that cannot be reviewed yet or ever answers 409.
- `can_review` and `review` are on the customer's booking responses only, not the admin ones; review responses carry `booking` as `{kind, id, title}` (the tour or hotel name, or the route line), and admin reviews add `customer {id, full_name, email}` and `item` (the tour or hotel, null for flights).
- Admins also have `GET admin/reviews/{id}` for the review opened beside the rail; Admin › Reviews keeps its filters in the URL, and the tour and hotel filters are set from the rating link on the admin tour and hotel pages (shown as "Reviews of <name>" with Show all) rather than with a picker.
- The "Rate your trip" card sits right under the booking's status card; on phones the Reviews section follows the price card.
- `request_reviews` also emails bookings that finished before reviews were deployed, once each.

## Featured and Explore
- `explore` lives in `core`; ties are broken by price (flights), title (tours) and name (hotels); a card list is the module's own public serializer.
- The single-module "Featured" row shows the module's `explore` cards as returned; sorting does not count as a search or filter.
- Explore's tab is the `tab` query parameter (`all`, `flights`, `tours`, `hotels`); without it the All tab shows.
- The table star saves `is_featured` at once and is disabled on cancelled tours (they refuse edits); the Featured filter is a "Featured only" switch above each admin list, kept in screen state; the "Feature on Explore" switch sits in the offer form's Visibility section (not on custom offers in a request response) and at the end of the tour and hotel forms' main section.

## Dashboard
- `travellers_missing` and the tour rows of `this_week` count tours starting from today to 7 days ahead; `seats_sold` and `seats_total` cover active, not cancelled tours starting after today; route rows in `top_sellers` group by their route line ("NBO → LHR" / "NBO ⇄ LHR") and ties go to the larger count, then the title.
- Flight tiles open Bookings with their status, hotel tiles open Hotels › Bookings with theirs ("Paid, voucher due" for paid hotel bookings), "Travellers missing this week" opens Tours on Upcoming; paired labels read "Flight/Hotel bookings to confirm" and "Flights/Hotels awaiting payment".
- Coming up rows open the flight booking, the hotel booking or the tour; top seller rows open the tour or hotel, route rows open nothing; the sales cards' "View bookings" opens the first module's bookings (flights, then hotel bookings, then tours).
- The stacked chart puts flights at the bottom, then tours, then hotels; its legend shows each module's amount for the chosen month.

## Emails
- Emails' highlighted box is the primary's tint with a primary left edge; shared pieces are includes under `emails/`.
- Platform emails sent in an agency's schema (invoice, suspension, the platform desk's reply) are marked as platform emails and keep Dira Manifest's colours and name.

## Support
- `Conversation.requester` is a plain UUID because on the platform desk it names a user in an agency's schema; `Conversation.agency` has no DB constraint because the table exists in every schema.
- Requesters list and create through `support/chats`; only POST is open to guests (throttled). The desk can't start chats with itself (403).
- Replies keep the chat's own subject and email. The desk list puts unread first, then most recent.
- The floating panel lists only open chats and points to Account > Support for closed ones.
- Agency admins' platform chats go through their own host (`support/platform-chats`); reply emails link to `/admin/support/<id>` on the agency's address.
- With `PlatformSettings.support_email` blank no desk email is sent; the Settings screen warns.
- Plan enquiries open the floating panel on the pricing page and a dialog in the agency app, after which the admin lands on the chat in Settings > Support.

## Platform
- Theme colours: a bar text colour without a bar colour is refused ("Choose a bar colour for this text colour."); a failing text-vs-surface rule is reported on the chosen text field when there is one, else on the colour field. The ThemesSection API returns the raw colour fields so the form can tell chosen from automatic.
- Subscription stores its plan's kind so "one running plan per kind" is a DB constraint; a plan's kind can't change.
- Periods keep the start day of month, clamped to shorter months (31 Jan → 28 Feb → 31 Mar).
- "More than a month past due" means `due_on` + one calendar month < today.
- Voiding an invoice lifts a non-payment suspension like marking it paid does. The overdue notice shows the oldest unpaid, unwaived invoice past due.
- The invoice PDF is re-rendered (old file deleted) on every status change. It uses fpdf2's Helvetica: Latin-1 only, other characters print as "?".
- A plan price can't be cleared while a running subscription pays on that cycle.
- Plans, invoices and subscriptions return the currency so the app can format amounts.
- Suspending and reactivating in `/django-admin/` use the same `billing.set_active` as the platform app.
- `public-plans` ignores any Authorization header.
- Suspending an agency's last admin is allowed.
- Platform dashboard: owner-suspended agencies count as "suspended", the other inactive ones as "for non-payment"; cards link to the matching filtered lists.
- Shades (tint, hover) are rounded half up on server and app alike; contrast ratios are shown rounded down to one decimal, so a ratio shown as 4.5:1 always passes.
- Making an inactive theme the default answers 409; the platform themes list is not paginated and is sorted default first, then by name.
- The platform app assigns the signed-in account the role "owner" client-side; platform pages opened signed out go to `/login`.
- Admin-address redirects (`admin.<root host>`, `/admin`) happen in the web app before it starts (`config.ts`).
- Website headings use three extra sizes, `siteFont` in `theme.ts` (hero 52, section 38, lead 20); the app's own type scale is unchanged.
- The website's sample tour and hotel cards show small landscapes drawn as SVG data in the theme's colours, so the mocks are not grey placeholders yet use no image files.
- Mock screens are laid out at a fixed desktop-like width (narrower on phones) and scaled down to fit; they are `inert` and `aria-hidden`.
- For a signed-in owner every website "Get started" outside the plan cards becomes "Open admin" and the footer's Contact is hidden, since the owner has no message button.
- The pricing preview shows at most three featured plans (or the three cheapest when none is tagged), without "Show all plans" or support plans; the progress tracker in the flights mock names its last step "Passes sent" through an optional `lastLabel`.
- Bar links from `/pricing` go back to the existing home page (`popTo`) rather than pushing a second one.

## Frontend
- The selected item is a route parameter of its list (e.g. `/bookings/<id>`), so the list stays mounted; Explore's URL is `/offers` (`/` also opens it). Opening a detail replaces the history entry.
- Offer detail opens beside Explore's rail, including from a request's response; its price summary is sticky on the right when the detail is ≥ 640 px wide.
- Lists show tables on wide screens and cards on phones.
- On phones the admin bar keeps Dashboard, Offers, Requests and Bookings (those that are on), and the platform bar Dashboard, Agencies, Invoices and Chats; More shows its items' unread counts added up and stays highlighted on any of them.
- Explore's From/To send the airport code when picked, otherwise the typed text. Filter chips apply at once, prices on Enter or blur, the search bar on Search; "Clear all" clears the sidebar only.
- Request options takes "Returning from" as the request's return date.
- Full-page forms and sub-pages (Book, Request options, New offer, Respond, tour and hotel pages and forms, Billing, Plans, Support) are hidden tabs that highlight their parent tab, with a back link and a fresh form on each visit.
- Auth screens show the brand bar without Sign in / Create account.
- Ended bookings show the status banner only, no chip. Booking status filters wrap to a second row.
- "Send boarding passes" sits in the action bar, disabled until a file is uploaded and while uploads run. The request detail's Respond button is its action bar.
- The admin booking detail keeps the changes card after the customer answers.
- The Users list is ordered by name, with search only (the `is_active` filter has no UI). New user, New booking and other forms use large dialogs; dialogs show save errors above the footer buttons, and content with its own buttons has no footer bar.
- The flight New booking dialog shows up to six customers; its offer search lists active offers with unbookable ones disabled. After saving, Bookings switches to Requested.
- Paged lists return to page 1 when the filter changes or the page no longer exists. Platform Agencies and Invoices keep their status filter in the URL.
- Preview first decides by file extension (pdf, png, jpg, jpeg, webp, gif) so the tab opens during the click (later tabs are blocked as pop-ups). The tab shows a blob: URL, so its title is the browser's.
- Theming: `applyTheme` replaces the brand colours in `colors`, every style sheet is made with `createStyles(() => ...)`, which rebuilds after a theme change; a theme change re-mounts the screens below the agency (native keeps the navigation state; the web reloads the page instead).
- When GET /api/agency fails on web the app starts in Dira Manifest's colours; on native a failed theme refresh keeps the stored theme.
- With more than eight items in the wide top bar, items sit closer with smaller labels and the account menu shows only the initials, so the bar fits at 1280 px.
- The web Flag component is `Flag.tsx` (Metro picks `Flag.native.tsx` on native); `flagCodes.ts` and `flags.native.ts` are generated from `public/flags/`.
- `@expo/metro-config` is a dev dependency so react-native-svg-transformer can find Expo's Babel transformer.
- The airline badge is a rounded square for logos and initials alike.
- TipTap: link and underline come with the starter kit. The H1/H2 buttons produce h3/h4; links use the browser prompt; toolbar buttons cancel mousedown to keep focus in the text.
- Web form elements (select, date input, rich text) use `WEB_SYSTEM_FONT` from `theme.ts`.
- Mobile app: the verification files are served on the root host too, since Android verifies a `*.<base>` intent filter there.
- Mobile app: the bundle id and Android package are `com.diramanifest.app`, fixed in `app.config.ts`; without `EXPO_PUBLIC_TENANT_BASE_DOMAIN` the build declares no link domains.
- Mobile app: guests switch agency from the sign-in screen ("Signing in to <agency> · Switch agency"), and the "Agency not available" page offers Switch agency, so a suspended or wrong agency never traps the app.
- Mobile app: switching agency, or signing out to follow a password link, rebuilds the whole session (query cache, auth, navigation); a link to `/app` or `dira://open` opens the app's home, and an admin link while signed out reopens after sign-in, as on the web.
- Mobile app: link prompts are the platform's native alerts; Find your agency and link handling are native-only files, so the web bundle does not contain them.

## Tests and tooling
- The session's agency uses the test client's default host (`testserver`); the second agency is `other.localhost`.
- Migrations were flattened once (one initial migration per app, catalog two since it and integrations reference each other, plus the seed-data migrations); later steps add migrations as usual. There is no upgrade path from databases older than the flattening.
