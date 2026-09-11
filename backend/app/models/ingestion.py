"""
SAMARTH AI — Ingestion Models

Pydantic models for CSV import batches, column mapping,
validation results, and API responses.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class FileType(str, Enum):
    """Detected CSV file format."""
    LOK_SABHA = "lok_sabha"
    RAJYA_SABHA = "rajya_sabha"
    UNKNOWN = "unknown"


class BatchStatus(str, Enum):
    """Import batch lifecycle status."""
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    VALIDATED = "validated"
    IMPORTING = "importing"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    FAILED = "failed"


class ColumnMapping(BaseModel):
    """Maps CSV column headers to internal field names."""
    sr_no: Optional[str] = None
    state: Optional[str] = None
    mp_name: Optional[str] = None
    constituency: Optional[str] = None
    elected_nominated: Optional[str] = None
    allocated_amount: Optional[str] = None


class RowValidationError(BaseModel):
    """A single validation error on a specific row/column."""
    row_number: int
    column: str
    value: str
    error: str


class ImportBatchResponse(BaseModel):
    """API response for an import batch."""
    batch_id: str
    filename: str
    file_type: str
    status: str
    total_rows: int = 0
    valid_rows: int = 0
    invalid_rows: int = 0
    imported_rows: int = 0
    skipped_duplicate_rows: int = 0
    column_mapping: Optional[ColumnMapping] = None
    headers: list[str] = []
    source_sha256: Optional[str] = None
    source_size_bytes: Optional[int] = None
    source_content_type: Optional[str] = None
    source_encoding: Optional[str] = None
    source_metadata_status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class BatchListResponse(BaseModel):
    """Response for listing all batches."""
    batches: list[ImportBatchResponse]
    total: int


class PreviewResponse(BaseModel):
    """Preview of mapped rows before import."""
    batch_id: str
    file_type: str
    column_mapping: ColumnMapping
    total_rows: int
    preview_rows: list[dict[str, Any]]


class ValidationResponse(BaseModel):
    """Validation results for a batch."""
    batch_id: str
    status: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    errors: list[RowValidationError]


class ImportResultResponse(BaseModel):
    """Result of running an import."""
    batch_id: str
    status: str
    imported_rows: int
    skipped_duplicate_rows: int
    import_errors: list[dict[str, Any]] = []


class InvalidRowsResponse(BaseModel):
    """Export of invalid rows from a batch."""
    batch_id: str
    total_invalid: int
    rows: list[dict[str, Any]]
