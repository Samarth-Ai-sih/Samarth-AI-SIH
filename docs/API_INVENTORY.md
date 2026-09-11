# API inventory

This is a source-derived inventory of FastAPI routes registered by
`backend/app/main.py`. Route behaviour must still be verified against a live,
configured environment before release. Health, public-citizen, and the
deliberately public authentication entry routes are exceptions; protected
resources apply server-side permission and jurisdiction checks. A `404` is
used for out-of-scope resources where appropriate to avoid IDOR disclosure.

## Authentication and health

| Method | Endpoint | Access / purpose |
| --- | --- | --- |
| `GET` | `/health` | Public liveness probe |
| `GET` | `/ready` | Public dependency readiness probe |
| `GET` | `/api/v1/health` | Public versioned health response |
| `POST` | `/api/v1/auth/login` | Public, rate-limited login; access token plus HttpOnly refresh cookie |
| `POST` | `/api/v1/auth/logout` | Authenticated, CSRF-protected session revocation |
| `POST` | `/api/v1/auth/refresh` | Refresh-cookie and CSRF-protected token rotation |
| `GET` | `/api/v1/auth/me` | Authenticated profile and jurisdiction |
| `POST` | `/api/v1/auth/password-change` | Authenticated password change and session revocation |
| `GET` | `/api/v1/auth/sessions` | Authenticated active-session list |
| `POST` | `/api/v1/auth/sessions/revoke-all` | Authenticated, CSRF-protected global session revocation |

## Work lifecycle, users, and CSV ingestion

`/api/v1/works` requires work/payment permissions; writes are audit logged and
scope constrained. `/api/v1/users` is administrator-only. Every ingestion
route requires `UPLOAD_CSV`; uploads undergo size, content, encoding, mapping,
validation, duplicate, and import checks.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/works` | Filtered, paginated, sorted work queue |
| `GET` | `/api/v1/works/map` | Paginated stored work markers, with server-enforced jurisdiction/task scope, filters, optional GeoJSON bounding box, and permission-redacted financial/risk fields |
| `POST` | `/api/v1/works` | Create a work |
| `GET` | `/api/v1/works/{work_id}` | Scoped work detail |
| `GET` | `/api/v1/works/{work_id}/360` | Scoped Work 360° view |
| `PATCH` | `/api/v1/works/{work_id}` | Update permitted work fields |
| `PATCH` | `/api/v1/works/{work_id}/status` | Controlled lifecycle transition |
| `DELETE` | `/api/v1/works/{work_id}` | Soft cancel a work |
| `GET` | `/api/v1/works/{work_id}/timeline` | Work audit timeline |
| `POST` / `GET` | `/api/v1/works/{work_id}/payments` | Add / list payment tranches |
| `POST` / `GET` | `/api/v1/works/{work_id}/progress` | Add / list physical-progress updates |
| `GET` / `POST` | `/api/v1/users` | Administrator user list / create user |
| `GET` | `/api/v1/users/{user_id}` | Administrator user detail |
| `PATCH` | `/api/v1/users/{user_id}/role` | Administrator role and jurisdiction update |
| `PATCH` | `/api/v1/users/{user_id}/status` | Administrator activation update |
| `POST` | `/api/v1/ingestion/upload` | Upload a reference CSV |
| `GET` | `/api/v1/ingestion/batches` | List import batches |
| `GET` | `/api/v1/ingestion/batches/{batch_id}` | Import batch detail |
| `GET` | `/api/v1/ingestion/batches/{batch_id}/preview` | Mapped-row preview |
| `PUT` | `/api/v1/ingestion/batches/{batch_id}/mapping` | Amend explicit column mapping |
| `POST` | `/api/v1/ingestion/batches/{batch_id}/validate` | Validate staged rows |
| `POST` | `/api/v1/ingestion/batches/{batch_id}/import` | Import valid staged rows |
| `POST` | `/api/v1/ingestion/batches/{batch_id}/retry` | Retry a failed batch |
| `GET` | `/api/v1/ingestion/batches/{batch_id}/invalid` | Invalid-row export |
| `GET` | `/api/v1/ingestion/stats` | Import collection statistics |

## Rules, risk, ML, financial intelligence, and possible duplicates

These routes are decision support only. Risk and model outputs include frozen
feature/explanation snapshots, scores, versions, and provenance; they are not
legal or misconduct determinations. Financial results derive from scoped work
records, not allocation CSV assumptions.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/compliance/rules` | List latest rule versions |
| `GET` | `/api/v1/compliance/rules/{rule_id}` | Rule detail |
| `POST` | `/api/v1/compliance/rules` | Create a rule |
| `PATCH` | `/api/v1/compliance/rules/{rule_id}` | Versioned rule update |
| `POST` | `/api/v1/compliance/rules/seed` | Seed default rules (privileged) |
| `POST` | `/api/v1/compliance/run/{work_id}` | Run one scoped compliance check |
| `POST` | `/api/v1/compliance/run` | Batch check in caller scope |
| `GET` | `/api/v1/compliance/results` | Filtered compliance outcomes |
| `GET` | `/api/v1/compliance/results/{result_id}` | Scoped result detail |
| `PATCH` | `/api/v1/compliance/results/{result_id}/review` | Record human review state |
| `POST` | `/api/v1/risk/score/{work_id}` | Calculate and persist a composite score |
| `POST` | `/api/v1/risk/score` | Score an explicitly supplied work ID |
| `POST` | `/api/v1/risk/batch` | Batch-score scoped works |
| `POST` | `/api/v1/risk/predictions/{work_id}` | Persist delay/anomaly prediction or labelled fallback |
| `GET` | `/api/v1/risk/predictions/{work_id}` | Latest scoped prediction |
| `GET` | `/api/v1/risk/models` | Versioned model registry |
| `POST` | `/api/v1/risk/models/{model_version}/approve` | Approve a reviewed model |
| `POST` | `/api/v1/risk/models/{model_type}/rollback` | Roll back to an approved model |
| `GET` | `/api/v1/risk/distribution` | Latest tier distribution |
| `GET` | `/api/v1/risk` | Paginated scoped alert centre |
| `GET` | `/api/v1/risk/{work_id}` | Latest scoped score and explanation |
| `GET` | `/api/v1/financial-intelligence/filters` | Scoped dashboard filter values |
| `GET` | `/api/v1/financial-intelligence/dashboard` | Financial/physical comparisons and review-priority trends |
| `POST` | `/api/v1/duplicates/scan` | Run scoped possible-duplicate scan |
| `GET` | `/api/v1/duplicates` | Paginated possible-match explorer |
| `GET` | `/api/v1/duplicates/clusters` | Candidate clusters |
| `GET` | `/api/v1/duplicates/{match_id}` | Split-screen comparison |
| `POST` | `/api/v1/duplicates/{match_id}/cases` | Open a manual-review case |
| `POST` | `/api/v1/duplicates/{match_id}/mark-not-duplicate` | Record a human non-duplicate finding |
| `POST` | `/api/v1/duplicates/{match_id}/request-field-verification` | Request field verification |

## Evidence, cases, inspections, and notifications

Evidence is private and requires evidence permissions. The production upload
path is signed Cloudinary; local files are a non-production demo fallback only.
Case reads/writes are role-specific (District Authority/admin management,
limited State/MoSPI review, and assigned-inspector task access). Required
reason fields govern reject, override, downgrade, resolution, escalation, and
reopen actions.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/evidence/upload-signature` | Issue an authorized signed upload request |
| `POST` | `/api/v1/evidence/local-upload` | Non-production local demo verification |
| `POST` | `/api/v1/evidence/cloudinary-complete` | Verify completed private provider upload |
| `POST` | `/api/v1/evidence/scan/cross-project` | Private cross-project image-hash scan |
| `GET` | `/api/v1/evidence` | Scoped private evidence outcomes |
| `GET` | `/api/v1/evidence/{evidence_id}` | One scoped private outcome |
| `POST` / `GET` | `/api/v1/cases` | Create / list cases |
| `GET` | `/api/v1/cases/notifications` | District inspection notifications |
| `GET` | `/api/v1/cases/assigned` | Current inspector's task list |
| `GET` | `/api/v1/cases/assigned/{case_id}/task` | Assigned private task/work context |
| `POST` | `/api/v1/cases/assigned/{case_id}/report` | Idempotent inspection submission |
| `GET` | `/api/v1/cases/{case_id}` | Scoped authority case detail |
| `GET` | `/api/v1/cases/{case_id}/assignees` | Eligible assignee list |
| `POST` | `/api/v1/cases/{case_id}/acknowledge` | Acknowledge a case |
| `POST` | `/api/v1/cases/{case_id}/begin-review` | Start review |
| `POST` | `/api/v1/cases/{case_id}/comments` | Append comment |
| `POST` | `/api/v1/cases/{case_id}/request-clarification` | Request clarification |
| `POST` | `/api/v1/cases/{case_id}/request-documents` | Request documents |
| `PUT` | `/api/v1/cases/{case_id}/owner` | Assign owner |
| `PUT` | `/api/v1/cases/{case_id}/inspector` | Assign inspector |
| `PUT` | `/api/v1/cases/{case_id}/corrective-plan` | Create corrective plan |
| `PUT` | `/api/v1/cases/{case_id}/due-date` | Set due date |
| `PUT` | `/api/v1/cases/{case_id}/severity` | Change severity |
| `POST` | `/api/v1/cases/{case_id}/resolve` | Resolve with reason |
| `POST` | `/api/v1/cases/{case_id}/reject` | Reject/false-positive with reason |
| `POST` | `/api/v1/cases/{case_id}/escalate` | Escalate with reason |
| `POST` | `/api/v1/cases/{case_id}/reopen` | Reopen with reason |
| `POST` | `/api/v1/cases/{case_id}/override` | Record governed override |
| `GET` | `/api/v1/background/jobs` | Admin/MoSPI durable-job list |
| `GET` | `/api/v1/background/jobs/{job_id}` | Admin/MoSPI job detail |
| `POST` | `/api/v1/background/jobs/{job_type}` | Admin idempotent job trigger |
| `POST` | `/api/v1/background/manual-escalation` | District/admin queue-independent escalation fallback |
| `GET` | `/api/v1/background/notifications` | Current-user privacy-safe notifications |
| `PUT` | `/api/v1/background/notifications/{notification_id}/read` | Mark notification read |
| `GET` / `PUT` | `/api/v1/background/notification-preferences` | Read / update delivery preferences |

## Citizen public surface and restricted moderation

Public routes never delegate to authenticated internal work, risk, case, or
evidence response schemas. They return explicit allow-list projections. Public
issue evidence is private, uses a one-time capability, and is not returned by
tracking endpoints.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/public/works` | Public-safe work search |
| `GET` | `/api/v1/public/works/qr` | Public QR work lookup |
| `GET` | `/api/v1/public/works/{work_id}` | Public-safe work detail |
| `GET` | `/api/v1/public/verification-challenge` | Short-lived demo human-verification challenge |
| `POST` | `/api/v1/public/issues` | Rate-limited anonymous ground issue |
| `POST` | `/api/v1/public/issues/{reference_id}/evidence` | One optional private issue photo |
| `GET` | `/api/v1/public/issues/{reference_id}` | Minimal public status tracking |
| `GET` | `/api/v1/citizen-reports` | District/admin/MoSPI/State moderation queue |
| `GET` | `/api/v1/citizen-reports/{reference_id}` | Restricted moderation detail |
| `PUT` | `/api/v1/citizen-reports/{reference_id}/status` | Controlled moderation transition |

## Validation record

The route paths above were extracted statically from the router decorators on
9 September 2026. The backend test suite can run in the isolated Python 3.11
environment, but a live OpenAPI request and Mongo-backed smoke test still
require configured database/Redis services. No Docker engine is available on
this workstation to start the pinned backend image. See `README.md` and
`DEPLOYMENT.md` for the supported environment and operational checks.

The imported FastAPI application currently registers 102 OpenAPI paths (118
method routes, including framework `HEAD` routes). This count is a source
sanity check, not a substitute for deployment smoke tests.
