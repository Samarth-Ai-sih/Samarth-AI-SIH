# SAMARTH AI

**MPLADS Risk Intelligence & Assurance Platform**

> Detect Early. Verify on Ground. Deliver Public Assets on Time.

**Team Parallaxes** — Smart India Hackathon 2026 (SIH26102)

---

## Overview

SAMARTH AI is an explainable intelligence and assurance layer for MPLADS-style public works. It ingests project data, detects potential risks via ML and rule-based engines, explains signals to officials, routes cases for review, and maintains a complete audit trail.

> **Disclaimer:** SAMARTH AI is a Smart India Hackathon prototype developed by Team Parallaxes. It provides data-driven decision-support signals to assist human review. Alerts do not constitute a final determination of misconduct or non-compliance.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Backend | FastAPI, Python, Pydantic v2 |
| Database | MongoDB Atlas (Motor async driver) |
| Cache | Redis |
| Task Queue | Celery |
| ML | XGBoost, Isolation Forest, SHAP, TF-IDF |
| Storage | Cloudinary (signed uploads) |
| Deployment | Docker, Docker Compose, Vercel, Render |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Python 3.11–3.12 (the pinned backend stack and Docker image are validated on these versions)
- Docker & Docker Compose
- MongoDB Atlas account
- Cloudinary account

### 1. Clone and configure

```bash
git clone <repo-url>
cd <repository-directory>
cp .env.example .env
# Edit .env with your MongoDB Atlas URI, JWT secret, and Cloudinary credentials
```

### 2. Run with Docker Compose (recommended)

```bash
docker compose up --build
```

This starts:
- **Backend** at http://localhost:8000
- **Frontend** at http://localhost:3000
- **Redis** at localhost:6379
- **Celery worker** (background tasks)

For a fully local synthetic demo that does not require Atlas, use the local
MongoDB fallback instead:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

### 3. Run without Docker

#### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

#### Redis (required for Celery)
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

---

## Health Checks

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe — is the server running? |
| `GET /ready` | Readiness probe — are MongoDB and Redis available? |
| `GET /api/v1/health` | Versioned health check |
| `GET /docs` | Swagger UI (development only) |

---

## Phase 9: model training and controlled inference

The backend includes a reproducible Phase 9 training and inference pipeline
for the synthetic MPLADS-style records.  It trains an XGBoost delay classifier
and an Isolation Forest for unusual financial/execution patterns.  The latter
is an anomaly signal only: it does not predict or determine wrongdoing.

From `backend/`, run the training commands after seeding the synthetic data:

```bash
python -m app.ml.train_delay_model
python -m app.ml.train_anomaly_model
python -m app.ml.evaluate_models --model-version <registered-version>
```

Each run stores its artifact metadata in MongoDB's `model_registry` collection
with `pending_approval` status.  An administrator must explicitly approve a
version before it can be used by live inference.  `model_predictions` stores
the model version, input feature snapshot, explanation snapshot, triggered
rule references, and timestamp for every prediction.  If an approved artifact
is absent or cannot be loaded, the API persists an explicitly labelled
`deterministic_heuristic_fallback` instead; it is not presented as an ML
prediction.

Reported precision, recall, F1, ROC-AUC, confusion matrix, importance data,
and SHAP availability are measurements from the recorded synthetic holdout
only.  They are not claims of operational accuracy.

---

## Phase 10: financial intelligence

The protected financial dashboard is available at `/dashboard/financial` and
reads its data only from the FastAPI endpoints below, which in turn calculate
their response from jurisdiction-scoped MongoDB `works` documents:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/financial-intelligence/filters` | Available state, district, category, status, and agency filters in the caller's scope. |
| `GET /api/v1/financial-intelligence/dashboard` | Financial totals, charts, peer benchmarks, tables, agency ranking, and amount-at-risk trend. |

The dashboard uses Apache ECharts for the financial/physical progress scatter,
payment-tranche timeline, peer benchmark comparison, and amount-at-risk trend.
It uses transparent review criteria: a cost outlier needs at least five peers
and a sanctioned amount at least 1.5× its category median; a high-spend/
low-progress signal requires financial progress of at least 70% and physical
progress of at most 35%. The amount-at-risk figure is a review-priority amount
based on actual expenditure weighted by the excess financial-versus-physical
gap. It is not an estimate of loss.

All such signals are labelled **Possible financial irregularity** and
**Requires verification**. They are not conclusive determinations of
misconduct or non-compliance.

---

## Phase 11: possible duplicate-work detection

The protected duplicate-work explorer is available at `/dashboard/duplicates`.
It reads from FastAPI and jurisdiction-scoped MongoDB work and evidence records
only. A manual scan stores a frozen rule snapshot, explainable candidate
signals, and connected clusters; the comparison view provides a side-by-side
record review and a coordinate-only map sourced from stored locations.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/duplicates/scan` | Run and persist a scoped TF-IDF/cosine possible duplicate-work scan. |
| `GET /api/v1/duplicates` | Explore matches from the current scan. |
| `GET /api/v1/duplicates/clusters` | List connected candidate clusters. |
| `GET /api/v1/duplicates/{match_id}` | Retrieve the split-screen comparison payload. |
| `POST /api/v1/duplicates/{match_id}/cases` | Create a manual review case. |
| `POST /api/v1/duplicates/{match_id}/mark-not-duplicate` | Record that review found distinct works. |
| `POST /api/v1/duplicates/{match_id}/request-field-verification` | Request on-site verification. |

The configurable default rule requires TF-IDF/cosine text similarity of at
least 0.82, a Haversine distance of at most 300m when GeoJSON distance is not
available, same or similar category, a comparable sanctioned-cost range (30%
by default), and timeline overlap or the same financial year. Same
agency/vendor and shared evidence-photo hash signals are recorded as additional
context. Every alert says **Possible Duplicate Work — Manual Verification
Required.**

---

## Phase 12: evidence verification

The internal evidence-verification workspace is available at
`/dashboard/evidence`. It is available only to roles with `READ_EVIDENCE`;
citizen accounts have no evidence permission. API responses deliberately omit
the image itself, its storage reference, original filename, raw GPS
coordinates, and signed delivery URLs.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/evidence/upload-signature` | Issue a short-lived authenticated Cloudinary signature, or controlled local demo-upload instructions when Cloudinary is unset. |
| `POST /api/v1/evidence/local-upload` | Upload a local demo image and run server-side verification. |
| `POST /api/v1/evidence/cloudinary-complete` | Fetch a completed authenticated provider asset server-side and verify it. |
| `GET /api/v1/evidence` | List jurisdiction-scoped private verification outcomes. |
| `POST /api/v1/evidence/scan/cross-project` | Compare stored perceptual hashes across projects. |

For accepted image bytes, the service stores SHA-256, a 64-bit DCT perceptual
hash, selected EXIF field names, extracted GPS/timestamp facts, distance from
the project location, and a review label. Cross-project pHash matches create a
possible-reuse signal without returning either image. Review labels are
decision-support prompts: **Verified metadata available**, **Metadata
unavailable — manual verification required**, **GPS mismatch — verification
recommended**, **Timestamp inconsistency — verification recommended**, and
**Possible reused evidence — manual verification required**.

To seed the six controlled demo scenarios after work data exists:

```bash
cd backend
python -m scripts.seed_evidence
```

The script creates a normal valid site image, two near-duplicate project
images, a GPS-distance mismatch, an inconsistent timestamp, and an image with
no metadata. These assets use the private local demo store and are never
served by the application.

---

## Phase 13: case management and field inspection

The protected case workspace at `/dashboard/cases` implements the District
Authority review workflow. Inspectors see only their assigned tasks at
`/dashboard/inspections`; task access is additionally checked against both the
assigned inspector and the inspector's server-side task list.

| Endpoint | Purpose |
|---|---|
| `POST`, `GET /api/v1/cases` | Create and list jurisdiction-scoped cases. |
| `GET /api/v1/cases/{case_id}` | Read a case for authorized authority review. |
| `POST`/`PUT /api/v1/cases/{case_id}/…` | Record lifecycle, assignment, request, severity, plan, comment, resolution, rejection, escalation, reopening, or override actions. |
| `GET /api/v1/cases/assigned` | List only the current inspector's assigned tasks. |
| `GET /api/v1/cases/assigned/{case_id}/task` | Retrieve the private work context required for a field inspection. |
| `POST /api/v1/cases/assigned/{case_id}/report` | Persist an idempotent field report, private evidence references, risk recalculation, authority notifications, and audit events. |

Cases use the lifecycle **New → Acknowledged → Under Review → Clarification
Requested → Inspection Assigned → Evidence Submitted → Corrective Action
Planned → Resolved**, with **Rejected / False Positive**, **Escalated**, and
**Reopened** as controlled alternative states. Resolution, rejection,
escalation, reopening, overrides, and severity downgrades require a reason.

An inspector submission includes the required field checklist, optional GPS
and capture timestamp, remarks, and only Phase 12 evidence verification IDs.
Raw GPS and private files stay in restricted persistence and are not sent in
District Authority case responses. The inspector UI provides signed photo
uploads, a private coordinate map, a navigation link, and a device-local
offline report queue. Queued photos are intentionally not stored in browser
storage; they must be uploaded over the signed flow when connectivity returns.

---

## Phase 14: citizen portal and social audit

The unauthenticated citizen portal is available at `/public`. It uses only the
separate `/api/v1/public` API surface, not the authenticated internal work,
risk, case, payment, evidence, or investigation APIs. Citizens can search
public-safe works by pincode, district, constituency, work ID, category, MP
name, or keywords; look up a work from a QR payload or supported browser QR
image scan; submit an anonymous ground issue; optionally attach one private
photo; optionally share location only after consent; and track a generated
reference ID.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/public/works` | Public-safe work search. |
| `GET /api/v1/public/works/{work_id}` | Public-safe work detail. |
| `GET /api/v1/public/works/qr` | Resolve a `SAMARTH:work-id` or public-URL QR payload. |
| `GET /api/v1/public/verification-challenge` | Short-lived server-validated demo human-verification challenge. |
| `POST /api/v1/public/issues` | Submit an anonymous ground issue and receive a reference ID. |
| `POST /api/v1/public/issues/{reference_id}/evidence` | Attach one optional private image using a short-lived, one-time capability. |
| `GET /api/v1/public/issues/{reference_id}` | Track public report status. |
| `GET`/`PUT /api/v1/citizen-reports…` | Restricted District Authority moderation, scoped to jurisdiction. |

Ground issue types are **Work not started**, **Work appears stopped**, **Asset
not visible**, **Quality concern**, **Incorrect information**, and **Other**.
Moderation follows **Received → Under Review → Inspection Assigned → Resolved
/ Closed**; terminal resolution or closure requires an internal moderation
reason. Public tracking returns only its reference, work identity, issue type,
public status message, timestamps, and whether evidence was received.

The public schemas are explicit allow-lists. They never return internal risk
scores, implementing-agency or sensitive contract data, investigation notes,
citizen identity/contact data, restricted financial values, raw location, or
private photos/documents. Citizen accounts also no longer receive permission
to the legacy internal work API; route-level tests assert `403` responses from
both internal case and risk endpoints.

---

## Phase 16: background processing and notifications

Celery uses Redis as its broker and result backend. A `celery-worker` consumes
the `default`, `scoring`, `evidence`, `notifications`, and `escalation` queues;
`celery-beat` dispatches idempotent periodic jobs. MongoDB retains each job's
status, attempts, safe error summary, payload/result snapshot, and Celery task
ID beyond the short Celery result TTL.

| Job | Trigger |
|---|---|
| Scheduled data ingestion | Every 6 hours or an administrator request. |
| Batch risk scoring and alert generation | Every 4 hours. |
| SLA monitoring and automatic escalation | Hourly. |
| EXIF/pHash refresh | Per authorized evidence-processing request. |
| Duplicate-work scan | Nightly. |
| Notification delivery | Every 5 minutes. |
| Operational report generation and model monitoring | Nightly. |

Tasks acknowledge late, track starts, retry failures with jittered exponential
backoff, and use a MongoDB idempotency key. Risk scoring also stores a
per-work operation key, so a worker retry cannot append a second score for the
same job/work operation. External adapters are deliberately no-ops until a
vetted delivery provider is enabled in environment configuration; the safe
in-app notification is always recorded separately.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/background/jobs` | List durable processing jobs (admin/MoSPI). |
| `POST /api/v1/background/jobs/{job_type}` | Queue an administrator-approved job with an `Idempotency-Key`. |
| `POST /api/v1/background/manual-escalation` | Immediate District Authority/admin demo fallback when queue delivery is unavailable. |
| `GET /api/v1/background/notifications` | Current user's in-app notification centre. |
| `PUT /api/v1/background/notifications/{id}/read` | Mark a notification as read. |
| `GET`/`PUT /api/v1/background/notification-preferences` | Manage in-app/email/SMS/WhatsApp preferences. |

Escalation is routed **District Authority → State Nodal Authority → MoSPI /
Ministry**. Notification payloads intentionally contain only a generic
workflow prompt; they never contain citizen identity, private evidence,
coordinates, free-text case reasoning, or sensitive financial context.

For non-Docker local execution, run both processes after Redis is available:

```bash
cd backend
celery -A app.celery_app:celery_app worker --loglevel=info -Q default,scoring,notifications,escalation,evidence
celery -A app.celery_app:celery_app beat --loglevel=info
```

## Phase 17: comprehensive testing and security hardening

The backend suite covers deterministic scoring and model inference, anomaly and
duplicate detection, evidence metadata, RBAC and jurisdiction boundaries, CSV
validation, work/case/inspection lifecycles, citizen moderation, and API
integration. The frontend suite covers shared components, protected routes,
role navigation, dashboard states, forms, and public privacy projections. An
opt-in Playwright contract exercises the District Authority → Inspector →
Citizen workflow against a dedicated test deployment.

Run the checks locally:

```bash
cd backend
python -m pytest -q
cd ../frontend
npm run lint
npm test
npm run build
npm run test:e2e
```

The browser workflow is skipped unless `E2E_ALLOW_MUTATIONS=true` and the
`E2E_BASE_URL`, `E2E_DISTRICT_EMAIL`, `E2E_DISTRICT_PASSWORD`,
`E2E_INSPECTOR_EMAIL`, `E2E_INSPECTOR_PASSWORD`, `E2E_INSPECTOR_ID`, and
`E2E_WORK_ID` variables are explicitly supplied. Security controls include
strict production CORS validation, secure refresh cookies, bcrypt length
guards, Redis-backed rate limits, trusted-proxy IP handling, IDOR-safe scoped
queries, upload and CSV validation, security headers, append-only audit events,
and privacy-safe notifications. Production dependency audit is run with
`npm audit --omit=dev`.

## Phase 18: deployment and final quality gate

Deployment assets now include Docker Compose for Atlas-backed environments and
a self-contained local MongoDB fallback, staging/production environment
templates, API/frontend health probes, Docker build-context secret exclusions,
and a non-mutating deployment smoke test. The Next.js frontend proxies
same-origin `/api/*` calls to the private FastAPI service; FastAPI manages
MongoDB, Redis/Celery, and optional signed Cloudinary uploads.

| Operational resource | Purpose |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environment, Compose, managed-service, seed, smoke-test, and rollback instructions. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component/data-flow diagram and trust boundaries. |
| [docs/DATA_INVENTORY.md](docs/DATA_INVENTORY.md) | Source, synthetic-demo, and runtime-data boundaries. |
| [docs/API_INVENTORY.md](docs/API_INVENTORY.md) | Endpoint, authorization, and privacy inventory. |
| [docs/FEATURE_VERIFICATION.md](docs/FEATURE_VERIFICATION.md) | Honest frontend/backend/database feature matrix and live evidence. |
| [docs/DATASET_STATUS.md](docs/DATASET_STATUS.md) | Dataset counts, lineage, idempotency, visibility, and missing-data status. |
| [docs/RECOMMENDATIONS.md](docs/RECOMMENDATIONS.md) | Explicit readiness answers, blockers, and prioritized recommendations. |
| [AUDIT_REPORT.md](AUDIT_REPORT.md) | Current verification commands, results, and external-service blockers. |
| [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) | Pre-promotion controls checklist. |
| [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) | Atlas/local-demo recovery procedure. |
| [INCIDENT_RESPONSE_RUNBOOK.md](INCIDENT_RESPONSE_RUNBOOK.md) | Security and service incident procedure. |
| [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) | Synthetic-data setup plus 3- and 5-minute demo flows. |

Use the local self-contained demo only with synthetic records:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

No public deployment URL is bundled with this repository. Atlas, Redis,
Cloudinary, TLS/domain, and hosting credentials are operator-provided. The
project is not an official Government of India deployment, does not access
government data, and provides human-review decision support only.

---

## Environment Variables

See [.env.example](.env.example) for all configuration options.

**Required:**
- `MONGODB_URI` — MongoDB Atlas connection string
- `JWT_SECRET_KEY` — Minimum 16 characters

---

## Project Structure

```
SIH 2.1/
├── backend/                  # FastAPI backend
│   ├── app/
│   │   ├── api/v1/          # API routes
│   │   ├── core/            # Config, database, logging
│   │   ├── tasks/           # Celery tasks
│   │   ├── celery_app.py    # Celery configuration
│   │   └── main.py          # FastAPI entry point
│   ├── tests/               # Pytest test suite
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                 # Next.js frontend
│   ├── src/app/             # App Router pages
│   ├── Dockerfile
│   └── package.json
├── data/                     # Reference CSV datasets
├── docker-compose.yml        # Development
├── docker-compose.local.yml  # Local MongoDB fallback
├── docker-compose.staging.yml
├── docker-compose.prod.yml
├── .env.example
├── DEPLOYMENT.md
├── DEMO_RUNBOOK.md
└── README.md
```

---

## Deployment

### Development
```bash
docker compose up --build
```

### Staging
```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build -d
```

### Production
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

---

## License

This project is a hackathon prototype. All rights reserved by Team Parallaxes.
