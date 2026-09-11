# Data inventory and provenance boundaries

This inventory distinguishes static reference files, controlled synthetic
records, and live operational collections. It is a design and source review,
not a claim that a MongoDB deployment currently contains any of these records.

## Reference allocation CSVs

| Canonical file | Raw rows | Valid rows expected by the ingestion tests | SHA-256 prefix | Purpose |
| --- | ---: | ---: | --- | --- |
| `data/Allocated Limit for Honble MPs (1).csv` | 544 | 543 | `db419a582d351bdd` | Lok Sabha allocation-limit reference data |
| `data/Allocated Limit for Honble MPs (2).csv` | 232 | 231 | `c42cb2a25b79abb7` | Rajya Sabha allocation-limit reference data |

Each file has a byte-identical convenience copy in the repository root. The
blank terminal row accounts for the raw/valid difference; the source review
found no exact duplicate data rows. `scripts.seed_csv` imports the canonical
`data/` copies through the same mapping/validation service as the API.

These allocation limits are stored separately in `mp_allocations` and related
reference collections. They must never be treated as evidence that a work was
sanctioned, paid, completed, delayed, or irregular.

## Synthetic-only generators

| Generator | Target records | Provenance marker | Write safety |
| --- | --- | --- | --- |
| `scripts.seed_works` | Controlled work, progress, payment, and timeline scenarios (address-only; no fabricated site coordinates) | `data_source=synthetic_demo` | Refuses a nonempty `works` collection |
| `scripts.seed_evidence` | Six controlled private evidence scenarios | `demo_seed=true` | Refuses when prior demo evidence exists |
| `scripts.generate_training_dataset` | Synthetic MPLADS-style ML training/evaluation records | `data_source=synthetic_ml_training` on generated works | Refuses if any target collection is occupied |

Synthetic model labels (`_anomaly_tags`) are training/evaluation inputs only;
the inference feature engineering path does not use them as live features.
Reported model metrics are limited to the persisted synthetic holdout results.

## Operational MongoDB collections

| Collection family | Authoritative responsibility |
| --- | --- |
| `works`, `progress_updates`, `payment_tranches` (embedded), `audit_logs` | Work lifecycle and immutable history |
| `import_batches`, `states`, `constituencies`, `mps`, `mp_allocations` | Uploaded reference data and import evidence |
| `compliance_rules`, `compliance_results`, `risk_scores`, `model_registry`, `model_predictions` | Rules, explainable scoring, and versioned model outputs |
| `duplicate_detection_scans`, `duplicate_work_matches`, `duplicate_work_clusters`, `duplicate_work_cases` | Manual-review duplicate-work signals |
| `evidence_metadata`, `evidence_duplicate_image_matches` | Private metadata/hash outcomes; raw private media is not public API data |
| `cases`, `inspection_reports`, `case_notifications`, `citizen_issues` | Authority, inspector, and citizen workflow records |
| `background_jobs`, `notifications`, `notification_preferences`, `notification_deliveries` | Durable processing and privacy-safe delivery state |

## Handling rules

- MongoDB is the application source of truth; cached dashboard values are
  derived, not primary workflow records.
- Internal APIs apply permission and jurisdiction constraints. The public API
  uses separate response projections and does not expose internal cases, risk,
  evidence, private location, agency-sensitive details, or restricted finance.
- No source in this repository asserts that reference CSVs or synthetic data
  are official Government of India operational data.
