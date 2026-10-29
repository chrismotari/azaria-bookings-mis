# Azaria Bookings

Monorepo: Django REST API in `backend/`, Expo (React Native, web-first) app in `frontend/`.

The full specification is in @SPEC.md. Treat it as the source of truth.

## Working rules
- Work on one delivery step at a time, in the order given in SPEC.md. Do not start the next step until I say so.
- Commit after each completed step with a clear message.
- Do not add anything the spec does not describe: no extra models, endpoints, fields or dependencies.
- If the spec is ambiguous, pick the simplest option and add one line to "Decisions" in README.md.
- No Docker. PostgreSQL and Redis run locally.

## Commands
- API: `cd backend && python manage.py runserver`
- Worker: `cd backend && celery -A config worker -l info` (add `--pool=solo` on Windows)
- Beat: `cd backend && celery -A config beat -l info`
- Web app: `cd frontend && npx expo start --web`
- Backend tests: `cd backend && pytest`
- Frontend checks: `cd frontend && npx tsc --noEmit`