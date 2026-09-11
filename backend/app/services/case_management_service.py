"""MongoDB-backed case lifecycle and field-inspection workflow for Phase 13."""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.case_management import (
    CaseAssignee,
    CaseAssignmentRequest,
    CaseComment,
    CaseCommentRequest,
    CaseCorrectivePlanRequest,
    CaseCreateRequest,
    CaseDueDateRequest,
    CaseEvent,
    CaseOverrideRequest,
    CaseReasonRequest,
    CaseRecord,
    CaseRequest,
    CaseResponse,
    CaseSeverity,
    CaseSeverityRequest,
    CaseStatus,
    CorrectivePlan,
    InspectionReport,
    InspectionReportCreateRequest,
    InspectionReportResponse,
    InspectionSubmissionResponse,
    InspectionTaskResponse,
    InspectionWorkSummary,
    NotificationResponse,
)
from app.models.background import NotificationEventType
from app.models.user import UserRole
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService

logger = logging.getLogger("samarth.cases")

CASES_COLLECTION = "cases"
REPORTS_COLLECTION = "inspection_reports"
NOTIFICATIONS_COLLECTION = "case_notifications"
WORKS_COLLECTION = "works"
EVIDENCE_COLLECTION = "evidence_metadata"
USERS_COLLECTION = "users"

TERMINAL_STATUSES = {CaseStatus.RESOLVED, CaseStatus.REJECTED_FALSE_POSITIVE}
SEVERITY_RANK = {
    CaseSeverity.LOW: 1,
    CaseSeverity.MEDIUM: 2,
    CaseSeverity.HIGH: 3,
    CaseSeverity.CRITICAL: 4,
}


class CaseManagementService:
    """Persist and coordinate the District Authority → Inspector → District Authority loop."""

    def __init__(self, db: Database):
        self._db = db
        self._cases = db.get_collection(CASES_COLLECTION)
        self._reports = db.get_collection(REPORTS_COLLECTION)
        self._notifications = db.get_collection(NOTIFICATIONS_COLLECTION)
        self._works = db.get_collection(WORKS_COLLECTION)
        self._evidence = db.get_collection(EVIDENCE_COLLECTION)
        self._users = db.get_collection(USERS_COLLECTION)
        self._audit = AuditService(db)
        self._workflow_notifications = NotificationService(db)

    async def ensure_indexes(self) -> None:
        await self._cases.create_index("case_id", unique=True)
        await self._cases.create_index([("work_id", 1), ("updated_at", -1)])
        await self._cases.create_index([("assigned_inspector_id", 1), ("status", 1)])
        await self._cases.create_index([("state_code", 1), ("district_code", 1), ("status", 1)])
        await self._reports.create_index("report_id", unique=True)
        await self._reports.create_index([("case_id", 1), ("submitted_at", -1)])
        await self._reports.create_index("offline_client_id")
        await self._notifications.create_index([("recipient_user_id", 1), ("created_at", -1)])

    async def create_case(
        self,
        request: CaseCreateRequest,
        *,
        created_by: str,
        jurisdiction_filter: dict[str, Any],
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[CaseResponse]:
        work = await self._work_in_scope(request.work_id, jurisdiction_filter)
        if not work:
            return None
        now = datetime.now(timezone.utc)
        record = CaseRecord(
            case_id=str(uuid4()),
            work_id=str(work["work_id"]),
            source_type=request.source_type,
            source_id=request.source_id,
            title=request.title,
            description=request.description,
            severity=request.severity,
            due_date=request.due_date,
            state_code=str(work.get("state_code", "") or ""),
            district_code=str(work.get("district_code", "") or ""),
            created_by=created_by,
            created_at=now,
            updated_at=now,
            anomaly_category=request.anomaly_category,
            target_authority_role=request.target_authority_role,
            target_authority_name=request.target_authority_name,
            verification_scope=request.verification_scope,
            specific_questions=request.specific_questions,
            anomaly_metrics=request.anomaly_metrics,
            events=[self._event("case_created", created_by, details={"severity": request.severity.value})],
        )
        await self._cases.insert_one(record.model_dump(mode="python"))
        await self._audit_case(
            AuditEventType.CASE_CREATED, record, created_by, ip_address, user_agent,
            details={"source_type": request.source_type.value, "severity": request.severity.value},
        )
        return _case_response(record)

    async def list_cases(
        self,
        *,
        jurisdiction_filter: dict[str, Any],
        status: Optional[CaseStatus] = None,
        severity: Optional[CaseSeverity] = None,
        page: int = 1,
        page_size: int = 25,
    ) -> tuple[list[CaseResponse], int, int]:
        allowed_work_ids = await self._scoped_work_ids(jurisdiction_filter)
        if not allowed_work_ids:
            return [], 0, 1
        documents = await self._cases.find(
            {"work_id": {"$in": sorted(allowed_work_ids)}}, {"_id": 0}
        ).sort([("updated_at", -1), ("case_id", 1)]).to_list(length=None)
        records = [CaseRecord(**doc) for doc in documents]
        if status:
            records = [case for case in records if case.status == status]
        if severity:
            records = [case for case in records if case.severity == severity]
        total = len(records)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        return [_case_response(case) for case in records[start:start + page_size]], total, total_pages

    async def list_assigned_cases(
        self,
        *,
        inspector_user_id: str,
        assigned_task_ids: list[str],
        page: int = 1,
        page_size: int = 25,
    ) -> tuple[list[CaseResponse], int, int]:
        if not assigned_task_ids:
            return [], 0, 1
        docs = await self._cases.find(
            {"case_id": {"$in": assigned_task_ids}, "assigned_inspector_id": inspector_user_id}, {"_id": 0}
        ).sort([("due_date", 1), ("updated_at", -1)]).to_list(length=None)
        records = [CaseRecord(**doc) for doc in docs]
        total = len(records)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        return [_case_response(case) for case in records[start:start + page_size]], total, total_pages

    async def get_case_for_manager(self, case_id: str, *, jurisdiction_filter: dict[str, Any]) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or not await self._work_in_scope(case.work_id, jurisdiction_filter):
            return None
        return _case_response(case)

    async def get_case_for_inspector(
        self,
        case_id: str,
        *,
        inspector_user_id: str,
        assigned_task_ids: list[str],
    ) -> Optional[CaseResponse]:
        if case_id not in assigned_task_ids:
            return None
        case = await self._case(case_id)
        if not case or case.assigned_inspector_id != inspector_user_id:
            return None
        return _case_response(case)

    async def get_inspection_task(
        self,
        case_id: str,
        *,
        inspector_user_id: str,
        assigned_task_ids: list[str],
    ) -> Optional[InspectionTaskResponse]:
        case_response = await self.get_case_for_inspector(
            case_id, inspector_user_id=inspector_user_id, assigned_task_ids=assigned_task_ids,
        )
        if not case_response:
            return None
        work = await self._works.find_one({"work_id": case_response.work_id}, {"_id": 0})
        if not work:
            return None
        location = work.get("location") if isinstance(work.get("location"), dict) else {}
        return InspectionTaskResponse(
            case=case_response,
            work=InspectionWorkSummary(
                work_id=case_response.work_id, title=str(work.get("title", "Untitled work")),
                description=str(work.get("description", "") or ""), status=str(work.get("status", "") or ""),
                physical_progress_pct=float(work.get("physical_progress_pct", 0) or 0),
                state_name=str(work.get("state_name", "") or ""), district_name=str(work.get("district_name", "") or ""),
                implementing_agency=str(work.get("implementing_agency", "") or ""),
                location_latitude=_optional_number(location.get("latitude")),
                location_longitude=_optional_number(location.get("longitude")),
                location_address=str(location.get("address", "") or ""),
            ),
        )

    async def acknowledge(self, case_id: str, *, actor: str, reason: str = "", **request_context: str) -> Optional[CaseResponse]:
        return await self._transition(
            case_id, CaseStatus.ACKNOWLEDGED, actor=actor, reason=reason,
            event_type="case_acknowledged", allowed_from={CaseStatus.NEW}, **request_context,
        )

    async def begin_review(self, case_id: str, *, actor: str, reason: str = "", **request_context: str) -> Optional[CaseResponse]:
        return await self._transition(
            case_id, CaseStatus.UNDER_REVIEW, actor=actor, reason=reason,
            event_type="case_under_review",
            allowed_from={CaseStatus.ACKNOWLEDGED, CaseStatus.CLARIFICATION_REQUESTED, CaseStatus.REOPENED, CaseStatus.ESCALATED},
            **request_context,
        )

    async def assign_owner(
        self, case_id: str, request: CaseAssignmentRequest, *, actor: str, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        assignee = await self._eligible_user(request.user_id, case, inspector_only=False)
        if not assignee:
            raise ValueError("Owner must be an active user in the case jurisdiction")
        case.owner_user_id = request.user_id
        updated = await self._save_case(
            case, actor=actor, event_type="owner_assigned", reason=request.reason,
            audit_type=AuditEventType.CASE_ASSIGNED, details={"owner_user_id": request.user_id}, **request_context,
        )
        if updated:
            await self._emit_notification(
                recipient_user_id=request.user_id,
                event_type=NotificationEventType.CASE_OWNER_ASSIGNED,
                resource_type="case",
                resource_id=case.case_id,
                idempotency_key=f"owner-assigned:{case.case_id}:{request.user_id}",
                title=f"Case Assigned: {case.title[:45]}",
                message=f"You have been assigned as owner for case {case.case_id[:8]}. Reason: {request.reason or 'Assigned by authority'}",
            )
        return updated

    async def add_comment(
        self, case_id: str, request: CaseCommentRequest, *, actor: str, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case:
            return None
        case.comments.append(CaseComment(comment_id=str(uuid4()), author_user_id=actor, text=request.text))
        return await self._save_case(
            case, actor=actor, event_type="comment_added", reason=request.text,
            audit_type=AuditEventType.CASE_COMMENT_ADDED, details={}, **request_context,
        )

    async def request_clarification(
        self, case_id: str, request: CaseReasonRequest, *, actor: str, documents: bool = False, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        item = CaseRequest(
            request_id=str(uuid4()), request_type="documents" if documents else "clarification",
            requested_by=actor, reason=request.reason,
        )
        if documents:
            case.document_requests.append(item)
        else:
            case.clarification_requests.append(item)
        case.status = CaseStatus.CLARIFICATION_REQUESTED
        updated = await self._save_case(
            case, actor=actor, event_type="documents_requested" if documents else "clarification_requested", reason=request.reason,
            audit_type=AuditEventType.CASE_UPDATED, details={"request_id": item.request_id}, **request_context,
        )
        if updated:
            await self._emit_notification(
                recipient_user_id=case.owner_user_id,
                event_type=NotificationEventType.CLARIFICATION_REQUESTED,
                resource_type="case",
                resource_id=case.case_id,
                idempotency_key=f"clarification:{item.request_id}",
                title=f"Clarification Requested: {case.title[:45]}",
                message=f"Clarification required: {request.reason}",
            )
        return updated

    async def assign_inspector(
        self, case_id: str, request: CaseAssignmentRequest, *, actor: str, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        inspector = await self._eligible_user(request.user_id, case, inspector_only=True)
        if not inspector:
            raise ValueError("Inspector must be active and in the case jurisdiction")
        jurisdiction = dict(inspector.get("jurisdiction") or {})
        task_ids = list(jurisdiction.get("assigned_task_ids") or [])
        if case.case_id not in task_ids:
            task_ids.append(case.case_id)
        jurisdiction["assigned_task_ids"] = task_ids
        await self._users.update_one(
            {"user_id": request.user_id},
            {"$set": {"jurisdiction": jurisdiction, "updated_at": datetime.now(timezone.utc)}},
        )
        case.assigned_inspector_id = request.user_id
        case.status = CaseStatus.INSPECTION_ASSIGNED
        updated = await self._save_case(
            case, actor=actor, event_type="inspection_assigned", reason=request.reason,
            audit_type=AuditEventType.INSPECTION_ASSIGNED, details={"inspector_user_id": request.user_id}, **request_context,
        )
        if updated:
            await self._emit_notification(
                recipient_user_id=request.user_id,
                event_type=NotificationEventType.INSPECTOR_ASSIGNED,
                resource_type="case",
                resource_id=case.case_id,
                idempotency_key=f"inspection-assigned:{case.case_id}:{request.user_id}",
                title=f"Inspection Assigned: {case.title[:45]}",
                message=f"You have been assigned for physical site verification. Reason: {request.reason or 'Site inspection required'}",
            )
        return updated

    async def set_due_date(
        self, case_id: str, request: CaseDueDateRequest, *, actor: str, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        case.due_date = request.due_date
        return await self._save_case(
            case, actor=actor, event_type="due_date_set", reason=request.reason,
            audit_type=AuditEventType.CASE_UPDATED, details={"due_date": request.due_date.isoformat()}, **request_context,
        )

    async def change_severity(
        self, case_id: str, request: CaseSeverityRequest, *, actor: str, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        if SEVERITY_RANK[request.severity] < SEVERITY_RANK[case.severity] and not request.reason.strip():
            raise ValueError("A reason is required when lowering case severity")
        previous = case.severity
        case.severity = request.severity
        return await self._save_case(
            case, actor=actor, event_type="severity_changed", reason=request.reason,
            audit_type=AuditEventType.CASE_UPDATED,
            details={"previous_severity": previous.value, "severity": request.severity.value}, **request_context,
        )

    async def create_corrective_plan(
        self, case_id: str, request: CaseCorrectivePlanRequest, *, actor: str, **request_context: str
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        if request.owner_user_id and not await self._eligible_user(request.owner_user_id, case, inspector_only=False):
            raise ValueError("Corrective-plan owner must be active and in the case jurisdiction")
        plan = CorrectivePlan(
            plan_id=str(uuid4()), summary=request.summary, actions=request.actions,
            owner_user_id=request.owner_user_id, target_date=request.target_date, created_by=actor,
        )
        case.corrective_plan = plan
        case.status = CaseStatus.CORRECTIVE_ACTION_PLANNED
        return await self._save_case(
            case, actor=actor, event_type="corrective_plan_created", reason=request.summary,
            audit_type=AuditEventType.CASE_UPDATED, details={"plan_id": plan.plan_id}, **request_context,
        )

    async def resolve(self, case_id: str, request: CaseReasonRequest, *, actor: str, **request_context: str) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        case.closure_reason = request.reason
        case.resolved_at = datetime.now(timezone.utc)
        return await self._transition_record(
            case, CaseStatus.RESOLVED, actor=actor, reason=request.reason, event_type="case_resolved",
            audit_type=AuditEventType.CASE_RESOLVED, **request_context,
        )

    async def reject(self, case_id: str, request: CaseReasonRequest, *, actor: str, **request_context: str) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        case.rejection_reason = request.reason
        return await self._transition_record(
            case, CaseStatus.REJECTED_FALSE_POSITIVE, actor=actor, reason=request.reason, event_type="case_rejected",
            audit_type=AuditEventType.CASE_REJECTED, **request_context,
        )

    async def escalate(self, case_id: str, request: CaseReasonRequest, *, actor: str, **request_context: str) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status in TERMINAL_STATUSES:
            return None
        case.escalation_reason = request.reason
        case.escalation_level = "state" if case.escalation_level == "district" else "mospi"
        case.escalated_at = datetime.now(timezone.utc)
        updated = await self._transition_record(
            case, CaseStatus.ESCALATED, actor=actor, reason=request.reason, event_type="case_escalated",
            audit_type=AuditEventType.CASE_ESCALATED, **request_context,
        )
        try:
            await self._workflow_notifications.create_for_roles(
                roles={"state_nodal_officer"} if case.escalation_level == "state" else {"mospi"},
                state_code=case.state_code, district_code=case.district_code,
                event_type=NotificationEventType.CASE_ESCALATED, resource_type="case", resource_id=case.case_id,
                idempotency_prefix=f"case-escalated:{case.case_id}:{case.escalation_level}:{case.updated_at.isoformat()}",
            )
        except Exception as exc:
            logger.warning("Could not create escalation notification: %s", type(exc).__name__)
        return updated

    async def reopen(self, case_id: str, request: CaseReasonRequest, *, actor: str, **request_context: str) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status not in TERMINAL_STATUSES | {CaseStatus.ESCALATED}:
            return None
        case.resolved_at = None
        return await self._transition_record(
            case, CaseStatus.REOPENED, actor=actor, reason=request.reason, event_type="case_reopened",
            audit_type=AuditEventType.CASE_REOPENED, **request_context,
        )

    async def override(self, case_id: str, request: CaseOverrideRequest, *, actor: str, **request_context: str) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case:
            return None
        if request.severity:
            case.severity = request.severity
        case.status = request.status
        if request.status == CaseStatus.RESOLVED:
            case.closure_reason = request.reason
            case.resolved_at = datetime.now(timezone.utc)
        return await self._save_case(
            case, actor=actor, event_type="case_override", reason=request.reason,
            audit_type=AuditEventType.CASE_UPDATED,
            details={"status": request.status.value, "severity": case.severity.value}, **request_context,
        )

    async def submit_inspection_report(
        self,
        case_id: str,
        request: InspectionReportCreateRequest,
        *,
        inspector_user_id: str,
        assigned_task_ids: list[str],
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[InspectionSubmissionResponse]:
        if case_id not in assigned_task_ids:
            return None
        case = await self._case(case_id)
        if not case or case.assigned_inspector_id != inspector_user_id:
            return None
        if case.status not in {CaseStatus.INSPECTION_ASSIGNED, CaseStatus.EVIDENCE_SUBMITTED}:
            raise ValueError("Inspection report may be submitted only for an assigned inspection")
        if request.offline_client_id:
            existing = next((report for report in case.inspection_reports if report.offline_client_id == request.offline_client_id), None)
            if existing:
                return InspectionSubmissionResponse(
                    case=_case_response(case), report=_report_response(existing), risk_recalculated=False,
                )
        evidence_ids = await self._valid_evidence_ids(case.work_id, request.evidence_ids)
        if len(evidence_ids) != len(set(request.evidence_ids)):
            raise ValueError("All inspection evidence must exist and belong to this work")
        work = await self._works.find_one({"work_id": case.work_id}, {"_id": 0})
        if not work:
            return None
        distance = _distance_from_work(work, request.gps_latitude, request.gps_longitude)
        report = InspectionReport(
            report_id=str(uuid4()), case_id=case.case_id, work_id=case.work_id,
            inspector_user_id=inspector_user_id, checklist=request.checklist,
            gps_latitude=request.gps_latitude, gps_longitude=request.gps_longitude,
            gps_timestamp=request.gps_timestamp, gps_distance_from_project_meters=distance,
            evidence_ids=evidence_ids, remarks=request.remarks, offline_client_id=request.offline_client_id,
        )
        await self._reports.insert_one(report.model_dump(mode="python"))
        case.inspection_reports.append(report)
        case.status = CaseStatus.EVIDENCE_SUBMITTED
        updated = await self._save_case(
            case, actor=inspector_user_id, event_type="inspection_report_submitted", reason=request.remarks,
            audit_type=AuditEventType.INSPECTION_REPORT_SUBMITTED,
            details={"report_id": report.report_id, "evidence_count": str(len(evidence_ids))},
            ip_address=ip_address, user_agent=user_agent,
        )
        risk_recalculated, risk_score_id = await self._recalculate_risk(
            case.work_id, inspector_user_id, ip_address, user_agent,
        )
        notified = await self._notify_district_authorities(
            case, report, inspector_user_id, ip_address, user_agent,
        )
        try:
            await self._workflow_notifications.create_for_roles(
                roles={"district_authority"}, state_code=case.state_code, district_code=case.district_code,
                event_type=NotificationEventType.INSPECTION_SUBMITTED, resource_type="case", resource_id=case.case_id,
                idempotency_prefix=f"inspection-submitted:{report.report_id}",
                title=f"Inspection Submitted: {case.title[:45]}",
                message=f"Field inspector submitted verification report for case {case.case_id[:8]}.",
            )
        except Exception as exc:
            logger.warning("Could not create inspection notification: %s", type(exc).__name__)
        return InspectionSubmissionResponse(
            case=updated or _case_response(case), report=_report_response(report),
            risk_recalculated=risk_recalculated, risk_score_id=risk_score_id,
            district_authorities_notified=notified,
        )

    async def list_assignees(
        self,
        *,
        jurisdiction_filter: dict[str, Any],
        inspector_only: bool = False,
    ) -> list[CaseAssignee]:
        scoped_work_ids = await self._scoped_work_ids(jurisdiction_filter)
        if not scoped_work_ids:
            return []
        work = await self._works.find_one({"work_id": sorted(scoped_work_ids)[0]}, {"_id": 0})
        if not work:
            return []
        users = await self._users.find({"is_active": True}, {"_id": 0}).to_list(length=None)
        assignees = []
        for user in users:
            if inspector_only and user.get("role") != UserRole.INSPECTOR.value:
                continue
            if _user_in_case_scope(user, str(work.get("state_code", "")), str(work.get("district_code", ""))):
                jurisdiction = user.get("jurisdiction") or {}
                assignees.append(CaseAssignee(
                    user_id=str(user.get("user_id", "")), full_name=str(user.get("full_name", "")),
                    role=str(user.get("role", "")), state_code=jurisdiction.get("state_code"), district_code=jurisdiction.get("district_code"),
                ))
        return sorted(assignees, key=lambda item: (item.role, item.full_name, item.user_id))

    async def list_assignees_for_case(self, case_id: str, *, inspector_only: bool = False) -> list[CaseAssignee]:
        case = await self._case(case_id)
        if not case:
            return []
        users = await self._users.find({"is_active": True}, {"_id": 0}).to_list(length=None)
        result = []
        for user in users:
            if inspector_only and user.get("role") != UserRole.INSPECTOR.value:
                continue
            if _user_in_case_scope(user, case.state_code, case.district_code):
                jurisdiction = user.get("jurisdiction") or {}
                result.append(CaseAssignee(
                    user_id=str(user.get("user_id", "")), full_name=str(user.get("full_name", "")),
                    role=str(user.get("role", "")), state_code=jurisdiction.get("state_code"), district_code=jurisdiction.get("district_code"),
                ))
        return sorted(result, key=lambda item: (item.role, item.full_name, item.user_id))

    async def list_notifications(self, *, recipient_user_id: str) -> list[NotificationResponse]:
        docs = await self._notifications.find({"recipient_user_id": recipient_user_id}, {"_id": 0}).sort(
            [("created_at", -1)]
        ).to_list(length=None)
        return [NotificationResponse(**doc) for doc in docs]

    async def _transition(
        self,
        case_id: str,
        target: CaseStatus,
        *,
        actor: str,
        reason: str,
        event_type: str,
        allowed_from: set[CaseStatus],
        **request_context: str,
    ) -> Optional[CaseResponse]:
        case = await self._case(case_id)
        if not case or case.status not in allowed_from:
            return None
        return await self._transition_record(
            case, target, actor=actor, reason=reason, event_type=event_type,
            audit_type=AuditEventType.CASE_UPDATED, **request_context,
        )

    async def _transition_record(
        self,
        case: CaseRecord,
        target: CaseStatus,
        *,
        actor: str,
        reason: str,
        event_type: str,
        audit_type: AuditEventType,
        **request_context: str,
    ) -> CaseResponse:
        previous = case.status
        case.status = target
        return (await self._save_case(
            case, actor=actor, event_type=event_type, reason=reason, audit_type=audit_type,
            details={"previous_status": previous.value, "status": target.value}, **request_context,
        )) or _case_response(case)

    async def _save_case(
        self,
        case: CaseRecord,
        *,
        actor: str,
        event_type: str,
        reason: str,
        audit_type: AuditEventType,
        details: dict[str, str],
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[CaseResponse]:
        case.events.append(self._event(event_type, actor, reason=reason, details=details))
        case.updated_at = datetime.now(timezone.utc)
        result = await self._cases.update_one(
            {"case_id": case.case_id}, {"$set": case.model_dump(mode="python")}
        )
        if not getattr(result, "matched_count", 0):
            return None
        await self._audit_case(audit_type, case, actor, ip_address, user_agent, details=details)
        return _case_response(case)

    async def _case(self, case_id: str) -> Optional[CaseRecord]:
        document = await self._cases.find_one({"case_id": case_id}, {"_id": 0})
        return CaseRecord(**document) if document else None

    async def _emit_notification(
        self,
        *,
        recipient_user_id: Optional[str],
        event_type: NotificationEventType,
        resource_type: str,
        resource_id: str,
        idempotency_key: str,
        title: Optional[str] = None,
        message: Optional[str] = None,
    ) -> None:
        if not recipient_user_id:
            return
        try:
            await self._workflow_notifications.create_event(
                recipient_user_id=recipient_user_id, event_type=event_type,
                resource_type=resource_type, resource_id=resource_id,
                idempotency_key=idempotency_key,
                title=title, message=message,
            )
        except Exception as exc:
            logger.warning("Could not create workflow notification %s: %s", event_type.value, type(exc).__name__)

    async def _work_in_scope(self, work_id: str, jurisdiction_filter: dict[str, Any]) -> Optional[dict[str, Any]]:
        raw_id = (work_id or "").strip()
        if not raw_id:
            return None

        # 1. Exact match by work_id
        query = {"work_id": raw_id, **(jurisdiction_filter or {})}
        work = await self._works.find_one(query, {"_id": 0})
        if work:
            return work

        import re
        escaped = re.escape(raw_id)

        # 2. Prefix match on work_id (e.g. user typed first 8 chars of UUID)
        prefix_query = {"work_id": {"$regex": f"^{escaped}", "$options": "i"}, **(jurisdiction_filter or {})}
        work = await self._works.find_one(prefix_query, {"_id": 0})
        if work:
            return work

        # 3. Match by project title
        title_query = {"title": {"$regex": escaped, "$options": "i"}, **(jurisdiction_filter or {})}
        return await self._works.find_one(title_query, {"_id": 0})

    async def _scoped_work_ids(self, jurisdiction_filter: dict[str, Any]) -> set[str]:
        works = await self._works.find(jurisdiction_filter or {}, {"_id": 0, "work_id": 1}).to_list(length=None)
        return {str(work["work_id"]) for work in works if work.get("work_id")}

    async def _eligible_user(self, user_id: str, case: CaseRecord, *, inspector_only: bool) -> Optional[dict[str, Any]]:
        user = await self._users.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
        if not user:
            return None
        if inspector_only and user.get("role") != UserRole.INSPECTOR.value:
            return None
        return user if _user_in_case_scope(user, case.state_code, case.district_code) else None

    async def _valid_evidence_ids(self, work_id: str, evidence_ids: list[str]) -> list[str]:
        if not evidence_ids:
            return []
        documents = await self._evidence.find(
            {"work_id": work_id, "evidence_id": {"$in": list(set(evidence_ids))}}, {"_id": 0, "evidence_id": 1}
        ).to_list(length=None)
        found = {str(document["evidence_id"]) for document in documents if document.get("evidence_id")}
        return [evidence_id for evidence_id in evidence_ids if evidence_id in found]

    async def _recalculate_risk(self, work_id: str, actor: str, ip_address: str, user_agent: str) -> tuple[bool, Optional[str]]:
        try:
            from app.services.risk_service import RiskScoringService

            score = await RiskScoringService(self._db).score_work(
                work_id, calculated_by=actor, ip_address=ip_address, user_agent=user_agent,
            )
            return bool(score), score.score_id if score else None
        except Exception as exc:
            logger.exception("Risk recalculation after inspection failed for %s: %s", work_id, exc)
            return False, None

    async def _notify_district_authorities(
        self,
        case: CaseRecord,
        report: InspectionReport,
        actor: str,
        ip_address: str,
        user_agent: str,
    ) -> int:
        users = await self._users.find(
            {"role": UserRole.DISTRICT_AUTHORITY.value, "is_active": True}, {"_id": 0}
        ).to_list(length=None)
        recipients = [user for user in users if _user_in_case_scope(user, case.state_code, case.district_code)]
        now = datetime.now(timezone.utc)
        for user in recipients:
            await self._notifications.insert_one({
                "notification_id": str(uuid4()), "recipient_user_id": str(user["user_id"]),
                "case_id": case.case_id, "work_id": case.work_id,
                "title": "Inspection report submitted",
                "message": f"An inspector submitted report {report.report_id} for case {case.case_id}.",
                "read_at": None, "created_at": now,
            })
        await self._audit.log_event(
            AuditEventType.DISTRICT_AUTHORITY_NOTIFIED,
            user_id=actor, ip_address=ip_address, user_agent=user_agent,
            resource_type="case", resource_id=case.case_id,
            details={"report_id": report.report_id, "recipient_count": len(recipients)},
        )
        return len(recipients)

    @staticmethod
    def _event(event_type: str, actor: str, *, reason: str = "", details: Optional[dict[str, str]] = None) -> CaseEvent:
        return CaseEvent(event_id=str(uuid4()), event_type=event_type, actor_user_id=actor, reason=reason, details=details or {})

    async def _audit_case(
        self,
        event_type: AuditEventType,
        case: CaseRecord,
        actor: str,
        ip_address: str,
        user_agent: str,
        *,
        details: dict[str, Any],
    ) -> None:
        await self._audit.log_event(
            event_type, user_id=actor, ip_address=ip_address, user_agent=user_agent,
            resource_type="case", resource_id=case.case_id,
            details={"work_id": case.work_id, "status": case.status.value, **details},
        )


def _case_response(case: CaseRecord) -> CaseResponse:
    return CaseResponse(
        case_id=case.case_id, work_id=case.work_id, source_type=case.source_type, source_id=case.source_id,
        title=case.title, description=case.description, status=case.status, severity=case.severity,
        owner_user_id=case.owner_user_id, assigned_inspector_id=case.assigned_inspector_id,
        due_date=case.due_date, corrective_plan=case.corrective_plan,
        clarification_requests=case.clarification_requests, document_requests=case.document_requests,
        comments=case.comments, inspection_reports=[_report_response(report) for report in case.inspection_reports],
        events=case.events, created_by=case.created_by, created_at=case.created_at, updated_at=case.updated_at,
        resolved_at=case.resolved_at, rejection_reason=case.rejection_reason,
        closure_reason=case.closure_reason, escalation_reason=case.escalation_reason,
        escalation_level=case.escalation_level, escalated_at=case.escalated_at,
        anomaly_category=case.anomaly_category, target_authority_role=case.target_authority_role,
        target_authority_name=case.target_authority_name, verification_scope=case.verification_scope,
        specific_questions=case.specific_questions, anomaly_metrics=case.anomaly_metrics,
        verification_finding=case.verification_finding,
    )


def _report_response(report: InspectionReport) -> InspectionReportResponse:
    return InspectionReportResponse(
        report_id=report.report_id, case_id=report.case_id, work_id=report.work_id,
        inspector_user_id=report.inspector_user_id, checklist=report.checklist,
        gps_available=report.gps_latitude is not None and report.gps_longitude is not None,
        gps_timestamp=report.gps_timestamp, gps_distance_from_project_meters=report.gps_distance_from_project_meters,
        evidence_ids=report.evidence_ids, remarks=report.remarks, submitted_at=report.submitted_at,
    )


def _user_in_case_scope(user: dict[str, Any], state_code: str, district_code: str) -> bool:
    role = str(user.get("role", ""))
    if role in {UserRole.ADMIN.value, UserRole.MOSPI.value}:
        return True
    jurisdiction = user.get("jurisdiction") or {}
    user_state = str(jurisdiction.get("state_code") or "")
    user_district = str(jurisdiction.get("district_code") or "")
    state_matches = not user_state or user_state.lower() == state_code.lower()
    district_matches = not user_district or user_district.lower() == district_code.lower()
    return state_matches and district_matches


def _distance_from_work(work: dict[str, Any], latitude: Optional[float], longitude: Optional[float]) -> Optional[float]:
    if latitude is None or longitude is None:
        return None
    location = work.get("location") if isinstance(work.get("location"), dict) else {}
    try:
        work_latitude, work_longitude = float(location.get("latitude")), float(location.get("longitude"))
    except (TypeError, ValueError):
        return None
    import math

    radius_m = 6_371_000.0
    phi_a, phi_b = math.radians(latitude), math.radians(work_latitude)
    delta_phi, delta_lambda = math.radians(work_latitude - latitude), math.radians(work_longitude - longitude)
    component = math.sin(delta_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    return round(radius_m * 2 * math.atan2(math.sqrt(component), math.sqrt(1 - component)), 2)


def _optional_number(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
