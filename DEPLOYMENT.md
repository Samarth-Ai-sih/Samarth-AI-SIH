# Deployment guide

SAMARTH AI is a prototype deployment of a Next.js frontend, FastAPI API,
MongoDB database, Redis/Celery workers, and optional Cloudinary signed uploads.
It is not an official Government of India service and must not be presented as
one.

## Configuration

Copy the configuration template appropriate to the environment; supply actual
secret values through the deployment platform's secret store, not source
control.

```powershell
Copy-Item .env.example .env                         # local development
Copy-Item .env.staging.example .env.staging          # staging reference
Copy-Item .env.production.example .env.production    # production reference
```

Production startup fails closed unless it has explicit HTTPS CORS origins,
`DEBUG=false`, a MongoDB Atlas SRV URI, and non-placeholder Cloudinary
credentials. It also needs a 64+ character JWT secret, separate CSRF secret,
TLS Redis URI, and `TRUST_PROXY_HEADERS=true` **only** behind a reverse proxy
that overwrites forwarded headers. Configure `COOKIE_DOMAIN` only when the
frontend and API are served on an intentional shared parent domain.

## Docker Compose

Atlas is the default database target:

```powershell
docker compose up --build
docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

For the self-contained local/demo fallback (MongoDB, Redis, API, frontend,
Celery worker, and scheduler), use:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

The browser uses same-origin `/api/*`; the Next.js container proxies those
requests to the private `backend` service. Do not expose Redis publicly. Place
production frontend traffic behind a TLS-terminating reverse proxy/load
balancer, restrict Atlas network access to application egress addresses, and
use managed Redis with authentication/TLS when not using the local stack.

## Managed service deployment

Use one service each for the API, Celery worker, and Celery Beat, plus a Next.js
web service. Set the same backend environment values for all three Python
services. Start commands are:

```bash
# API
uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --workers 2
# Worker
celery -A app.celery_app:celery_app worker --loglevel=info --concurrency=4 -Q default,scoring,notifications,escalation,evidence
# Scheduler (exactly one replica)
celery -A app.celery_app:celery_app beat --loglevel=info
# Frontend
node server.js
```

Configure the web service's `/api/*` traffic to reach the API, either through
the Next.js rewrite used here or a private platform service URL. Set
`CORS_ORIGINS` to the exact public frontend origin(s); never use `*` with
cookies.

Cloudinary is required in production. With all three `CLOUDINARY_*` values
set, the API creates short-lived authenticated upload signatures and verifies
the completed provider asset server-side. When they are unset in development
or staging, the private local demo upload fallback is available; production
startup rejects that configuration because it is not durable object storage.

## Database bootstrap, migration, and seed

MongoDB is schemaless; application startup creates the required indexes.
Deploy new versions before data migration work and take a backup first. The
current prototype has no irreversible schema migration scripts.

```powershell
cd backend
python -m scripts.seed_users
python -m scripts.seed_works
python -m scripts.seed_evidence
# Optional reference CSV import; repeat-safe by source hash
python scripts/seed_csv.py
```

All synthetic seed scripts are non-destructive: they preflight target
collections and leave a nonempty database unchanged. Use a new, empty
development/staging database for `seed_works`, `seed_evidence`, or
`generate_training_dataset`. `seed_users` and `seed_csv` are idempotent.
`seed_users` requires every `SEED_*_EMAIL` and `SEED_*_PASSWORD` value in the
environment and has no source-code credential defaults. Never seed demo
credentials or synthetic records in a production database.

## Smoke checks and rollback

```powershell
Invoke-WebRequest http://localhost:8000/health
Invoke-WebRequest http://localhost:8000/ready
Invoke-WebRequest http://localhost:3000/api/health

# With a deployed non-production URL:
$env:DEPLOYMENT_API_URL = "https://api.example.invalid"
$env:DEPLOYMENT_WEB_URL = "https://app.example.invalid"
python backend/scripts/deployment_smoke_test.py
```

Promote an immutable, tested image between environments. Roll back the API,
worker, scheduler, and frontend to the previously known-good image together;
do not restore a database backup solely to roll back stateless application
code. See [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) and
[INCIDENT_RESPONSE_RUNBOOK.md](INCIDENT_RESPONSE_RUNBOOK.md) for data and
security incidents.
