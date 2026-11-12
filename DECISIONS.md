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
