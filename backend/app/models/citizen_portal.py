"""Public-safe citizen portal and social-audit schemas for Phase 14."""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from app.models.work import WorkCategory, WorkStatus


class CitizenIssueType(str, Enum):
    WORK_NOT_STARTED = "work_not_started"
    WORK_APPEARS_STOPPED = "work_appears_stopped"
    ASSET_NOT_VISIBLE = "asset_not_visible"
    QUALITY_CONCERN = "quality_concern"
    INCORRECT_INFORMATION = "incorrect_information"
    DELAY = "delay"
    OTHER = "other"



class CitizenIssueStatus(str, Enum):
    RECEIVED = "received"
    UNDER_REVIEW = "under_review"
    INSPECTION_ASSIGNED = "inspection_assigned"
    RESOLVED = "resolved"
    CLOSED = "closed"


class PublicWorkSummary(BaseModel):
    """Explicit allow-list for unauthenticated work discovery responses."""

    work_id: str
    title: str
    category: WorkCategory
    status: WorkStatus
    state_name: str = ""
    district_name: str = ""
    constituency: str = ""
    mp_name: str = ""
    pincode: str = ""
    physical_progress_pct: float = Field(ge=0, le=100)
    location_address: str = ""
    expected_completion_date: Optional[datetime] = None
    qr_payload: str


class PublicWorkDetail(PublicWorkSummary):
    description: str = ""
    sub_category: str = ""
    start_date: Optional[datetime] = None
    actual_completion_date: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None
    public_notice: str = "Public information only. Internal review, risk, financial, agency, evidence, and investigation records are not available here."


class PublicWorkListResponse(BaseModel):
    works: list[PublicWorkSummary]
    total: int
    page: int
    page_size: int
    total_pages: int
    public_notice: str = "Search results contain only public-safe work information."


class CitizenVerificationChallenge(BaseModel):
    verification_id: str
    prompt: str
    expires_at: datetime
    notice: str = "Demo human-verification challenge. It does not establish identity."


class CitizenIssueCreateRequest(BaseModel):
    work_id: str = Field(min_length=1, max_length=120)
    issue_type: CitizenIssueType
    description: str = Field(min_length=10, max_length=3000)
    location_consent: bool = False
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    verification_id: str = Field(min_length=1, max_length=120)
    verification_answer: str = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def require_location_consent(self) -> "CitizenIssueCreateRequest":
        supplied_location = self.latitude is not None or self.longitude is not None
        if supplied_location and not self.location_consent:
            raise ValueError("Location coordinates require explicit consent")
        if self.location_consent and (self.latitude is None or self.longitude is None):
            raise ValueError("Both latitude and longitude are required when sharing location")
        return self


class CitizenIssueReceipt(BaseModel):
    reference_id: str
    status: CitizenIssueStatus
    submitted_at: datetime
    photo_upload_token: str = Field(description="One-time private upload capability; never returned by tracking endpoints.")
    photo_upload_expires_at: datetime
    message: str = "Your ground issue has been received. Keep the reference ID to track public status."


class CitizenIssueTrackingResponse(BaseModel):
    reference_id: str
    work_id: str
    work_title: str
    issue_type: CitizenIssueType
    status: CitizenIssueStatus
    status_message: str
    submitted_at: datetime
    updated_at: datetime
    evidence_received: bool
    public_notice: str = "Tracking never includes investigation notes, identity/contact data, private evidence, risk data, or restricted financial data."


class CitizenEvidenceUploadResponse(BaseModel):
    evidence_received: bool = True
    message: str = "Private evidence received. It is not publicly available."


class CitizenEvidenceItem(BaseModel):
    evidence_id: str
    content_type: str
    file_size_bytes: int
    received_at: datetime
    url: Optional[str] = None
    restricted: bool = False
    restriction_message: Optional[str] = None


class CitizenIssueCreateCaseRequest(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    severity: str = "medium"
    due_date: Optional[datetime] = None
    assigned_inspector_id: Optional[str] = None
    case_notes: str = ""


class CitizenIssueModerationUpdate(BaseModel):
    status: CitizenIssueStatus
    public_status_message: str = Field(default="", max_length=600)
    reason: str = Field(default="", max_length=2000)
    assigned_inspector_id: Optional[str] = Field(default=None, max_length=120)


class CitizenIssueModerationResponse(BaseModel):
    reference_id: str
    work_id: str
    work_title: str
    issue_type: CitizenIssueType
    description: str
    status: CitizenIssueStatus
    public_status_message: str
    location_consent: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    evidence_count: int
    assigned_inspector_id: Optional[str] = None
    submitted_at: datetime
    updated_at: datetime
    moderation_reason: str = ""
    evidence_items: list[CitizenEvidenceItem] = []
    can_view_images: bool = False
    linked_case_id: Optional[str] = None


class CitizenIssueModerationList(BaseModel):
    reports: list[CitizenIssueModerationResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CitizenReportPublicSummary(BaseModel):
    reference_id: str
    work_title: str
    district_name: str = ""
    state_name: str = ""
    category: str = ""
    issue_type: str
    status: str
    status_message: str
    changes_done: str
    submitted_at: datetime
    updated_at: datetime


class CitizenRecentUpdatesResponse(BaseModel):
    reports: list[CitizenReportPublicSummary]
    total: int


class CitizenCommunityIssueItem(BaseModel):
    reference_id: str
    work_id: str
    work_title: str
    district_name: str = ""
    state_name: str = ""
    category: str = ""
    issue_type: str
    description: str
    status: str
    status_message: str
    changes_done: str = ""
    evidence_received: bool = False
    evidence_count: int = 0
    submitted_at: datetime
    updated_at: datetime


class CitizenCommunityIssueListResponse(BaseModel):
    issues: list[CitizenCommunityIssueItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class CitizenPersonalIssueItem(BaseModel):
    reference_id: str
    work_id: str
    work_title: str
    district_name: str = ""
    state_name: str = ""
    category: str = ""
    issue_type: str
    description: str
    status: str
    status_message: str
    moderation_reason: str = ""
    assigned_inspector_name: Optional[str] = None
    evidence_received: bool = False
    evidence_count: int = 0
    location_consent: bool = False
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    submitted_at: datetime
    updated_at: datetime


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


