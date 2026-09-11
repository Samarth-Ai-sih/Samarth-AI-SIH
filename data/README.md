# SAMARTH AI — Reference data

These two CSV files are read-only reference allocation datasets used by the
authenticated ingestion workflow. They are not work registers, payment
ledgers, physical-progress updates, evidence, or risk labels.

| File | Intended dataset | Import target |
| --- | --- | --- |
| `Allocated Limit for Honble MPs (1).csv` | Lok Sabha allocation limits | `mp_allocations`, `mps`, `states`, `constituencies` |
| `Allocated Limit for Honble MPs (2).csv` | Rajya Sabha allocation limits | `mp_allocations`, `mps`, `states` |

The project root contains byte-identical convenience copies. The canonical
ingestion path is this directory. `scripts.seed_csv` hashes batches and the
import service rejects duplicate records; it does not manufacture sanctioned
works, releases, expenditure, progress, cases, or risk from allocation data.

Source provenance and authenticity must be verified by an operator before any
real deployment. This hackathon repository does not claim Government of India
data access.
