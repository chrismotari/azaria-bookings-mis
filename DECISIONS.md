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
- Airports are written by id (stops by IATA code, any case) and returned as nested objects `{id, code, name, city, country, country_code}`.
- `valid_until >= today` is enforced on create only; edits re-check the other rules.
- Offer detail returns any active public offer with an `is_bookable` flag; only browse is limited to bookable offers. A customer can also open any offer they have booked.
- The admin offer list includes private, deactivated and lapsed offers, filterable by `is_active` and `is_public`.
- Stop positions start at 1 in list order; an edit without a `stops` key keeps the stops, and they are rechecked against a changed origin or destination.
- Durations read "2 h 15 min", "45 min" or "26 h" (no days); emails show a Stops line ("Direct" when none).
- `seed_airlines` drops rows with an empty name; an ICAO code that isn't three letters is left blank.
- The airline search lives on agency hosts for the admin's picker; the list itself is edited only in the platform's Django admin.

## Requests
- The `requests` app lives in the `customer_requests` package (label `requests`) so it doesn't shadow the PyPI `requests` library.
- Closing an already closed query, or responding to a closed one, returns 409; open and responded queries can be closed.
- A response's `offer_ids` must be currently bookable.

## Bookings
- An offer that isn't bookable or visible returns 400 on `offer`; a second active booking of it returns 409.
- A booking's optional `query` must be the customer's own. `POST /bookings` is customers only; the admin books through `POST /admin/bookings`, and the duplicate message then names the customer.
- A move by the wrong actor returns 409 like any invalid move; confirm-availability and mark-unavailable return 409 for impossible moves before validating their body.
- Marking paid exactly at the deadline is allowed. Scheduled expiry re-checks the status under the lock.
- Customer booking detail includes `payment_instructions` only while `availability_confirmed`, and no `boarding_passes` key until completed.
- The timeline shows statuses and times, not the actor.
- Stale requests get the same "booking expired" email as lapsed payment holds. The reminder is skipped if the booking is no longer awaiting payment or the deadline has passed.
- Payment hold and reminder hours must be at least 1; settings accept GET and PATCH only.
- Confirm availability always sends the dialog's price and stops; the server records only values that differ. Accepting changes is not a status change and adds no timeline event. The payment deadline runs from confirmation, including while changes await acceptance.
- Mark unavailable sends the message only together with suggested options. Its offer search starts from the booking's route and departure date, any class.
- Bookings return their own stops and `stop_count` next to the nested offer.
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
- React Navigation, not Expo Router.
- The selected item is a route parameter of its list (e.g. `/bookings/<id>`), so the list stays mounted; Explore's URL is `/offers` (`/` also opens it). Opening a detail replaces the history entry.
- Offer detail opens in Explore's drawer, including from a request's response; its price summary is sticky on the right when the detail is ≥ 640 px wide.
- Lists show tables only on wide screens with no detail open; otherwise cards. Explore switches to its narrow layout while a detail is open.
- Explore's From/To send the airport code when picked, otherwise the typed text. Filter chips apply at once, prices on Enter or blur, the search bar on Search; "Clear all" clears the sidebar only.
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
