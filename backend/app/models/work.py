"""
SAMARTH AI — Work Models

Pydantic models for MPLADS work lifecycle:
- Work statuses (8-stage lifecycle)
- Financial tracking (sanctions, releases, expenditure)
- Payment tranches
- Progress updates
- Timeline events
- Work 360° aggregated view

Used by WorkService and the /api/v1/works endpoints.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator


# ── Work Status Enum ─────────────────────────────────────────────


class WorkStatus(str, Enum):
    """MPLADS work lifecycle statuses."""
    RECOMMENDED = "recommended"
    UNDER_REVIEW = "under_review"
    SANCTIONED = "sanctioned"
    IN_PROGRESS = "in_progress"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    UNDER_VERIFICATION = "under_verification"
    CANCELLED = "cancelled"


class WorkCategory(str, Enum):
    """Broad categories of MPLADS works."""
    EDUCATION = "education"
    HEALTHCARE = "healthcare"
    DRINKING_WATER = "drinking_water"
    ROADS_AND_BRIDGES = "roads_and_bridges"
    SANITATION = "sanitation"
    COMMUNITY_INFRASTRUCTURE = "community_infrastructure"
    SPORTS = "sports"
    ELECTRICITY = "electricity"
    IRRIGATION = "irrigation"
    OTHER = "other"


# ── Embedded Sub-Models ──────────────────────────────────────────


class WorkLocation(BaseModel):
    """Geographic coordinates and address for the work site."""
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    address: Optional[str] = None

    @model_validator(mode="after")
    def require_coordinate_pair(self) -> "WorkLocation":
        """A single coordinate is not a usable or safe project location."""
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Both latitude and longitude are required when recording a work location")
        return self


class PaymentTranche(BaseModel):
    """A single payment tranche released for a work."""
    tranche_id: str
    tranche_number: int
    amount: float
    released_date: datetime
    purpose: str = ""
    released_by: str = ""
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class ProgressUpdate(BaseModel):
    """A progress update snapshot for a work."""
    update_id: str
    date: datetime
    physical_progress_pct: float = Field(ge=0, le=100)
    description: str = ""
    updated_by: str = ""
    attachments: list[str] = Field(default_factory=list)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class TimelineEvent(BaseModel):
    """An event in the work's lifecycle timeline."""
    event_id: str
    timestamp: datetime
    event_type: str
    title: str
    description: str = ""
    actor: str = ""


# ── Full Work Document ───────────────────────────────────────────


class WorkInDB(BaseModel):
    """Work document as stored in MongoDB `works` collection."""

    # Identity
    work_id: str
    title: str
    description: str = ""
    status: WorkStatus = WorkStatus.RECOMMENDED
    category: WorkCategory = WorkCategory.OTHER
    sub_category: str = ""

    # Geography / jurisdiction
    state_code: str = ""
    state_name: str = ""
    district_code: str = ""
    district_name: str = ""
    constituency: str = ""
    pincode: str = ""

    # Stakeholders
    mp_name: str = ""
    mp_id: Optional[str] = None
    implementing_agency: str = ""

    # Financials
    sanctioned_amount: float = 0.0
    funds_released: float = 0.0
    actual_expenditure: float = 0.0

    # Dates
    recommended_date: Optional[datetime] = None
    sanctioned_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    expected_completion_date: Optional[datetime] = None
    actual_completion_date: Optional[datetime] = None

    # Physical progress (latest %)
    physical_progress_pct: float = 0.0

    # Location
    location: WorkLocation = Field(default_factory=WorkLocation)

    # Risk placeholders
    composite_risk_score: Optional[float] = None
    risk_tier: Optional[str] = None

    # Embedded collections
    payment_tranches: list[PaymentTranche] = Field(default_factory=list)
    progress_updates: list[ProgressUpdate] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)

    # Metadata
    # Provenance is intentionally explicit.  It prevents synthetic demo records
    # from being mistaken for operator-entered or imported source records.
    data_source: str = "operator_entered"
    created_by: str = ""
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# ── Request Schemas ──────────────────────────────────────────────


class WorkCreateRequest(BaseModel):
    """Create a new MPLADS work."""
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(default="", max_length=2000)
    category: WorkCategory = WorkCategory.OTHER
    sub_category: str = Field(default="", max_length=100)

    state_code: str = Field(min_length=1, max_length=10)
    state_name: str = Field(min_length=1, max_length=100)
    district_code: str = Field(default="", max_length=10)
    district_name: str = Field(default="", max_length=100)
    constituency: str = Field(default="", max_length=100)
    pincode: str = Field(default="", max_length=12, pattern=r"^[0-9-]*$")

    mp_name: str = Field(default="", max_length=150)
    mp_id: Optional[str] = None
    implementing_agency: str = Field(default="", max_length=200)

    sanctioned_amount: float = Field(default=0.0, ge=0)
    recommended_date: Optional[datetime] = None
    expected_completion_date: Optional[datetime] = None

    location: Optional[WorkLocation] = None


class WorkUpdateRequest(BaseModel):
    """Partial update for work fields."""
    title: Optional[str] = Field(default=None, min_length=3, max_length=300)
    description: Optional[str] = Field(default=None, max_length=2000)
    category: Optional[WorkCategory] = None
    sub_category: Optional[str] = Field(default=None, max_length=100)
    pincode: Optional[str] = Field(default=None, max_length=12, pattern=r"^[0-9-]*$")
    implementing_agency: Optional[str] = Field(default=None, max_length=200)
    sanctioned_amount: Optional[float] = Field(default=None, ge=0)
    expected_completion_date: Optional[datetime] = None
    location: Optional[WorkLocation] = None


class WorkStatusUpdateRequest(BaseModel):
    """Update work status with a reason."""
    status: WorkStatus
    reason: str = Field(default="", max_length=500)


class PaymentTrancheCreateRequest(BaseModel):
    """Add a payment tranche to a work."""
    amount: float = Field(gt=0)
    released_date: datetime
    purpose: str = Field(default="", max_length=300)


class ProgressUpdateCreateRequest(BaseModel):
    """Add a progress update to a work."""
    physical_progress_pct: float = Field(ge=0, le=100)
    description: str = Field(default="", max_length=1000)
    date: Optional[datetime] = None
    attachments: list[str] = Field(default_factory=list)


# ── Response Schemas ─────────────────────────────────────────────


class WorkSummaryResponse(BaseModel):
    """Lightweight work summary for list views."""
    work_id: str
    title: str
    status: WorkStatus
    category: WorkCategory
    state_code: str = ""
    state_name: str
    district_code: str = ""
    district_name: str
    constituency: str
    pincode: str = ""
    mp_name: str
    implementing_agency: str
    sanctioned_amount: float
    funds_released: float
    actual_expenditure: float
    physical_progress_pct: float
    composite_risk_score: Optional[float] = None
    risk_tier: Optional[str] = None
    recommended_date: Optional[datetime] = None
    sanctioned_date: Optional[datetime] = None
    expected_completion_date: Optional[datetime] = None
    created_at: datetime
    # Internal work queues can distinguish controlled demo records from
    # operator-entered records without exposing provenance on public routes.
    data_source: str = "operator_entered"


class WorkListResponse(BaseModel):
    """Paginated work list."""
    works: list[WorkSummaryResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class MapWorkMarkerResponse(BaseModel):
    """Allow-listed internal map marker.  It intentionally excludes evidence and case data."""

    work_id: str
    title: str
    status: WorkStatus
    category: WorkCategory
    state_code: str = ""
    state_name: str = ""
    district_code: str = ""
    district_name: str = ""
    constituency: str = ""
    mp_name: str = ""
    implementing_agency: str = ""
    physical_progress_pct: float = Field(ge=0, le=100)
    location: WorkLocation
    last_updated_at: datetime
    # These values are redacted per caller permission.  Keeping them optional
    # prevents the map endpoint becoming a side channel for restricted data.
    sanctioned_amount: Optional[float] = None
    funds_released: Optional[float] = None
    actual_expenditure: Optional[float] = None
    composite_risk_score: Optional[float] = None
    risk_tier: Optional[str] = None
    location_notice: str = "Stored work coordinates; accuracy has not been independently verified."


class WorkMapResponse(BaseModel):
    """A bounded, paginated map response backed by MongoDB work records."""

    markers: list[MapWorkMarkerResponse]
    total_matching_works: int
    works_with_valid_coordinates: int
    works_without_valid_coordinates: int
    page: int
    page_size: int
    total_pages: int
    bounding_box_applied: bool = False
    data_notice: str = (
        "Only works with valid coordinates stored in MongoDB are shown as markers. "
        "No boundary or approximate location data is fabricated."
    )


class PaymentTrancheResponse(BaseModel):
    """Payment tranche for API responses."""
    tranche_id: str
    tranche_number: int
    amount: float
    released_date: datetime
    purpose: str
    released_by: str
    created_at: datetime


class ProgressUpdateResponse(BaseModel):
    """Progress update for API responses."""
    update_id: str
    date: datetime
    physical_progress_pct: float
    description: str
    updated_by: str
    attachments: list[str]
    created_at: datetime


class TimelineEventResponse(BaseModel):
    """Timeline event for API responses."""
    event_id: str
    timestamp: datetime
    event_type: str
    title: str
    description: str
    actor: str


class WorkDetailResponse(BaseModel):
    """Full work detail — used for the Work 360° view."""
    # Identity
    work_id: str
    title: str
    description: str
    status: WorkStatus
    category: WorkCategory
    sub_category: str

    # Geography
    state_code: str
    state_name: str
    district_code: str
    district_name: str
    constituency: str
    pincode: str = ""

    # Stakeholders
    mp_name: str
    mp_id: Optional[str]
    implementing_agency: str

    # Financials
    sanctioned_amount: float
    funds_released: float
    actual_expenditure: float

    # Dates
    recommended_date: Optional[datetime]
    sanctioned_date: Optional[datetime]
    start_date: Optional[datetime]
    expected_completion_date: Optional[datetime]
    actual_completion_date: Optional[datetime]

    # Progress
    physical_progress_pct: float

    # Location
    location: WorkLocation

    # Risk placeholders
    composite_risk_score: Optional[float]
    risk_tier: Optional[str]

    # Embedded collections
    payment_tranches: list[PaymentTrancheResponse]
    progress_updates: list[ProgressUpdateResponse]
    timeline: list[TimelineEventResponse]

    # Metadata
    created_by: str
    created_at: datetime
    updated_at: datetime
    data_source: str = "operator_entered"
