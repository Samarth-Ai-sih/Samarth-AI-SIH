"""Phase 16 schemas for durable jobs, notifications, and escalation routing."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BackgroundJobType(str, Enum):
    SCHEDULED_DATA_INGESTION = "scheduled_data_ingestion"
    BATCH_RISK_SCORING = "batch_risk_scoring"
    ALERT_GENERATION = "alert_generation"
    SLA_MONITORING = "sla_monitoring"
    AUTO_ESCALATION = "auto_escalation"
    EXIF_EXTRACTION = "exif_extraction"
    PHASH_GENERATION = "phash_generation"
    DUPLICATE_WORK_SCAN = "duplicate_work_scan"
    NOTIFICATION_DELIVERY = "notification_delivery"
    REPORT_GENERATION = "report_generation"
    MODEL_MONITORING = "model_monitoring"


class BackgroundJobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


class BackgroundJobRecord(BaseModel):
    job_id: str
    job_type: BackgroundJobType
    status: BackgroundJobStatus = BackgroundJobStatus.QUEUED
    idempotency_key: str
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error_summary: str = ""
    attempt_count: int = Field(default=0, ge=0)
    max_retries: int = Field(default=4, ge=0)
    celery_task_id: Optional[str] = None
    requested_by: str = "system"
    created_at: datetime = Field(default_factory=utc_now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime = Field(default_factory=utc_now)


class JobTriggerRequest(BaseModel):
    """An idempotent, admin-requested background operation."""

    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: Optional[str] = Field(default=None, max_length=200)


class BackgroundJobListResponse(BaseModel):
    jobs: list[BackgroundJobRecord]
    total: int


class NotificationEventType(str, Enum):
    RED_ALERT_ASSIGNED = "red_alert_assigned"
    SLA_BREACH_APPROACHING = "sla_breach_approaching"
    CASE_ESCALATED = "case_escalated"
    INSPECTOR_ASSIGNED = "inspector_assigned"
    INSPECTION_SUBMITTED = "inspection_submitted"
    CLARIFICATION_REQUESTED = "clarification_requested"
    CITIZEN_REPORT_UPDATED = "citizen_report_updated"
    MATERIAL_RISK_SCORE_CHANGE = "material_risk_score_change"
    VERIFICATION_REQUEST_ASSIGNED = "verification_request_assigned"
    CASE_OWNER_ASSIGNED = "case_owner_assigned"
    CITIZEN_ISSUE_RAISED = "citizen_issue_raised"


class NotificationChannel(str, Enum):
    IN_APP = "in_app"
    EMAIL = "email"
    SMS = "sms"
    WHATSAPP = "whatsapp"


class NotificationDeliveryStatus(str, Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"
    SKIPPED = "skipped"


class NotificationRecord(BaseModel):
    notification_id: str
    recipient_user_id: str
    event_type: NotificationEventType
    title: str
    message: str
    resource_type: str
    resource_id: str
    idempotency_key: str
    in_app_visible: bool = True
    read_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)


class NotificationDeliveryRecord(BaseModel):
    delivery_id: str
    notification_id: str
    channel: NotificationChannel
    status: NotificationDeliveryStatus = NotificationDeliveryStatus.PENDING
    attempt_count: int = Field(default=0, ge=0)
    last_error: str = ""
    provider_message_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    delivered_at: Optional[datetime] = None
    updated_at: datetime = Field(default_factory=utc_now)


class NotificationPreference(BaseModel):
    user_id: str
    in_app_enabled: bool = True
    email_enabled: bool = False
    sms_enabled: bool = False
    whatsapp_enabled: bool = False
    event_overrides: dict[str, bool] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=utc_now)


class NotificationPreferenceUpdate(BaseModel):
    in_app_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    whatsapp_enabled: Optional[bool] = None
    event_overrides: Optional[dict[str, bool]] = None


class NotificationListResponse(BaseModel):
    notifications: list[NotificationRecord]
    total: int
    unread_total: int


class ManualEscalationRequest(BaseModel):
    case_id: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=3, max_length=2000)


class ManualEscalationResponse(BaseModel):
    job: BackgroundJobRecord
    escalation_level: str
    notice: str = "Manual demo fallback completed. Review the escalation before taking further action."
