"""Private evidence-verification schemas for Phase 12."""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class EvidenceStorageMode(str, Enum):
    """Storage implementation used for a private evidence asset."""

    CLOUDINARY = "cloudinary"
    LOCAL_DEMO = "local_demo"


class EvidenceVerificationLabel(str, Enum):
    """Safe, non-conclusive labels shown to reviewers."""

    VERIFIED_METADATA_AVAILABLE = "Verified metadata available"
    METADATA_UNAVAILABLE = "Metadata unavailable — manual verification required"
    GPS_MISMATCH = "GPS mismatch — verification recommended"
    TIMESTAMP_INCONSISTENCY = "Timestamp inconsistency — verification recommended"
    POSSIBLE_REUSED_EVIDENCE = "Possible reused evidence — manual verification required"


class EvidenceUploadSignatureRequest(BaseModel):
    """A short-lived, authorized upload request for one work."""

    work_id: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="image/jpeg", max_length=100)


class EvidenceUploadSignatureResponse(BaseModel):
    """Cloudinary signature or the controlled local-demo upload path."""

    evidence_id: str
    storage_mode: EvidenceStorageMode
    upload_url: Optional[str] = None
    api_key: Optional[str] = None
    timestamp: Optional[int] = None
    signature: Optional[str] = None
    folder: Optional[str] = None
    public_id: Optional[str] = None
    upload_type: Optional[str] = None
    local_upload_endpoint: Optional[str] = None
    completion_endpoint: str
    expires_at: datetime


class CloudinaryUploadCompleteRequest(BaseModel):
    """Reference a completed, authenticated Cloudinary upload for verification."""

    work_id: str = Field(min_length=1, max_length=120)
    evidence_id: str = Field(min_length=1, max_length=120)
    public_id: str = Field(min_length=1, max_length=300)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="image/jpeg", max_length=100)


class EvidenceMetadataOverride(BaseModel):
    """Trusted fixture-only metadata used by the seeded demo evidence script."""

    gps_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    captured_at: Optional[datetime] = None


class EvidenceRecord(BaseModel):
    """Complete private MongoDB document, including server-only storage reference."""

    evidence_id: str
    verification_schema_version: int = 1
    work_id: str
    evidence_type: str = "site_photo"
    storage_mode: EvidenceStorageMode
    storage_reference: str
    original_filename: str
    media_type: str
    file_size_bytes: int = Field(ge=0)
    sha256_hash: Optional[str] = None
    # Legacy-compatible field consumed by Phase 11 duplicate-work detection.
    file_hash: Optional[str] = None
    perceptual_hash: Optional[str] = None
    exif_fields: list[str] = Field(default_factory=list)
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    captured_at: Optional[datetime] = None
    distance_from_project_meters: Optional[float] = Field(default=None, ge=0)
    timestamp_consistent: Optional[bool] = None
    metadata_available: bool = False
    metadata_source: str = "unavailable"
    verification_labels: list[EvidenceVerificationLabel] = Field(default_factory=list)
    possible_reused_evidence_count: int = Field(default=0, ge=0)
    duplicate_match_ids: list[str] = Field(default_factory=list)
    is_private: bool = True
    demo_seed: bool = False
    demo_scenario: str = ""
    uploaded_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    verified_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EvidenceVerificationResponse(BaseModel):
    """Safe metadata response. It deliberately contains no image URL or raw GPS."""

    evidence_id: str
    work_id: str
    evidence_type: str
    storage_mode: EvidenceStorageMode
    media_type: str
    file_size_bytes: int
    sha256_hash: Optional[str] = None
    perceptual_hash: Optional[str] = None
    exif_fields: list[str] = Field(default_factory=list)
    metadata_available: bool
    metadata_source: str
    gps_available: bool
    distance_from_project_meters: Optional[float] = None
    captured_at: Optional[datetime] = None
    timestamp_consistent: Optional[bool] = None
    verification_labels: list[EvidenceVerificationLabel]
    possible_reused_evidence_count: int
    created_at: datetime
    verified_at: datetime


class EvidenceListResponse(BaseModel):
    evidence: list[EvidenceVerificationResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    privacy_notice: str = "Evidence files, direct storage references, and raw coordinates are restricted to authorized review workflows."


class CrossProjectDuplicateScanResponse(BaseModel):
    records_scanned: int
    cross_project_matches: int
    perceptual_hash_distance_threshold: int
    completed_at: datetime
    notice: str = "Possible reused evidence — manual verification required"
