"""
SAMARTH AI -- Compliance Engine Models

Pydantic models for the configurable compliance rule engine:
- ComplianceRule: versioned rule definition with configurable thresholds
- ComplianceResult: evaluation outcome for a single rule against a work
- Request/response schemas for CRUD and batch operations

All language uses "compliance deviation" and "requires verification" --
nothing is labelled as confirmed fraud.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# -- Enums ----------------------------------------------------------------


class RuleSeverity(str, Enum):
    """Severity level of a compliance rule."""
    INFO = "info"
    ADVISORY = "advisory"
    WARNING = "warning"
    CRITICAL = "critical"


class RuleCategory(str, Enum):
    """Functional category for grouping rules."""
    TIMELINE = "timeline"
    FINANCIAL = "financial"
    DOCUMENTATION = "documentation"
    LOCATION = "location"
    ELIGIBILITY = "eligibility"


class ResultStatus(str, Enum):
    """Outcome of evaluating a rule against a work."""
    DEVIATION_DETECTED = "deviation_detected"
    COMPLIANT = "compliant"
    NOT_APPLICABLE = "not_applicable"


class ReviewStatus(str, Enum):
    """Review workflow status for a compliance result."""
    PENDING_REVIEW = "pending_review"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


# -- Rule Definition ------------------------------------------------------


class ComplianceRule(BaseModel):
    """
    A versioned compliance rule stored in the `compliance_rules` collection.

    When thresholds are updated a new version is created; the previous
    version is preserved for auditability.
    """
    rule_id: str
    rule_code: str                          # e.g. "REC_SANC_DELAY"
    version: int = 1
    name: str                               # Human-readable name
    description: str = ""
    severity: RuleSeverity = RuleSeverity.WARNING
    category: RuleCategory = RuleCategory.TIMELINE
    enabled: bool = True
    thresholds: dict[str, Any] = Field(default_factory=dict)

    created_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# -- Compliance Result -----------------------------------------------------


class ComplianceResult(BaseModel):
    """
    The output of evaluating one rule against one work.

    `threshold_snapshot` freezes the exact thresholds used so that
    historical results remain interpretable even after rule updates.
    """
    result_id: str
    rule_id: str
    rule_code: str
    work_id: str

    severity: RuleSeverity
    status: ResultStatus
    message: str = ""                       # Human-readable summary

    threshold_snapshot: dict[str, Any] = Field(default_factory=dict)
    triggered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    supporting_data: dict[str, Any] = Field(default_factory=dict)

    review_status: ReviewStatus = ReviewStatus.PENDING_REVIEW
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: str = ""


# -- Request Schemas -------------------------------------------------------


class RuleCreateRequest(BaseModel):
    """Create a new compliance rule."""
    rule_code: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=1000)
    severity: RuleSeverity = RuleSeverity.WARNING
    category: RuleCategory = RuleCategory.TIMELINE
    enabled: bool = True
    thresholds: dict[str, Any] = Field(default_factory=dict)


class RuleUpdateRequest(BaseModel):
    """Update a compliance rule (creates a new version)."""
    name: Optional[str] = Field(default=None, min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    severity: Optional[RuleSeverity] = None
    enabled: Optional[bool] = None
    thresholds: Optional[dict[str, Any]] = None


class ResultReviewRequest(BaseModel):
    """Update the review status of a compliance result."""
    review_status: ReviewStatus
    review_notes: str = Field(default="", max_length=2000)


# -- Response Schemas ------------------------------------------------------


class RuleResponse(BaseModel):
    """Public API representation of a compliance rule."""
    rule_id: str
    rule_code: str
    version: int
    name: str
    description: str
    severity: RuleSeverity
    category: RuleCategory
    enabled: bool
    thresholds: dict[str, Any]
    created_by: str
    created_at: datetime
    updated_at: datetime


class RuleListResponse(BaseModel):
    """Paginated list of compliance rules."""
    rules: list[RuleResponse]
    total: int


class ResultResponse(BaseModel):
    """Public API representation of a compliance result."""
    result_id: str
    rule_id: str
    rule_code: str
    work_id: str
    severity: RuleSeverity
    status: ResultStatus
    message: str
    threshold_snapshot: dict[str, Any]
    triggered_at: datetime
    supporting_data: dict[str, Any]
    review_status: ReviewStatus
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    review_notes: str


class ResultListResponse(BaseModel):
    """Paginated list of compliance results."""
    results: list[ResultResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class BatchRunResponse(BaseModel):
    """Response from a batch compliance run."""
    works_evaluated: int
    total_results: int
    deviations_found: int
    compliant: int
    not_applicable: int
    run_duration_ms: int
