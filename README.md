# Azaria Bookings

Flight-offerings and booking portal for a Nairobi travel agency. Django REST API in `backend/`, Expo (web-first) app in `frontend/`.

## Decisions

- Emails are stored lowercased; login, registration and password reset match emails case-insensitively.
- Registration requires `phone`; the `create_admin` command does not take a phone, so the model allows it blank.
- Logout is client-side only (tokens are discarded); no JWT blacklist table.
- Throttling (10/min per IP) uses Django's default local-memory cache, so counts are per server process. The password-reset request and confirm endpoints share one limit.
- `GET /api/airports` with an empty `search` returns an empty list.
- Python 3.12+ is supported; the development virtualenv runs Python 3.14 (Django 6.1).
- Email settings use Django 6.1's `MAILERS` setting (console backend when `EMAIL_HOST` is empty, SMTP otherwise).
- Plain-text email templates render through a separate template engine with autoescaping off, so links are not HTML-escaped.
- Offering airports are written by id and returned as nested airport objects.
- Airport text filters on offerings match the code case-insensitively and exactly; city, country and name match by "contains".
- "valid_until >= today" is enforced on offering create only; edits re-check the other rules against the stored values.
- Offering detail returns any active public offering, with an `is_bookable` flag; only browse is limited to bookable ones.
- The admin offering list includes every offering (private, deactivated and lapsed), filterable by `is_active` and `is_public`.
- The frontend uses React Navigation as the spec requires, not Expo Router (which `frontend/AGENTS.md` suggests).
- Explore's From/To send the chosen airport's code when picked from the suggestions, otherwise the typed text.
- Explore and the admin offerings list apply filters on "Search"/"Apply filters", not on every keystroke.
