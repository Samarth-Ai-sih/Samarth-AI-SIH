"""Schemas for Anomaly & Fraud Detection, Verification Routing, and Project Story Dossier."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class AnomalyCategory(str, Enum):
    COST_OVERRUN = "cost_overrun"
    DUPLICATE_WORK = "duplicate_work"
    UNUSUAL_PAYMENT_TIMING = "unusual_payment_timing"
    DEVIATION_FROM_NORMS = "deviation_from_norms"
    STALLED_PROJECT = "stalled_project"
    FINANCIAL_IRREGULARITY = "financial_irregularity"


class AnomalySeverity(str, Enum):
    NORMAL = "normal"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AuthorityRole(str, Enum):
    FINANCE_OFFICER = "finance_officer"
    FIELD_INSPECTOR = "inspector"
    DISTRICT_AUTHORITY = "district_authority"
    STATE_NODAL_OFFICER = "state_nodal_officer"
    TECHNICAL_EXAMINER = "technical_examiner"


class AnomalyDiagnosis(BaseModel):
    """Evaluation result for one anomaly category."""

    category: AnomalyCategory
    title: str
    is_flagged: bool
    severity: AnomalySeverity = AnomalySeverity.NORMAL
    finding_summary: str
    metrics: dict[str, Any] = Field(default_factory=dict)
    recommended_authority_role: AuthorityRole
    suggested_questions: list[str] = Field(default_factory=list)
    verification_status: str = "requires_verification"


class UnifiedTimelineItem(BaseModel):
    """Chronological event in the project's story."""

    item_id: str
    timestamp: datetime
    event_type: str  # sanction, payment_tranche, progress_update, field_inspection, anomaly_flag, verification_request, citizen_report, status_change
    title: str
    description: str
    actor: str = "System"
    badge_color: str = "slate"  # emerald, amber, rose, sky, purple, slate
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuthorityOption(BaseModel):
    """Selectable authority user for dispatching verification requests."""

    user_id: str
    full_name: str
    role: str
    authority_type: AuthorityRole
    jurisdiction_label: str


class ProjectStoryResponse(BaseModel):
    """Comprehensive dossier response: what happened in this project."""

    work_id: str
    title: str
    category: str
    status: str
    state_code: str = ""
    state_name: str = ""
    district_code: str = ""
    district_name: str = ""
    constituency: str = ""
    mp_name: str = ""
    implementing_agency: str = ""
    sanctioned_amount: float = 0.0
    funds_released: float = 0.0
    actual_expenditure: float = 0.0
    physical_progress_pct: float = 0.0
    financial_progress_pct: float = 0.0
    financial_physical_gap_pct: float = 0.0
    sanctioned_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    expected_completion_date: Optional[datetime] = None
    actual_completion_date: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None
    executive_story: str
    anomaly_diagnoses: list[AnomalyDiagnosis] = Field(default_factory=list)
    unified_timeline: list[UnifiedTimelineItem] = Field(default_factory=list)
    verification_requests: list[dict[str, Any]] = Field(default_factory=list)
    citizen_reports: list[dict[str, Any]] = Field(default_factory=list)
    legal_disclaimer: str = (
        "Possible anomaly and irregularity signals are analytical prioritisation aids requiring human verification. "
        "They do not constitute judicial, statutory, or disciplinary findings of fraud or misconduct."
    )


class VerificationRequestCreate(BaseModel):
    """Payload to generate a verification request to a related authority."""

    work_id: str = Field(min_length=1, max_length=120)
    anomaly_category: AnomalyCategory
    target_authority_role: AuthorityRole
    target_authority_user_id: Optional[str] = None
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(default="", max_length=3000)
    verification_scope: str = Field(default="Ground & Financial Audit", max_length=500)
    specific_questions: list[str] = Field(default_factory=list, max_length=20)
    priority: str = Field(default="high", max_length=50)
    due_date: Optional[datetime] = None


class VerificationRequestResponse(BaseModel):
    """Confirmation payload upon generating a verification request."""

    case_id: str
    work_id: str
    title: str
    status: str
    anomaly_category: str
    target_authority_role: str
    assigned_to: Optional[str] = None
    assigned_name: Optional[str] = None
    message: str
