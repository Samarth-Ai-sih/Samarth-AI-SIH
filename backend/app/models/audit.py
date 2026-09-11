"""
SAMARTH AI — Audit Log Models

Structured audit trail for security-relevant events.
Retention is configurable via AUDIT_LOG_RETENTION_DAYS (0 = infinite).
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class AuditEventType(str, Enum):
    """All auditable security events."""
    # Auth events
    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    TOKEN_REFRESH = "token_refresh"

    # Authorization events
    ACCESS_DENIED = "access_denied"

    # User management events
    USER_CREATED = "user_created"
    ROLE_CHANGE = "role_change"
    JURISDICTION_CHANGE = "jurisdiction_change"
    USER_STATUS_CHANGE = "user_status_change"
    PASSWORD_CHANGE = "password_change"
    SESSION_REVOCATION = "session_revocation"

    # Data access events
    EVIDENCE_ACCESS = "evidence_access"
    EVIDENCE_UPLOAD_SIGNATURE_ISSUED = "evidence_upload_signature_issued"
    EVIDENCE_UPLOADED = "evidence_uploaded"
    EVIDENCE_VERIFIED = "evidence_verified"
    EVIDENCE_DUPLICATE_SCAN = "evidence_duplicate_scan"
    INVESTIGATION_CHANGE = "investigation_change"
    PAYMENT_CHANGE = "payment_change"

    # Case management and field inspection lifecycle events
    CASE_CREATED = "case_created"
    CASE_UPDATED = "case_updated"
    CASE_ASSIGNED = "case_assigned"
    CASE_COMMENT_ADDED = "case_comment_added"
    CASE_ESCALATED = "case_escalated"
    CASE_RESOLVED = "case_resolved"
    CASE_REJECTED = "case_rejected"
    CASE_REOPENED = "case_reopened"
    INSPECTION_ASSIGNED = "inspection_assigned"
    INSPECTION_REPORT_SUBMITTED = "inspection_report_submitted"
    DISTRICT_AUTHORITY_NOTIFIED = "district_authority_notified"

    # Citizen portal and social-audit lifecycle events
    CITIZEN_ISSUE_RECEIVED = "citizen_issue_received"
    CITIZEN_EVIDENCE_UPLOADED = "citizen_evidence_uploaded"
    CITIZEN_ISSUE_MODERATED = "citizen_issue_moderated"

    # Work lifecycle events
    WORK_CREATED = "work_created"
    WORK_UPDATED = "work_updated"
    WORK_STATUS_CHANGE = "work_status_change"
    WORK_DELETED = "work_deleted"
    PAYMENT_ADDED = "payment_added"
    PROGRESS_UPDATE_ADDED = "progress_update_added"

    # Compliance engine events
    COMPLIANCE_RUN = "compliance_run"
    COMPLIANCE_RULE_CREATED = "compliance_rule_created"
    COMPLIANCE_RULE_UPDATED = "compliance_rule_updated"
    COMPLIANCE_RESULT_REVIEWED = "compliance_result_reviewed"

    # Risk scoring events
    RISK_SCORE_CALCULATED = "risk_score_calculated"

    # ML lifecycle events
    ML_PREDICTION_CALCULATED = "ml_prediction_calculated"
    ML_MODEL_APPROVED = "ml_model_approved"
    ML_MODEL_ROLLED_BACK = "ml_model_rolled_back"

    # Possible duplicate-work review lifecycle events
    DUPLICATE_DETECTION_RUN = "duplicate_detection_run"
    DUPLICATE_CASE_CREATED = "duplicate_case_created"
    DUPLICATE_MARKED_NOT_DUPLICATE = "duplicate_marked_not_duplicate"
    DUPLICATE_FIELD_VERIFICATION_REQUESTED = "duplicate_field_verification_requested"


class AuditLogEntry(BaseModel):
    """Audit log document stored in MongoDB `audit_logs` collection."""
    log_id: str
    event_type: AuditEventType
    user_id: Optional[str] = None
    email: Optional[str] = None
    target_user_id: Optional[str] = None
    ip_address: str = ""
    user_agent: str = ""
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class AuditLogResponse(BaseModel):
    """Public audit log entry for API responses."""
    log_id: str
    event_type: AuditEventType
    user_id: Optional[str] = None
    email: Optional[str] = None
    target_user_id: Optional[str] = None
    ip_address: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    details: dict[str, Any]
    timestamp: datetime


class AuditListResponse(BaseModel):
    """Paginated audit log list."""
    logs: list[AuditLogResponse]
    total: int
