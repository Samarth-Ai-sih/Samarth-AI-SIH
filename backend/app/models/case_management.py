"""Case-management and field-inspection schemas for Phase 13."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator


class CaseStatus(str, Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    UNDER_REVIEW = "under_review"
    CLARIFICATION_REQUESTED = "clarification_requested"
    INSPECTION_ASSIGNED = "inspection_assigned"
    EVIDENCE_SUBMITTED = "evidence_submitted"
    CORRECTIVE_ACTION_PLANNED = "corrective_action_planned"
    RESOLVED = "resolved"
    REJECTED_FALSE_POSITIVE = "rejected_false_positive"
    ESCALATED = "escalated"
    REOPENED = "reopened"


class CaseSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class CaseSourceType(str, Enum):
    MANUAL = "manual"
    RISK_ALERT = "risk_alert"
    DUPLICATE_WORK = "duplicate_work"
    EVIDENCE_SIGNAL = "evidence_signal"
    FINANCIAL_SIGNAL = "financial_signal"


class CaseComment(BaseModel):
    comment_id: str
    author_user_id: str
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CaseRequest(BaseModel):
    request_id: str
    request_type: str
    requested_by: str
    reason: str
    status: str = "open"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CorrectivePlan(BaseModel):
    plan_id: str
    summary: str
    actions: list[str] = Field(default_factory=list)
    owner_user_id: Optional[str] = None
    target_date: Optional[datetime] = None
    created_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class InspectionChecklist(BaseModel):
    asset_found: bool
    work_active: bool
    verified_physical_progress_pct: float = Field(ge=0, le=100)
    quality_concern: bool
    work_delayed: bool
    cause_of_delay: str = Field(default="", max_length=1000)
    additional_remarks: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def validate_delay_cause(self) -> "InspectionChecklist":
        if self.work_delayed and not self.cause_of_delay.strip():
            raise ValueError("Cause of delay is required when work is delayed")
        return self


class InspectionReport(BaseModel):
    """Private stored inspection report. Case APIs require investigation permissions."""

    report_id: str
    case_id: str
    work_id: str
    inspector_user_id: str
    checklist: InspectionChecklist
    gps_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    gps_timestamp: Optional[datetime] = None
    gps_distance_from_project_meters: Optional[float] = Field(default=None, ge=0)
    evidence_ids: list[str] = Field(default_factory=list)
    remarks: str = Field(default="", max_length=5000)
    offline_client_id: Optional[str] = Field(default=None, max_length=120)
    submitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CaseEvent(BaseModel):
    event_id: str
    event_type: str
    actor_user_id: str
    reason: str = ""
    details: dict[str, str] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CaseRecord(BaseModel):
    """MongoDB case document. Lifecycle history is immutable append-only metadata."""

    case_id: str
    work_id: str
    source_type: CaseSourceType = CaseSourceType.MANUAL
    source_id: Optional[str] = None
    title: str
    description: str = ""
    status: CaseStatus = CaseStatus.NEW
    severity: CaseSeverity = CaseSeverity.MEDIUM
    owner_user_id: Optional[str] = None
    assigned_inspector_id: Optional[str] = None
    due_date: Optional[datetime] = None
    corrective_plan: Optional[CorrectivePlan] = None
    clarification_requests: list[CaseRequest] = Field(default_factory=list)
    document_requests: list[CaseRequest] = Field(default_factory=list)
    comments: list[CaseComment] = Field(default_factory=list)
    inspection_reports: list[InspectionReport] = Field(default_factory=list)
    events: list[CaseEvent] = Field(default_factory=list)
    state_code: str = ""
    district_code: str = ""
    created_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: Optional[datetime] = None
    rejection_reason: str = ""
    closure_reason: str = ""
    escalation_reason: str = ""
    escalation_level: str = "district"
    escalated_at: Optional[datetime] = None
    anomaly_category: Optional[str] = None
    target_authority_role: Optional[str] = None
    target_authority_name: Optional[str] = None
    verification_scope: Optional[str] = None
    specific_questions: list[str] = Field(default_factory=list)
    anomaly_metrics: dict[str, Any] = Field(default_factory=dict)
    verification_finding: Optional[str] = None


class CaseCreateRequest(BaseModel):
    work_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(default="", max_length=3000)
    severity: CaseSeverity = CaseSeverity.MEDIUM
    source_type: CaseSourceType = CaseSourceType.MANUAL
    source_id: Optional[str] = Field(default=None, max_length=150)
    due_date: Optional[datetime] = None
    anomaly_category: Optional[str] = None
    target_authority_role: Optional[str] = None
    target_authority_name: Optional[str] = None
    verification_scope: Optional[str] = None
    specific_questions: list[str] = Field(default_factory=list)
    anomaly_metrics: dict[str, Any] = Field(default_factory=dict)


class CaseCommentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=3000)


class CaseAssignmentRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=120)
    reason: str = Field(default="", max_length=1000)


class CaseDueDateRequest(BaseModel):
    due_date: datetime
    reason: str = Field(default="", max_length=1000)


class CaseSeverityRequest(BaseModel):
    severity: CaseSeverity
    reason: str = Field(default="", max_length=1000)


class CaseReasonRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=3000)


class CaseCorrectivePlanRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=3000)
    actions: list[str] = Field(default_factory=list, max_length=20)
    owner_user_id: Optional[str] = Field(default=None, max_length=120)
    target_date: Optional[datetime] = None


class CaseOverrideRequest(BaseModel):
    status: CaseStatus
    severity: Optional[CaseSeverity] = None
    reason: str = Field(min_length=1, max_length=3000)


class InspectionReportCreateRequest(BaseModel):
    checklist: InspectionChecklist
    gps_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    gps_longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    gps_timestamp: Optional[datetime] = None
    evidence_ids: list[str] = Field(default_factory=list, max_length=20)
    remarks: str = Field(default="", max_length=5000)
    offline_client_id: Optional[str] = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_gps_pair(self) -> "InspectionReportCreateRequest":
        if (self.gps_latitude is None) != (self.gps_longitude is None):
            raise ValueError("GPS latitude and longitude must be supplied together")
        return self


class CaseAssignee(BaseModel):
    user_id: str
    full_name: str
    role: str
    state_code: Optional[str] = None
    district_code: Optional[str] = None


class InspectionReportResponse(BaseModel):
    report_id: str
    case_id: str
    work_id: str
    inspector_user_id: str
    checklist: InspectionChecklist
    gps_available: bool
    gps_timestamp: Optional[datetime] = None
    gps_distance_from_project_meters: Optional[float] = None
    evidence_ids: list[str]
    remarks: str
    submitted_at: datetime


class CaseResponse(BaseModel):
    case_id: str
    work_id: str
    source_type: CaseSourceType
    source_id: Optional[str] = None
    title: str
    description: str
    status: CaseStatus
    severity: CaseSeverity
    owner_user_id: Optional[str] = None
    assigned_inspector_id: Optional[str] = None
    due_date: Optional[datetime] = None
    corrective_plan: Optional[CorrectivePlan] = None
    clarification_requests: list[CaseRequest]
    document_requests: list[CaseRequest]
    comments: list[CaseComment]
    inspection_reports: list[InspectionReportResponse]
    events: list[CaseEvent]
    created_by: str
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None
    rejection_reason: str = ""
    closure_reason: str = ""
    escalation_reason: str = ""
    escalation_level: str = "district"
    escalated_at: Optional[datetime] = None
    anomaly_category: Optional[str] = None
    target_authority_role: Optional[str] = None
    target_authority_name: Optional[str] = None
    verification_scope: Optional[str] = None
    specific_questions: list[str] = Field(default_factory=list)
    anomaly_metrics: dict[str, Any] = Field(default_factory=dict)
    verification_finding: Optional[str] = None


class CaseListResponse(BaseModel):
    cases: list[CaseResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class InspectionSubmissionResponse(BaseModel):
    case: CaseResponse
    report: InspectionReportResponse
    risk_recalculated: bool
    risk_score_id: Optional[str] = None
    district_authorities_notified: int = 0


class InspectionWorkSummary(BaseModel):
    work_id: str
    title: str
    description: str = ""
    status: str = ""
    physical_progress_pct: float = 0.0
    state_name: str = ""
    district_name: str = ""
    implementing_agency: str = ""
    location_latitude: Optional[float] = None
    location_longitude: Optional[float] = None
    location_address: str = ""


class InspectionTaskResponse(BaseModel):
    case: CaseResponse
    work: InspectionWorkSummary


class NotificationResponse(BaseModel):
    notification_id: str
    case_id: str
    work_id: str
    title: str
    message: str
    read_at: Optional[datetime] = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    total: int
