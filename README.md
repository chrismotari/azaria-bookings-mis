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
