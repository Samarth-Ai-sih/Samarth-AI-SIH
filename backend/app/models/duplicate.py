"""Schemas for explainable possible duplicate-work detection and review."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class DuplicateMatchStatus(str, Enum):
    """Human-review state of a saved possible duplicate-work match."""

    PENDING_REVIEW = "pending_review"
    CASE_CREATED = "case_created"
    MARKED_NOT_DUPLICATE = "marked_not_duplicate"
    FIELD_VERIFICATION_REQUESTED = "field_verification_requested"


class DuplicateDetectionRule(BaseModel):
    """Versioned defaults frozen with every duplicate detection scan."""

    text_similarity_threshold: float = Field(default=0.82, ge=0, le=1)
    distance_threshold_meters: float = Field(default=300.0, gt=0)
    comparable_cost_range_pct: float = Field(default=30.0, ge=0, le=100)
    require_same_or_similar_category: bool = True
    require_timeline_overlap_or_same_financial_year: bool = True
    rule_version: str = "duplicate-work-rules-v1"


class DuplicateDetectionRunRequest(BaseModel):
    """Optional rule overrides used for one manually initiated scan."""

    text_similarity_threshold: float = Field(default=0.82, ge=0, le=1)
    distance_threshold_meters: float = Field(default=300.0, gt=0)
    comparable_cost_range_pct: float = Field(default=30.0, ge=0, le=100)
    require_same_or_similar_category: bool = True
    require_timeline_overlap_or_same_financial_year: bool = True

    def to_rule(self) -> DuplicateDetectionRule:
        return DuplicateDetectionRule(**self.model_dump())


class DuplicateWorkSummary(BaseModel):
    """Safe work fields shown in explorer and side-by-side comparison views."""

    work_id: str
    title: str
    description: str = ""
    category: str
    sub_category: str = ""
    status: str
    state_name: str = ""
    district_name: str = ""
    implementing_agency: str = ""
    vendor_name: str = ""
    sanctioned_amount: float
    funds_released: float
    actual_expenditure: float
    physical_progress_pct: float
    recommended_date: Optional[datetime] = None
    sanctioned_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    expected_completion_date: Optional[datetime] = None
    location_latitude: Optional[float] = None
    location_longitude: Optional[float] = None
    location_address: str = ""


class DuplicateMatch(BaseModel):
    """Frozen, explainable match stored in ``duplicate_work_matches``."""

    match_id: str
    scan_id: str
    left_work_id: str
    right_work_id: str
    left_work_title: str = ""
    right_work_title: str = ""
    similarity_score: float = Field(ge=0, le=100)
    text_similarity: float = Field(ge=0, le=1)
    distance_meters: Optional[float] = Field(default=None, ge=0)
    distance_method: str
    category_similarity: float = Field(ge=0, le=1)
    category_relationship: str
    cost_difference_pct: Optional[float] = Field(default=None, ge=0)
    comparable_cost_range: bool
    timeline_overlap: bool
    timeline_overlap_days: Optional[int] = None
    same_financial_year: bool
    agency_vendor_relationship: str
    evidence_photo_similarity: Optional[float] = Field(default=None, ge=0, le=1)
    evidence_photo_relationship: str
    matching_signals: list[str] = Field(default_factory=list)
    rule_snapshot: DuplicateDetectionRule
    status: DuplicateMatchStatus = DuplicateMatchStatus.PENDING_REVIEW
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: str = ""
    assigned_to: str = ""


class DuplicateCluster(BaseModel):
    """Connected possible-duplicate work group generated from one scan."""

    cluster_id: str
    scan_id: str
    work_ids: list[str]
    match_ids: list[str]
    cluster_similarity_score: float = Field(ge=0, le=100)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DuplicateDetectionScan(BaseModel):
    """Audit-friendly summary of a completed candidate scan."""

    scan_id: str
    rule_snapshot: DuplicateDetectionRule
    works_evaluated: int
    pairs_evaluated: int
    matches_created: int
    clusters_created: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str = "system"


class DuplicateMatchListResponse(BaseModel):
    matches: list[DuplicateMatch]
    total: int
    page: int
    page_size: int
    total_pages: int
    scan: Optional[DuplicateDetectionScan] = None


class DuplicateClusterListResponse(BaseModel):
    clusters: list[DuplicateCluster]
    total: int
    scan: Optional[DuplicateDetectionScan] = None


class DuplicateComparisonResponse(BaseModel):
    match: DuplicateMatch
    left_work: DuplicateWorkSummary
    right_work: DuplicateWorkSummary
    case_id: Optional[str] = None
    notice: str = "Possible Duplicate Work — Manual Verification Required."


class DuplicateCaseCreateRequest(BaseModel):
    notes: str = Field(default="", max_length=2000)
    assigned_to: str = Field(default="", max_length=200)


class DuplicateReviewRequest(BaseModel):
    notes: str = Field(default="", max_length=2000)
    assigned_to: str = Field(default="", max_length=200)


class DuplicateCaseResponse(BaseModel):
    case_id: str
    match_id: str
    work_ids: list[str]
    status: str
    notes: str
    assigned_to: str
    created_by: str
    created_at: datetime
