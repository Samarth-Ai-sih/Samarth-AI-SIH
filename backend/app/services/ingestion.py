"""
SAMARTH AI — CSV Ingestion Service

Core logic for:
- CSV upload and file-type detection
- Auto column mapping
- Row-level validation
- Idempotent import with SHA-256 deduplication
- Reference collection normalization (states, constituencies, MPs)
- Audit trail logging

Does NOT infer work-level progress, expenditure, payments, or risk
from allocation values.
"""

import csv
import hashlib
import io
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database

logger = logging.getLogger("samarth.ingestion")

# ── Constants ────────────────────────────────────────────────────

HONORIFICS = [
    "Dr.", "Shri", "Smt.", "Smt", "Ms.", "Prof.", "Adv.", "Adv",
    "Captain", "Mr.", "Mrs.", "Shri ", "DR.", "DR",
]

TERM_YEAR_PATTERN = re.compile(r"\s*\((\d{4})-(\d{2,4})\)\s*")

REQUIRED_AMOUNT_FIELDS = {"sr_no", "state", "mp_name", "allocated_amount"}


# ── Normalization helpers ────────────────────────────────────────

def normalize_state_name(raw: str) -> str:
    """Normalize state name to title case with consistent spacing."""
    name = raw.strip()
    # Fix "And" → "and" in state names for title case then fix back
    name = name.title()
    # Common corrections
    name = name.replace(" And ", " and ")
    name = name.replace("The Dadra And Nagar Haveli And Daman And Diu",
                        "The Dadra and Nagar Haveli and Daman and Diu")
    return name


def parse_mp_name(raw: str) -> dict:
    """
    Parse an MP name field into components.

    Returns dict with:
      - name: cleaned name (without honorific/term years)
      - name_raw: original value
      - honorific: extracted honorific or None
      - term_start: start year or None (Rajya Sabha)
      - term_end: end year or None (Rajya Sabha)
    """
    name = raw.strip()
    original = name

    # Extract honorific
    honorific = None
    for h in HONORIFICS:
        if name.startswith(h + " ") or name.startswith(h + "."):
            honorific = h.rstrip(".")
            name = name[len(h):].strip()
            break
        # Handle cases like "DR C N MANJUNATH" (no period)
        if name.upper().startswith(h.upper().rstrip(".") + " "):
            honorific = h.rstrip(".")
            name = name[len(h.rstrip(".")):].strip()
            break

    # Extract term years (Rajya Sabha names embed these)
    term_start = None
    term_end = None
    matches = TERM_YEAR_PATTERN.findall(name)
    if matches:
        # Take the first match (both pairs are usually identical)
        start_str, end_str = matches[0]
        term_start = int(start_str)
        if len(end_str) == 2:
            century = term_start // 100 * 100
            term_end = century + int(end_str)
        else:
            term_end = int(end_str)

    # Remove all term year patterns from name
    name = TERM_YEAR_PATTERN.sub("", name).strip()

    return {
        "name": name,
        "name_raw": original,
        "honorific": honorific,
        "term_start": term_start,
        "term_end": term_end,
    }


def compute_record_hash(
    state: str, mp_name: str, constituency: str, house: str, amount: str
) -> str:
    """
    SHA-256 hash of key fields for duplicate detection.
    Ensures idempotent imports.
    """
    key = f"{state.lower().strip()}|{mp_name.lower().strip()}|{constituency.lower().strip()}|{house}|{amount.strip()}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def source_file_metadata(content: bytes) -> dict[str, int | str]:
    """Return immutable provenance fields for the exact uploaded byte stream."""
    return {
        "source_sha256": hashlib.sha256(content).hexdigest(),
        "source_size_bytes": len(content),
    }


def parse_amount(raw: str) -> Optional[float]:
    """Parse amount string, handling Indian notation and edge cases."""
    if not raw or not raw.strip():
        return None
    cleaned = raw.strip().replace(",", "")
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


# ── Main Service ─────────────────────────────────────────────────

class IngestionService:
    """
    CSV ingestion pipeline for MPLADS allocation datasets.

    Lifecycle:
      upload → detect_columns → preview → validate → import

    Collections written:
      - import_batches (batch tracking)
      - states (normalized reference)
      - constituencies (normalized reference)
      - mps (normalized reference)
      - mp_allocations (allocation data with source tracking)
      - audit_logs (operation audit trail)
    """

    def __init__(self, db: Database):
        self.db = db
        self.batches = db.get_collection("import_batches")
        self.states_col = db.get_collection("states")
        self.constituencies_col = db.get_collection("constituencies")
        self.mps_col = db.get_collection("mps")
        self.allocations_col = db.get_collection("mp_allocations")
        self.audit_col = db.get_collection("audit_logs")

    # ── Index setup ──────────────────────────────────────────

    async def ensure_indexes(self) -> None:
        """Create required indexes for ingestion collections."""
        await self.batches.create_index("batch_id", unique=True)
        await self.states_col.create_index("name_normalized", unique=True)
        await self.constituencies_col.create_index(
            [("name_normalized", 1), ("state_normalized", 1)], unique=True
        )
        await self.mps_col.create_index(
            [("name_normalized", 1), ("house", 1), ("state_normalized", 1)]
        )
        await self.allocations_col.create_index("data_hash", unique=True)
        await self.allocations_col.create_index("source_batch_id")
        await self.audit_col.create_index("timestamp")
        await self.audit_col.create_index(
            [("entity_type", 1), ("entity_id", 1)]
        )
        logger.info("Ingestion indexes ensured")

    # ── Audit logging ────────────────────────────────────────

    async def _log_audit(
        self,
        action: str,
        entity_type: str,
        entity_id: str,
        details: Optional[dict] = None,
        user_id: Optional[str] = None,
    ) -> None:
        """Write an entry to the audit_logs collection."""
        await self.audit_col.insert_one({
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "user_id": user_id,
            "details": details or {},
            "timestamp": datetime.now(timezone.utc),
        })

    # ── CSV parsing ──────────────────────────────────────────

    @staticmethod
    def _parse_csv_content(content: str) -> tuple[list[str], list[dict[str, str]]]:
        """
        Parse CSV string into headers and row dicts.
        Filters out the Grand Total footer row.
        """
        reader = csv.DictReader(io.StringIO(content))
        headers = list(reader.fieldnames or [])
        rows = []
        for row in reader:
            # Skip Grand Total / summary rows
            first_val = row.get(headers[0], "").strip().lower() if headers else ""
            if first_val in ("grand total", "total", ""):
                # Check if it's really the footer (state is nbsp or empty)
                state_val = row.get("State", row.get(headers[1], "")).strip()
                if not state_val or state_val == "\xa0":
                    continue
            rows.append(dict(row))
        return headers, rows

    @staticmethod
    def _detect_file_type(headers: list[str]) -> str:
        """Detect CSV format based on column headers."""
        header_set = {h.strip().lower() for h in headers}
        if any("constituency" in h for h in header_set):
            return "lok_sabha"
        if any("elected" in h or "nominated" in h for h in header_set):
            return "rajya_sabha"
        return "unknown"

    @staticmethod
    def _auto_map_columns(headers: list[str]) -> dict:
        """Auto-detect column mapping from headers."""
        mapping = {}
        for h in headers:
            hl = h.lower().strip()
            if "sr" in hl and "no" in hl:
                mapping["sr_no"] = h
            elif hl == "state":
                mapping["state"] = h
            elif "member" in hl or "parliament" in hl:
                mapping["mp_name"] = h
            elif "constituency" in hl:
                mapping["constituency"] = h
            elif "elected" in hl or "nominated" in hl:
                mapping["elected_nominated"] = h
            elif "amount" in hl or "allocated" in hl:
                mapping["allocated_amount"] = h
        return mapping

    # ── Upload ───────────────────────────────────────────────

    async def upload_csv(
        self, filename: str, content: bytes, user_id: Optional[str] = None
    ) -> dict:
        """
        Upload a CSV file. Auto-detects format and column mapping.

        Returns the created import batch document.
        """
        source_metadata = source_file_metadata(content)
        try:
            content_str = content.decode("utf-8-sig")
            source_encoding = "utf-8-sig"
        except UnicodeDecodeError:
            content_str = content.decode("latin-1")
            source_encoding = "latin-1"

        headers, rows = self._parse_csv_content(content_str)
        file_type = self._detect_file_type(headers)
        column_mapping = self._auto_map_columns(headers)

        batch_id = str(uuid4())
        now = datetime.now(timezone.utc)

        batch = {
            "batch_id": batch_id,
            "filename": filename,
            "file_type": file_type,
            "status": "uploaded",
            "total_rows": len(rows),
            "valid_rows": 0,
            "invalid_rows": 0,
            "imported_rows": 0,
            "skipped_duplicate_rows": 0,
            "column_mapping": column_mapping,
            "headers": headers,
            "validation_errors": [],
            "raw_content": content_str,
            # These describe the uploaded bytes, rather than the decoded
            # staging payload. They make a later provenance check possible
            # even when parsing normalises a UTF-8 BOM.
            **source_metadata,
            "source_content_type": "text/csv",
            "source_encoding": source_encoding,
            "source_metadata_status": "original_upload",
            "created_at": now,
            "updated_at": now,
            "created_by": user_id,
        }

        await self.batches.insert_one(batch)

        await self._log_audit("csv_uploaded", "import_batch", batch_id, {
            "filename": filename,
            "file_type": file_type,
            "total_rows": len(rows),
            "detected_columns": column_mapping,
            "source_sha256": source_metadata["source_sha256"],
            "source_size_bytes": source_metadata["source_size_bytes"],
        }, user_id)

        logger.info(
            "CSV uploaded: %s (%s, %d rows)",
            filename, file_type, len(rows),
        )

        # Return without raw_content for API response
        batch.pop("raw_content", None)
        batch.pop("_id", None)
        return batch

    # ── Preview ──────────────────────────────────────────────

    async def preview_rows(
        self, batch_id: str, limit: int = 10
    ) -> dict:
        """Preview first N rows with column mapping applied."""
        batch = await self._get_batch(batch_id)
        headers, rows = self._parse_csv_content(batch["raw_content"])
        mapping = batch["column_mapping"]

        preview = []
        for row in rows[:limit]:
            mapped = {
                "sr_no": row.get(mapping.get("sr_no", ""), ""),
                "state": row.get(mapping.get("state", ""), ""),
                "mp_name": row.get(mapping.get("mp_name", ""), ""),
                "allocated_amount": row.get(mapping.get("allocated_amount", ""), ""),
            }
            if "constituency" in mapping:
                mapped["constituency"] = row.get(mapping["constituency"], "")
            if "elected_nominated" in mapping:
                mapped["elected_nominated"] = row.get(mapping["elected_nominated"], "")

            # Show normalized MP name for preview
            parsed = parse_mp_name(mapped["mp_name"])
            mapped["mp_name_normalized"] = parsed["name"]
            mapped["honorific"] = parsed["honorific"]
            if parsed["term_start"]:
                mapped["term_start"] = parsed["term_start"]
                mapped["term_end"] = parsed["term_end"]

            preview.append(mapped)

        return {
            "batch_id": batch_id,
            "file_type": batch["file_type"],
            "column_mapping": mapping,
            "total_rows": batch["total_rows"],
            "preview_rows": preview,
        }

    # ── Column mapping update ────────────────────────────────

    async def update_mapping(
        self, batch_id: str, mapping: dict
    ) -> dict:
        """Update the column mapping for a batch."""
        batch = await self._get_batch(batch_id)
        if batch["status"] not in ("uploaded", "validated"):
            raise ValueError(
                f"Cannot update mapping for batch in '{batch['status']}' status"
            )

        await self.batches.update_one(
            {"batch_id": batch_id},
            {"$set": {
                "column_mapping": mapping,
                "status": "uploaded",  # Reset to uploaded if re-mapping
                "validation_errors": [],
                "valid_rows": 0,
                "invalid_rows": 0,
                "updated_at": datetime.now(timezone.utc),
            }},
        )

        await self._log_audit("mapping_updated", "import_batch", batch_id, {
            "new_mapping": mapping,
        })

        batch["column_mapping"] = mapping
        batch["status"] = "uploaded"
        batch.pop("raw_content", None)
        batch.pop("_id", None)
        return batch

    # ── Validation ───────────────────────────────────────────

    def _validate_row(
        self,
        row: dict,
        mapping: dict,
        file_type: str,
        row_num: int,
    ) -> list[dict]:
        """Validate a single CSV row. Returns list of errors (empty = valid)."""
        errors = []

        # State required
        state = row.get(mapping.get("state", ""), "").strip()
        if not state or state == "\xa0":
            errors.append({
                "row_number": row_num,
                "column": "state",
                "value": state,
                "error": "State is required",
            })

        # MP name required
        mp_name = row.get(mapping.get("mp_name", ""), "").strip()
        if not mp_name or mp_name == "\xa0":
            errors.append({
                "row_number": row_num,
                "column": "mp_name",
                "value": mp_name,
                "error": "MP name is required",
            })

        # Amount validation
        amount_str = row.get(mapping.get("allocated_amount", ""), "").strip()
        if amount_str and amount_str != "\xa0":
            parsed = parse_amount(amount_str)
            if parsed is None:
                errors.append({
                    "row_number": row_num,
                    "column": "allocated_amount",
                    "value": amount_str,
                    "error": "Invalid numeric amount",
                })
        # Empty amount is allowed (1 row in File 1 has empty amount)

        # Constituency required for Lok Sabha
        if file_type == "lok_sabha" and "constituency" in mapping:
            constituency = row.get(mapping["constituency"], "").strip()
            if not constituency:
                errors.append({
                    "row_number": row_num,
                    "column": "constituency",
                    "value": "",
                    "error": "Constituency is required for Lok Sabha MPs",
                })

        # Elected/Nominated validation for Rajya Sabha
        if file_type == "rajya_sabha" and "elected_nominated" in mapping:
            en = row.get(mapping["elected_nominated"], "").strip()
            if en and en != "\xa0" and en not in ("Elected MP", "Nominated MP"):
                errors.append({
                    "row_number": row_num,
                    "column": "elected_nominated",
                    "value": en,
                    "error": "Must be 'Elected MP' or 'Nominated MP'",
                })

        return errors

    async def validate_batch(self, batch_id: str) -> dict:
        """Run validation on all rows in a batch."""
        batch = await self._get_batch(batch_id)

        await self.batches.update_one(
            {"batch_id": batch_id},
            {"$set": {"status": "validating", "updated_at": datetime.now(timezone.utc)}},
        )

        headers, rows = self._parse_csv_content(batch["raw_content"])
        mapping = batch["column_mapping"]
        file_type = batch["file_type"]

        all_errors: list[dict] = []
        valid_count = 0

        for i, row in enumerate(rows, start=2):  # Row 1 = header
            row_errors = self._validate_row(row, mapping, file_type, i)
            if row_errors:
                all_errors.extend(row_errors)
            else:
                valid_count += 1

        invalid_count = len(rows) - valid_count

        await self.batches.update_one(
            {"batch_id": batch_id},
            {"$set": {
                "status": "validated",
                "valid_rows": valid_count,
                "invalid_rows": invalid_count,
                "validation_errors": all_errors,
                "updated_at": datetime.now(timezone.utc),
            }},
        )

        await self._log_audit("csv_validated", "import_batch", batch_id, {
            "valid_rows": valid_count,
            "invalid_rows": invalid_count,
            "error_count": len(all_errors),
        })

        logger.info(
            "Batch %s validated: %d valid, %d invalid, %d errors",
            batch_id, valid_count, invalid_count, len(all_errors),
        )

        return {
            "batch_id": batch_id,
            "status": "validated",
            "total_rows": len(rows),
            "valid_rows": valid_count,
            "invalid_rows": invalid_count,
            "errors": all_errors,
        }

    # ── Import ───────────────────────────────────────────────

    async def import_batch(self, batch_id: str) -> dict:
        """
        Import validated rows into reference collections.

        Idempotent: duplicate records (by data hash) are skipped.
        Creates/updates: states, constituencies, mps, mp_allocations.
        """
        batch = await self._get_batch(batch_id)

        if batch["status"] not in ("validated", "failed", "partially_completed"):
            raise ValueError(
                f"Batch must be validated before import. "
                f"Current status: '{batch['status']}'"
            )

        await self.batches.update_one(
            {"batch_id": batch_id},
            {"$set": {"status": "importing", "updated_at": datetime.now(timezone.utc)}},
        )

        headers, rows = self._parse_csv_content(batch["raw_content"])
        mapping = batch["column_mapping"]
        file_type = batch["file_type"]

        imported = 0
        skipped = 0
        import_errors: list[dict] = []

        for i, row in enumerate(rows, start=2):
            # Skip invalid rows
            row_errors = self._validate_row(row, mapping, file_type, i)
            if row_errors:
                continue

            try:
                result = await self._import_single_row(
                    row, mapping, file_type, batch_id
                )
                if result == "imported":
                    imported += 1
                elif result == "skipped_duplicate":
                    skipped += 1
            except Exception as exc:
                logger.warning("Row %d import error: %s", i, exc)
                import_errors.append({
                    "row_number": i,
                    "error": str(exc),
                })

        # Determine final status
        if import_errors and imported == 0:
            status = "failed"
        elif import_errors:
            status = "partially_completed"
        else:
            status = "completed"

        await self.batches.update_one(
            {"batch_id": batch_id},
            {"$set": {
                "status": status,
                "imported_rows": imported,
                "skipped_duplicate_rows": skipped,
                "updated_at": datetime.now(timezone.utc),
            }},
        )

        await self._log_audit("csv_imported", "import_batch", batch_id, {
            "status": status,
            "imported": imported,
            "skipped_duplicates": skipped,
            "errors": len(import_errors),
        })

        logger.info(
            "Batch %s import %s: %d imported, %d duplicates skipped, %d errors",
            batch_id, status, imported, skipped, len(import_errors),
        )

        return {
            "batch_id": batch_id,
            "status": status,
            "imported_rows": imported,
            "skipped_duplicate_rows": skipped,
            "import_errors": import_errors,
        }

    async def _import_single_row(
        self,
        row: dict,
        mapping: dict,
        file_type: str,
        batch_id: str,
    ) -> str:
        """Import one CSV row into reference collections. Returns 'imported' or 'skipped_duplicate'."""
        # ── Extract raw values ───────────────────────────────
        state_raw = row.get(mapping.get("state", ""), "").strip()
        mp_name_raw = row.get(mapping.get("mp_name", ""), "").strip()
        constituency_raw = (
            row.get(mapping.get("constituency", ""), "").strip()
            if "constituency" in mapping else ""
        )
        elected_nominated = (
            row.get(mapping.get("elected_nominated", ""), "").strip()
            if "elected_nominated" in mapping else ""
        )
        amount_raw = row.get(mapping.get("allocated_amount", ""), "").strip()
        sr_no = row.get(mapping.get("sr_no", ""), "").strip()

        # ── Normalize ────────────────────────────────────────
        state_name = normalize_state_name(state_raw)
        mp_parsed = parse_mp_name(mp_name_raw)
        mp_name_clean = mp_parsed["name"]
        amount = parse_amount(amount_raw)
        house = file_type

        # ── Data hash for deduplication ──────────────────────
        data_hash = compute_record_hash(
            state_name, mp_name_clean, constituency_raw, house, amount_raw
        )

        # Check duplicate
        existing = await self.allocations_col.find_one({"data_hash": data_hash})
        if existing:
            return "skipped_duplicate"

        # ── Upsert state ─────────────────────────────────────
        await self.states_col.update_one(
            {"name_normalized": state_name.lower()},
            {
                "$set": {
                    "name": state_name,
                    "name_normalized": state_name.lower(),
                    "updated_at": datetime.now(timezone.utc),
                },
                "$addToSet": {"name_variants": state_raw},
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )

        # ── Upsert constituency (Lok Sabha only) ─────────────
        if file_type == "lok_sabha" and constituency_raw:
            await self.constituencies_col.update_one(
                {
                    "name_normalized": constituency_raw.lower(),
                    "state_normalized": state_name.lower(),
                },
                {
                    "$set": {
                        "name": constituency_raw,
                        "name_normalized": constituency_raw.lower(),
                        "state_name": state_name,
                        "state_normalized": state_name.lower(),
                        "updated_at": datetime.now(timezone.utc),
                    },
                    "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
                },
                upsert=True,
            )

        # ── Upsert MP ────────────────────────────────────────
        mp_filter: dict[str, Any] = {
            "name_normalized": mp_name_clean.lower(),
            "house": house,
            "state_normalized": state_name.lower(),
        }

        mp_doc = {
            "name": mp_name_clean,
            "name_normalized": mp_name_clean.lower(),
            "name_raw": mp_name_raw,
            "honorific": mp_parsed["honorific"],
            "state_name": state_name,
            "state_normalized": state_name.lower(),
            "house": house,
            "updated_at": datetime.now(timezone.utc),
        }

        if file_type == "lok_sabha" and constituency_raw:
            mp_doc["constituency_name"] = constituency_raw
            mp_doc["constituency_normalized"] = constituency_raw.lower()
        if elected_nominated:
            mp_doc["elected_or_nominated"] = elected_nominated
        if mp_parsed["term_start"]:
            mp_doc["term_start"] = mp_parsed["term_start"]
            mp_doc["term_end"] = mp_parsed["term_end"]

        await self.mps_col.update_one(
            mp_filter,
            {
                "$set": mp_doc,
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )

        # Get MP _id for foreign key
        mp_record = await self.mps_col.find_one(mp_filter)

        # ── Insert allocation ────────────────────────────────
        allocation = {
            "mp_id": mp_record["_id"],
            "mp_name": mp_name_clean,
            "mp_name_raw": mp_name_raw,
            "state_name": state_name,
            "constituency_name": constituency_raw or None,
            "house": house,
            "elected_or_nominated": elected_nominated or None,
            "allocated_amount": amount,
            "allocated_amount_raw": amount_raw,
            "source_sr_no": sr_no,
            "source_batch_id": batch_id,
            "data_hash": data_hash,
            "created_at": datetime.now(timezone.utc),
        }
        await self.allocations_col.insert_one(allocation)

        return "imported"

    # ── Retry ────────────────────────────────────────────────

    async def retry_batch(self, batch_id: str) -> dict:
        """
        Retry a failed or partially completed batch.
        Re-runs import, skipping already-imported records (via hash).
        """
        batch = await self._get_batch(batch_id)
        if batch["status"] not in ("failed", "partially_completed"):
            raise ValueError(
                f"Only failed or partially completed batches can be retried. "
                f"Current status: '{batch['status']}'"
            )

        await self._log_audit("csv_retry", "import_batch", batch_id, {
            "previous_status": batch["status"],
            "previous_imported": batch.get("imported_rows", 0),
        })

        return await self.import_batch(batch_id)

    # ── Query helpers ────────────────────────────────────────

    async def _get_batch(self, batch_id: str) -> dict:
        """Fetch a batch by ID, raise ValueError if not found."""
        batch = await self.batches.find_one({"batch_id": batch_id})
        if not batch:
            raise ValueError(f"Import batch '{batch_id}' not found")
        return batch

    async def get_batch(self, batch_id: str) -> dict:
        """Get batch details (without raw content)."""
        batch = await self._get_batch(batch_id)
        batch.pop("raw_content", None)
        batch.pop("_id", None)
        return batch

    async def list_batches(self) -> list[dict]:
        """List all import batches, most recent first."""
        cursor = self.batches.find(
            {},
            {"raw_content": 0, "_id": 0},
        ).sort("created_at", -1)
        return await cursor.to_list(length=100)

    async def get_invalid_rows(self, batch_id: str) -> dict:
        """Get invalid rows from a validated batch for export."""
        batch = await self._get_batch(batch_id)

        if batch["status"] not in ("validated", "completed", "partially_completed", "failed"):
            raise ValueError("Batch must be validated first")

        headers, rows = self._parse_csv_content(batch["raw_content"])
        mapping = batch["column_mapping"]
        file_type = batch["file_type"]

        invalid_rows = []
        for i, row in enumerate(rows, start=2):
            row_errors = self._validate_row(row, mapping, file_type, i)
            if row_errors:
                invalid_rows.append({
                    "row_number": i,
                    "data": row,
                    "errors": row_errors,
                })

        return {
            "batch_id": batch_id,
            "total_invalid": len(invalid_rows),
            "rows": invalid_rows,
        }

    # ── Stats ────────────────────────────────────────────────

    async def get_collection_stats(self) -> dict:
        """Get counts for all reference collections."""
        return {
            "states": await self.states_col.count_documents({}),
            "constituencies": await self.constituencies_col.count_documents({}),
            "mps": await self.mps_col.count_documents({}),
            "mp_allocations": await self.allocations_col.count_documents({}),
            "import_batches": await self.batches.count_documents({}),
        }
