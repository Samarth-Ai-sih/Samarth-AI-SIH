# Feature verification matrix

Audit date: 9 September 2026. This is an evidence-based review of the
workspace and the configured development MongoDB/Redis environment. A status
is intentionally assigned exactly one value from the requested list. “Fully
implemented and verified” is reserved for a complete end-to-end check, not for
the existence of a route or screen.

## Evidence available

- Backend suite previously completed on the pinned Python 3.11 environment:
  **171 passed, 10 skipped**, with one upstream Starlette deprecation warning.
  The ten skips are MongoDB integration tests gated by
  `RUN_MONGODB_INTEGRATION_TESTS=1`.
- Frontend checks previously completed: lint pass, 11 Vitest tests pass in six
  files, production build pass (19 routes), and npm audit reports zero high
  severity production vulnerabilities.
- Live development API on `127.0.0.1:8011`: `/health` 200, `/ready` 200,
  public work search 200 with `total=0`, and protected ingestion stats 401
  without credentials.
- The configured development Atlas database contains reference imports, but
  the operational `works` collection is empty. No deployed URL is configured.
- The new source-provenance code compiles successfully with `python -m
  compileall`; its Python test rerun is pending because this environment
  rejected the required Python 3.11 execution approval.

## Module checklist

| Feature | Evidence and current boundary | Status |
| --- | --- | --- |
| Authentication and user management | FastAPI login, refresh-cookie rotation, logout, sessions, password change, and admin user APIs exist. Admin login/refresh/logout was exercised against the live API; credentials for the other roles are not supplied. | Implemented but partially working |
| Role-based access control | Permission matrix, route dependencies, and negative tests exist; protected ingestion returned 401 without a session. Cross-role live workflow was not possible without role credentials. | Implemented but partially working |
| Jurisdiction-based access | Scope helpers and scoped work/case/evidence/financial queries exist and are covered by backend tests; no multi-jurisdiction live fixture is present. | Implemented but partially working |
| Dashboard | Role-aware dashboard and API-backed cards/queues render with loading, empty, and error states. Live operational queues are empty. | Implemented but partially working |
| Dataset upload and ingestion | CSV upload, encoding/size checks, batch persistence, validation, idempotent import, and audit event are implemented. Two source files were imported into the development database. | Implemented but partially working |
| CSV preview and column mapping | Preview and mapping endpoints/service and frontend mapping primitives exist; no dedicated ingestion screen is connected in the current frontend. | Backend exists but frontend is missing |
| Dataset validation | Row-level required-field, amount, and format validation is implemented and covered by integration tests (opt-in). | Implemented but not tested |
| Invalid-row reporting | Invalid-row endpoint/service and export response exist; available imports have zero invalid rows, so a non-empty report was not exercised. | Implemented but not tested |
| Import batch history | Batch list/detail endpoints and audit events exist; no connected frontend history screen. | Backend exists but frontend is missing |
| Import retry and rollback | Retry is implemented and idempotent. A rollback endpoint/service is not present. | Implemented but partially working |
| Allocation records | `mp_allocations` has persisted imported records and unique data-hash/source-batch indexes; no public/internal record-list endpoint is exposed. | Implemented but partially working |
| MPs | `mps` contains imported Lok Sabha/Rajya Sabha reference records and indexes; retrieval is through ingestion service rather than a dedicated API/UI. | Implemented but partially working |
| States | `states` contains normalized imported reference records and indexes; no dedicated read API/UI. | Implemented but partially working |
| Districts | No authoritative district dataset/collection was imported; synthetic generators contain only controlled scenario values. | Blocked by missing data or credentials |
| Constituencies | `constituencies` contains imported normalized records and a compound uniqueness index; no dedicated read API/UI. | Implemented but partially working |
| Agencies | Agency fields exist on work/case models, but no authoritative agency registry was supplied. | Blocked by missing data or credentials |
| Projects | Work CRUD, detail, Work 360°, lifecycle, and public-safe projection exist. The live `works` collection has zero records. | Blocked by missing data or credentials |
| Project progress | Progress update APIs, timeline, and Work 360° sections exist; no persisted operational work is available for verification. | Blocked by missing data or credentials |
| Financial allocation | Financial fields and financial-intelligence service/API exist; allocation CSV values are kept separate from work facts. | Blocked by missing data or credentials |
| Fund release | Payment tranche/release fields and APIs exist; no operational work/payment records are present. | Blocked by missing data or credentials |
| Expenditure | Expenditure fields and financial gap calculations exist; no operational records are present. | Blocked by missing data or credentials |
| Complaints | Public citizen issue submission/tracking and restricted moderation APIs/UI exist with privacy projections. A valid work is required and none is currently stored. | Implemented but partially working |
| Investigations | Case lifecycle, comments, assignments, transitions, and audit events exist; no persisted case/work fixture is available for live completion. | Implemented but partially working |
| Evidence and file storage | Signed Cloudinary flow, private metadata, local demo fallback restrictions, EXIF/GPS/pHash services, and cross-project scan exist. No live evidence fixture was exercised in this audit. | Implemented but not tested |
| Payments | Tranche persistence and scoped work payment APIs exist; no operational payment records are present. | Blocked by missing data or credentials |
| Risk scoring | Deterministic rule/composite scorer persists versions, sub-scores, factors, snapshots, confidence, and action. It requires a work record; none is available in the live database. | Implemented but not tested |
| ML predictions | XGBoost/Isolation Forest training, registry, inference, explainability, and labelled deterministic fallback are implemented. No approved artifact is checked into this workspace and no live work prediction was run. | Implemented but partially working |
| Anomaly detection | Isolation Forest path and explainable non-fraud anomaly signal exist; operational data/model artifact is absent. | Implemented but partially working |
| Duplicate-work detection | TF-IDF, category/cost/time/agency signals, Haversine fallback, clusters, explorer, and manual-review actions exist; no work pairs are available live. | Implemented but not tested |
| Geospatial analysis | Work/evidence coordinates, Leaflet map, distance checks, and Haversine fallback exist; no operational coordinates are available. | Implemented but not tested |
| Reports | Analytics API/page is connected to scoped work/risk/financial data; report export remains disabled and no report artifact workflow is exposed. | Implemented but partially working |
| Search | Work/public search query parameters and frontend controls exist; live result set is empty. | Implemented but partially working |
| Filtering | Allowlisted work, risk, case, financial, and public filters exist; no non-empty live result was available. | Implemented but partially working |
| Pagination | Paginated work/risk/case/public responses and page-size bounds exist; only empty-page behavior was live-checked. | Implemented but partially working |
| Notifications | In-app notification records, privacy-safe email/SMS/WhatsApp adapters, preferences, delivery status, retries, and event routing exist. No notification event was generated from an operational case in this audit. | Implemented but not tested |
| Audit logs | Lifecycle, auth, ingestion, risk, evidence, case, and notification writes are audit-aware; live Atlas audit records were observed. No standalone audit-log frontend page exists. | Backend exists but frontend is missing |
| Admin controls | Admin user APIs, role/status changes, model approval/rollback, background job controls, and settings APIs exist; no admin user-management screen is connected. | Backend exists but frontend is missing |
| Background jobs | Celery/Redis task definitions, durable job tracking, retries/backoff, idempotency keys, manual escalation fallback, and health readiness exist. Worker execution was not run in this audit. | Implemented but not tested |
| Health and readiness checks | Live `/health` and `/ready` both returned 200; MongoDB and Redis dependencies reported ready. | Fully implemented and verified |
| Deployment configuration | Docker Compose, local fallback, environment templates, health probes, and deployment/runbook docs exist. No staging/production URL or deployed smoke test is configured. | Implemented but not tested |

## What is not claimed

Reference allocation data and generated works are not official government data.
Signals are decision support and require human review. No feature determines
fraud, misconduct, or legal liability. Synthetic labels are not used as live
inference features.
