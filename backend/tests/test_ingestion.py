"""
SAMARTH AI — Ingestion Tests

Tests for:
  - MP name parsing and normalization
  - State name normalization
  - Data hash computation
  - Amount parsing
  - Full upload → validate → import pipeline (both CSV files)
  - Idempotent re-import (duplicate detection)
  - Batch listing and stats
"""

import os
import sys
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient, ASGITransport

# Set test environment
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
os.environ.setdefault("MONGODB_DB_NAME", "samarth_ai_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-minimum-16-chars")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ENVIRONMENT", "development")

from app.main import app  # noqa: E402
from app.services.ingestion import (  # noqa: E402
    compute_record_hash,
    normalize_state_name,
    parse_amount,
    parse_mp_name,
    source_file_metadata,
)


# ── Unit tests: normalization helpers ────────────────────────

class TestMPNameParsing:
    """Test MP name parsing and normalization."""

    def test_simple_name(self):
        result = parse_mp_name("AKHILESH YADAV")
        assert result["name"] == "AKHILESH YADAV"
        assert result["honorific"] is None
        assert result["term_start"] is None

    def test_honorific_shri(self):
        result = parse_mp_name("Shri Amit Shah")
        assert result["name"] == "Amit Shah"
        assert result["honorific"] == "Shri"

    def test_honorific_dr(self):
        result = parse_mp_name("Dr. Abhishek Manu Singhvi (2026-32) (2026-2032)")
        assert result["name"] == "Abhishek Manu Singhvi"
        assert result["honorific"] == "Dr"
        assert result["term_start"] == 2026
        assert result["term_end"] == 2032

    def test_honorific_smt(self):
        result = parse_mp_name("Smt. Nirmala Sitharaman (2022-28) (2022-2028)")
        assert result["name"] == "Nirmala Sitharaman"
        assert result["honorific"] == "Smt"
        assert result["term_start"] == 2022
        assert result["term_end"] == 2028

    def test_honorific_prof(self):
        result = parse_mp_name("Prof. Ram Gopal Yadav (2020-26) (2020-2026)")
        assert result["name"] == "Ram Gopal Yadav"
        assert result["honorific"] == "Prof"
        assert result["term_start"] == 2020
        assert result["term_end"] == 2026

    def test_honorific_ms(self):
        result = parse_mp_name("Ms. Dola Sen (2023-29) (2023-2029)")
        assert result["name"] == "Dola Sen"
        assert result["honorific"] == "Ms"

    def test_term_years_two_digit(self):
        result = parse_mp_name("Shri A. A. Rahim (2022-28) (2022-2028)")
        assert result["term_start"] == 2022
        assert result["term_end"] == 2028

    def test_term_years_four_digit(self):
        result = parse_mp_name("Shri Abdul Wahab (2021-27) (2021-2027)")
        assert result["term_start"] == 2021
        assert result["term_end"] == 2027

    def test_lok_sabha_no_term_years(self):
        """Lok Sabha names don't have term years."""
        result = parse_mp_name("Shri Narendra Modi")
        assert result["name"] == "Narendra Modi"
        assert result["honorific"] == "Shri"
        assert result["term_start"] is None
        assert result["term_end"] is None

    def test_name_with_dr_prefix_no_period(self):
        """Handle 'DR' without period."""
        result = parse_mp_name("DR BYREDDY SHABARI")
        assert result["honorific"] == "Dr"
        assert "BYREDDY" in result["name"]

    def test_preserves_raw(self):
        raw = "Dr. Kavita Patidar (2022-28) (2022-2028)"
        result = parse_mp_name(raw)
        assert result["name_raw"] == raw


class TestStateNormalization:
    """Test state name normalization."""

    def test_simple_state(self):
        assert normalize_state_name("Bihar") == "Bihar"

    def test_title_case(self):
        assert normalize_state_name("TAMIL NADU") == "Tamil Nadu"

    def test_mixed_case(self):
        assert normalize_state_name("uttar pradesh") == "Uttar Pradesh"

    def test_state_with_and(self):
        result = normalize_state_name("Jammu And Kashmir")
        assert result == "Jammu and Kashmir"

    def test_strip_whitespace(self):
        assert normalize_state_name("  Bihar  ") == "Bihar"


class TestAmountParsing:
    """Test amount string parsing."""

    def test_simple_integer(self):
        assert parse_amount("147000000") == 147000000.0

    def test_decimal(self):
        assert parse_amount("196063957.11") == 196063957.11

    def test_float_precision_artifact(self):
        """Handle floating point precision artifacts from CSV."""
        result = parse_amount("197118521.35000002")
        assert result == 197118521.35

    def test_indian_notation(self):
        """Handle comma-separated amounts (Indian lakh/crore notation)."""
        assert parse_amount("83,33,66,73,298.01") == 83336673298.01

    def test_empty_string(self):
        assert parse_amount("") is None

    def test_none_value(self):
        assert parse_amount("") is None


class TestDataHash:
    """Test SHA-256 hash computation."""

    def test_deterministic(self):
        h1 = compute_record_hash("Bihar", "Test MP", "TestConst", "lok_sabha", "100")
        h2 = compute_record_hash("Bihar", "Test MP", "TestConst", "lok_sabha", "100")
        assert h1 == h2

    def test_different_inputs(self):
        h1 = compute_record_hash("Bihar", "MP A", "", "lok_sabha", "100")
        h2 = compute_record_hash("Bihar", "MP B", "", "lok_sabha", "100")
        assert h1 != h2

    def test_case_insensitive(self):
        h1 = compute_record_hash("BIHAR", "Test MP", "", "lok_sabha", "100")
        h2 = compute_record_hash("bihar", "Test MP", "", "lok_sabha", "100")
        assert h1 == h2


class TestSourceFileProvenance:
    """Whole-file provenance is stored from original upload bytes."""

    def test_source_metadata_is_deterministic(self):
        content = b"Sr. No,State\n1,Bihar\n"
        metadata = source_file_metadata(content)

        assert metadata["source_sha256"] == (
            "e5962b98a82f43c02e368f85f6134be3b969903a0232194ff86d7998c73b0b08"
        )
        assert metadata["source_size_bytes"] == len(content)


class _CapturedCollection:
    def __init__(self):
        self.documents: list[dict[str, Any]] = []

    async def insert_one(self, document: dict[str, Any]):
        self.documents.append(dict(document))


class _CapturedDatabase:
    """Minimal persistence double for the upload service boundary."""

    def __init__(self):
        self.collections: dict[str, _CapturedCollection] = {}

    def get_collection(self, name: str) -> _CapturedCollection:
        return self.collections.setdefault(name, _CapturedCollection())


@pytest.mark.asyncio
async def test_upload_persists_original_source_metadata():
    """The staged batch retains source hash/size and never returns raw CSV."""
    from app.services.ingestion import IngestionService

    content = b"Sr. No,State,Name of Hon'ble MP,Constituency,Allocated Amount\n1,Bihar,Test MP,Patna,100\n"
    db = _CapturedDatabase()
    result = await IngestionService(db).upload_csv("allocation.csv", content, "auditor")

    stored = db.get_collection("import_batches").documents[0]
    expected = source_file_metadata(content)
    assert stored["source_sha256"] == expected["source_sha256"]
    assert stored["source_size_bytes"] == expected["source_size_bytes"]
    assert stored["source_metadata_status"] == "original_upload"
    assert stored["raw_content"]
    assert "raw_content" not in result
    assert result["source_sha256"] == expected["source_sha256"]


# ── Integration tests: service layer (with real MongoDB) ─────

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

requires_mongodb = pytest.mark.skipif(
    os.getenv("RUN_MONGODB_INTEGRATION_TESTS") != "1",
    reason="Set RUN_MONGODB_INTEGRATION_TESTS=1 with an isolated *_test MongoDB database.",
)


def _get_csv_path(filename: str) -> Path:
    """Get path to a CSV test file."""
    path = DATA_DIR / filename
    if not path.exists():
        pytest.skip(f"CSV file not found: {path}")
    return path


async def _make_service():
    """Create a fresh IngestionService with its own DB connection per test."""
    from app.core.config import get_settings
    from app.core.database import Database
    from app.services.ingestion import IngestionService

    settings = get_settings()
    db = Database(settings)
    await db.connect()
    svc = IngestionService(db)
    await svc.ensure_indexes()
    return svc, db


@requires_mongodb
@pytest.mark.asyncio
async def test_upload_lok_sabha_csv():
    """Test uploading the Lok Sabha CSV via service."""
    svc, db = await _make_service()
    try:
        csv_path = _get_csv_path("Allocated Limit for Honble MPs (1).csv")
        content = csv_path.read_bytes()

        batch = await svc.upload_csv("lok_sabha_test.csv", content)

        assert batch["file_type"] == "lok_sabha"
        assert batch["status"] == "uploaded"
        assert batch["total_rows"] == 543
        assert "constituency" in batch["column_mapping"]
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_upload_rajya_sabha_csv():
    """Test uploading the Rajya Sabha CSV via service."""
    svc, db = await _make_service()
    try:
        csv_path = _get_csv_path("Allocated Limit for Honble MPs (2).csv")
        content = csv_path.read_bytes()

        batch = await svc.upload_csv("rajya_sabha_test.csv", content)

        assert batch["file_type"] == "rajya_sabha"
        assert batch["status"] == "uploaded"
        assert batch["total_rows"] == 231
        assert "elected_nominated" in batch["column_mapping"]
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_full_pipeline_lok_sabha():
    """Test upload -> validate -> preview -> import for File 1."""
    svc, db = await _make_service()
    try:
        csv_path = _get_csv_path("Allocated Limit for Honble MPs (1).csv")
        content = csv_path.read_bytes()

        # Upload
        batch = await svc.upload_csv("ls_pipeline_test.csv", content)
        batch_id = batch["batch_id"]
        assert batch["status"] == "uploaded"

        # Preview
        preview = await svc.preview_rows(batch_id, limit=3)
        assert len(preview["preview_rows"]) == 3
        assert "mp_name_normalized" in preview["preview_rows"][0]
        assert "constituency" in preview["preview_rows"][0]

        # Validate
        validation = await svc.validate_batch(batch_id)
        assert validation["status"] == "validated"
        assert validation["valid_rows"] == 543
        assert validation["invalid_rows"] == 0

        # Import (records may be duplicates from seed script)
        result = await svc.import_batch(batch_id)
        assert result["status"] == "completed"
        assert result["imported_rows"] + result["skipped_duplicate_rows"] == 543
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_full_pipeline_rajya_sabha():
    """Test upload -> validate -> import for File 2."""
    svc, db = await _make_service()
    try:
        csv_path = _get_csv_path("Allocated Limit for Honble MPs (2).csv")
        content = csv_path.read_bytes()

        # Upload
        batch = await svc.upload_csv("rs_pipeline_test.csv", content)
        batch_id = batch["batch_id"]

        # Validate
        validation = await svc.validate_batch(batch_id)
        assert validation["valid_rows"] == 231

        # Import
        result = await svc.import_batch(batch_id)
        assert result["status"] == "completed"
        assert result["imported_rows"] + result["skipped_duplicate_rows"] == 231
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_idempotent_reimport():
    """Test that re-importing the same data skips all duplicates."""
    svc, db = await _make_service()
    try:
        csv_path = _get_csv_path("Allocated Limit for Honble MPs (2).csv")
        content = csv_path.read_bytes()

        # First import
        batch1 = await svc.upload_csv("idem_test_1.csv", content)
        await svc.validate_batch(batch1["batch_id"])
        await svc.import_batch(batch1["batch_id"])

        # Second import of identical data
        batch2 = await svc.upload_csv("idem_test_2.csv", content)
        await svc.validate_batch(batch2["batch_id"])
        result2 = await svc.import_batch(batch2["batch_id"])

        # All records should be skipped as duplicates
        assert result2["skipped_duplicate_rows"] == 231
        assert result2["imported_rows"] == 0
        assert result2["status"] == "completed"
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_batch_list():
    """Test listing import batches."""
    svc, db = await _make_service()
    try:
        batches = await svc.list_batches()
        assert isinstance(batches, list)
        assert len(batches) > 0

        batch = batches[0]
        assert "batch_id" in batch
        assert "filename" in batch
        assert "status" in batch
        assert "raw_content" not in batch  # Should be excluded
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_collection_stats():
    """Test collection statistics."""
    svc, db = await _make_service()
    try:
        stats = await svc.get_collection_stats()
        assert stats["states"] >= 30
        assert stats["constituencies"] >= 500
        assert stats["mps"] >= 700
        assert stats["mp_allocations"] >= 700
        assert stats["import_batches"] >= 2
    finally:
        await db.disconnect()


@requires_mongodb
@pytest.mark.asyncio
async def test_invalid_rows_export():
    """Test that invalid row export works for a validated batch."""
    svc, db = await _make_service()
    try:
        csv_path = _get_csv_path("Allocated Limit for Honble MPs (1).csv")
        content = csv_path.read_bytes()

        batch = await svc.upload_csv("invalid_export_test.csv", content)
        await svc.validate_batch(batch["batch_id"])

        invalid = await svc.get_invalid_rows(batch["batch_id"])
        assert invalid["batch_id"] == batch["batch_id"]
        assert isinstance(invalid["rows"], list)
        assert invalid["total_invalid"] == 0
    finally:
        await db.disconnect()
