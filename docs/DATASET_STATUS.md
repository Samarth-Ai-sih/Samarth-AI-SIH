# Dataset completeness and lineage status

Audit date: 9 September 2026. Counts below are from the two canonical CSVs and
the read-only Atlas audit snapshot. The import batches reconciled exactly, but
there is no work-level dataset in this repository or in the configured
development database.

| Dataset | Source availability | Source row count | Parsed row count | Valid row count | Invalid row count | Duplicate row count | Stored row count | MongoDB collection | Import batch ID | Frontend visibility | API verification | ML suitability | Final status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| `data/Allocated Limit for Honble MPs (1).csv` (Lok Sabha) | Available; canonical file and root convenience copy are byte-identical; SHA-256 prefix `db419a582d351bdd` | 544 | 543 | 543 | 0 | 0 on first import; 543 skipped on identical re-import | 543 allocations | `mp_allocations` plus `states`, `constituencies`, `mps`, `import_batches` | `dd40…` (first import); `0787…` (idempotent re-import) | No dedicated ingestion/allocation page; not shown in primary dashboard | Batch upload/validate/import tests exist; live Atlas snapshot showed matching aggregate reference counts | Allocation/reference data only; must not create work facts or labels | Implemented but partially working |
| `data/Allocated Limit for Honble MPs (2).csv` (Rajya Sabha) | Available; canonical file and root convenience copy are byte-identical; SHA-256 prefix `c42cb2a25b79abb7` | 232 | 231 | 231 | 0 | 0 on first import; 231 skipped on identical re-import | 231 allocations | `mp_allocations` plus `states`, `constituencies`, `mps`, `import_batches` | `c603…` (first import); `2a58…` (idempotent re-import) | No dedicated ingestion/allocation page; not shown in primary dashboard | Batch upload/validate/import tests exist; live Atlas snapshot showed matching aggregate reference counts | Allocation/reference data only; must not create work facts or labels | Implemented but partially working |
| Work/progress/payment dataset | Not supplied. The repository has controlled generators (`synthetic_demo` and `synthetic_ml_training`) only; live `works` is empty. | — | — | — | — | — | 0 operational works | `works`, `progress_updates`, `payment_tranches` | — | Work dashboards render empty states | `/api/v1/public/works` returned 200 with `total=0`; authenticated work queues were empty | Cannot train/evaluate on real operational outcomes; synthetic labels are explicitly non-production | Blocked by missing data or credentials |

## Required checks and results

1. Both source files exist, parse, detect their expected format, and reconcile
   raw rows to valid rows after the terminal blank/footer row is filtered.
2. All valid rows from the first imports are stored; re-imports are idempotent
   through the allocation `data_hash` unique index.
3. Batch metadata includes filename, file type, mapping, row outcomes, audit
   timestamps, and (for new uploads) original-byte SHA-256/size metadata.
4. Historical batches predate the source-byte fields. The dry-run utility
   `backend/scripts/backfill_import_batch_content_metadata.py` can record a
   clearly labelled hash of their retained canonical payload; it does not claim
   to reconstruct an original file byte hash. It only writes with `--apply`.
5. No rollback endpoint is implemented. Do not represent an import as
   reversible until a reviewed, batch-scoped rollback design is added.
6. There is no allocation-record read API or connected frontend table, so
   filtering, sorting, and pagination of imported reference records remain
   unverified.
7. The source data is allocation-only. It is intentionally unsuitable for
   asserting sanctioned works, expenditure, progress, delay, anomalies, or
   irregularity.

## Missing data and continuation plan

Provide an authoritative work/project extract with stable work IDs, sanctioned
amounts, releases, expenditure, progress history, locations, agencies/vendors,
and dates; a district/agency registry; and approved Cloudinary/Redis/deployment
credentials. Development can continue with the synthetic generators, but
production claims, work-level dashboards, ML calibration, duplicate clusters,
financial comparisons, and role E2E workflows remain blocked until those inputs
are supplied and approved.
