"""Public-safe work discovery and anonymous social-audit reports for Phase 14."""

from __future__ import annotations

import hashlib
import hmac
import logging
import math
import re
import secrets
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

from PIL import Image

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.citizen_portal import (
    CitizenCommunityIssueItem,
    CitizenCommunityIssueListResponse,
    CitizenEvidenceItem,
    CitizenEvidenceUploadResponse,
    CitizenIssueCreateCaseRequest,
    CitizenIssueCreateRequest,
    CitizenIssueType,
    CitizenIssueModerationList,
    CitizenIssueModerationResponse,
    CitizenIssueModerationUpdate,
    CitizenIssueReceipt,
    CitizenIssueStatus,
    CitizenIssueTrackingResponse,
    CitizenPersonalIssueItem,
    CitizenVerificationChallenge,
    PublicWorkDetail,
    PublicWorkListResponse,
    PublicWorkSummary,
)
from app.models.background import NotificationEventType
from app.models.work import WorkCategory, WorkStatus
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService

logger = logging.getLogger("samarth.citizen_portal")


WORKS_COLLECTION = "works"
ISSUES_COLLECTION = "citizen_issues"
CHALLENGES_COLLECTION = "citizen_verification_challenges"
PRIVATE_EVIDENCE_ROOT = Path(__file__).resolve().parents[2] / "private_citizen_evidence"

STATUS_MESSAGES = {
    CitizenIssueStatus.RECEIVED: "Received — awaiting moderation.",
    CitizenIssueStatus.UNDER_REVIEW: "Under review by the District Authority.",
    CitizenIssueStatus.INSPECTION_ASSIGNED: "Inspection assigned for field verification.",
    CitizenIssueStatus.RESOLVED: "Resolved.",
    CitizenIssueStatus.CLOSED: "Closed after review.",
}

ALLOWED_TRANSITIONS = {
    CitizenIssueStatus.RECEIVED: {CitizenIssueStatus.UNDER_REVIEW, CitizenIssueStatus.CLOSED},
    CitizenIssueStatus.UNDER_REVIEW: {CitizenIssueStatus.INSPECTION_ASSIGNED, CitizenIssueStatus.RESOLVED, CitizenIssueStatus.CLOSED},
    CitizenIssueStatus.INSPECTION_ASSIGNED: {CitizenIssueStatus.UNDER_REVIEW, CitizenIssueStatus.RESOLVED, CitizenIssueStatus.CLOSED},
    CitizenIssueStatus.RESOLVED: set(),
    CitizenIssueStatus.CLOSED: set(),
}


class CitizenPortalService:
    """Separate public projection and anonymous report persistence service."""

    def __init__(self, db: Database):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)
        self._issues = db.get_collection(ISSUES_COLLECTION)
        self._challenges = db.get_collection(CHALLENGES_COLLECTION)
        self._audit = AuditService(db)

    async def ensure_indexes(self) -> None:
        await self._works.create_index("pincode")
        await self._works.create_index([("district_name", 1), ("constituency", 1)])
        await self._issues.create_index("reference_id", unique=True)
        await self._issues.create_index([("work_id", 1), ("updated_at", -1)])
        await self._issues.create_index([("status", 1), ("updated_at", -1)])
        await self._challenges.create_index("verification_id", unique=True)
        await self._challenges.create_index("expires_at")

    async def search_public_works(
        self,
        *,
        query: str | None = None,
        pincode: str | None = None,
        district: str | None = None,
        constituency: str | None = None,
        work_id: str | None = None,
        category: WorkCategory | None = None,
        mp_name: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> PublicWorkListResponse:
        """Search only public fields. Python filtering keeps the projection explicit."""
        docs = await self._works.find({}, {"_id": 0}).to_list(length=None)
        filtered = [
            doc for doc in docs
            if _matches_public_search(
                doc, query=query, pincode=pincode, district=district, constituency=constituency,
                work_id=work_id, category=category, mp_name=mp_name,
            )
        ]
        filtered.sort(key=lambda item: (str(item.get("title", "")).casefold(), str(item.get("work_id", ""))))
        total = len(filtered)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        return PublicWorkListResponse(
            works=[_public_summary(item) for item in filtered[start:start + page_size]],
            total=total, page=page, page_size=page_size, total_pages=total_pages,
        )

    async def get_public_work(self, work_id: str) -> Optional[PublicWorkDetail]:
        doc = await self._works.find_one({"work_id": work_id}, {"_id": 0})
        return _public_detail(doc) if doc else None

    async def lookup_qr(self, payload: str) -> Optional[PublicWorkDetail]:
        work_id = _extract_qr_work_id(payload)
        return await self.get_public_work(work_id) if work_id else None

    async def create_verification_challenge(self) -> CitizenVerificationChallenge:
        first, second = secrets.randbelow(8) + 2, secrets.randbelow(8) + 2
        now = datetime.now(timezone.utc)
        challenge = CitizenVerificationChallenge(
            verification_id=str(uuid4()), prompt=f"What is {first} + {second}?", expires_at=now + timedelta(minutes=10),
        )
        answer_hash = _challenge_answer_hash(challenge.verification_id, str(first + second))
        await self._challenges.insert_one({
            "verification_id": challenge.verification_id, "answer_hash": answer_hash,
            "expires_at": challenge.expires_at, "used_at": None, "created_at": now,
        })
        return challenge

    async def create_issue(
        self,
        request: CitizenIssueCreateRequest,
        *,
        citizen_user_id: Optional[str] = None,
        citizen_email: Optional[str] = None,
        citizen_name: Optional[str] = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[CitizenIssueReceipt]:
        work = await self._works.find_one(
            {"work_id": request.work_id},
            {"_id": 0, "work_id": 1, "title": 1, "district_name": 1, "state_name": 1, "district_code": 1, "state_code": 1, "category": 1}
        )
        if not work:
            return None
        await self._verify_challenge(request.verification_id, request.verification_answer)
        now = datetime.now(timezone.utc)
        reference_id = f"SA-{now:%Y%m%d}-{secrets.token_hex(5).upper()}"
        upload_token = secrets.token_urlsafe(32)
        upload_expires_at = now + timedelta(minutes=30)
        issue = {
            "reference_id": reference_id,
            "work_id": request.work_id,
            "work_title": str(work.get("title", "Public work")),
            "district_name": str(work.get("district_name", "")),
            "state_name": str(work.get("state_name", "")),
            "category": str(work.get("category", "")),
            "issue_type": request.issue_type.value,
            "description": request.description.strip(),
            "status": CitizenIssueStatus.RECEIVED.value,
            "public_status_message": STATUS_MESSAGES[CitizenIssueStatus.RECEIVED],
            "location_consent": request.location_consent,
            "latitude": request.latitude if request.location_consent else None,
            "longitude": request.longitude if request.location_consent else None,
            "evidence": [],
            "assigned_inspector_id": None,
            "assigned_inspector_name": None,
            "moderation_reason": "",
            "citizen_user_id": citizen_user_id,
            "citizen_email": citizen_email,
            "citizen_name": citizen_name,
            "photo_upload_token_hash": _sha256(upload_token),
            "photo_upload_expires_at": upload_expires_at,
            "photo_upload_used_at": None,
            "submitted_at": now,
            "updated_at": now,
        }
        await self._issues.insert_one(issue)
        # Dispatch in-app notification to District Authority and State Nodal Officer
        try:
            work_title = str(work.get("title", "Public Work"))
            work_dist = str(work.get("district_code") or work.get("district_name") or "")
            work_state = str(work.get("state_code") or work.get("state_name") or "")
            await NotificationService(self._db).create_for_roles(
                roles={"district_authority", "state_nodal_officer"},
                state_code=work_state,
                district_code=work_dist,
                event_type=NotificationEventType.CITIZEN_ISSUE_RAISED,
                resource_type="citizen_issue",
                resource_id=reference_id,
                idempotency_prefix=f"citizen-issue:{reference_id}",
                title=f"New Citizen Issue: {work_title[:40]}",
                message=f"Ground issue reported in {work.get('district_name') or work_dist or 'jurisdiction'}: {request.description[:60]}",
            )
        except Exception as exc:
            logger.warning("Could not dispatch citizen issue notification: %s", type(exc).__name__)

        await self._audit.log_event(
            AuditEventType.CITIZEN_ISSUE_RECEIVED, ip_address=ip_address, user_agent=user_agent,
            resource_type="citizen_issue", resource_id=reference_id,
            details={"work_id": request.work_id, "issue_type": request.issue_type.value, "location_consent": request.location_consent},
        )
        return CitizenIssueReceipt(
            reference_id=reference_id, status=CitizenIssueStatus.RECEIVED, submitted_at=now,
            photo_upload_token=upload_token, photo_upload_expires_at=upload_expires_at,
        )

    async def upload_issue_evidence(
        self,
        reference_id: str,
        *,
        upload_token: str,
        filename: str,
        content_type: str,
        content: bytes,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[CitizenEvidenceUploadResponse]:
        issue = await self._issues.find_one({"reference_id": reference_id}, {"_id": 0})
        if not issue:
            return None
        now = datetime.now(timezone.utc)
        token_hash = str(issue.get("photo_upload_token_hash", ""))
        expires_at = issue.get("photo_upload_expires_at")
        if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        evidence = list(issue.get("evidence") or [])
        if len(evidence) >= 3:
            raise ValueError("Maximum of 3 evidence photos already reached for this report")
        if not token_hash or issue.get("photo_upload_used_at") or not isinstance(expires_at, datetime) or expires_at <= now:
            raise ValueError("The private photo-upload capability has expired")
        if not hmac.compare_digest(token_hash, _sha256(upload_token)):
            raise ValueError("The private photo-upload capability is invalid")
        _validate_image(content, content_type)
        evidence_id = str(uuid4())
        suffix = _safe_image_suffix(filename, content_type)
        destination = PRIVATE_EVIDENCE_ROOT / reference_id / f"{evidence_id}{suffix}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        evidence.append({
            "evidence_id": evidence_id, "sha256_hash": _sha256_bytes(content), "content_type": content_type,
            "file_size_bytes": len(content), "received_at": now,
            "storage_reference": str(destination),
        })
        set_updates = {"evidence": evidence, "updated_at": now}
        if len(evidence) >= 3:
            set_updates["photo_upload_used_at"] = now
        await self._issues.update_one(
            {"reference_id": reference_id},
            {"$set": set_updates},
        )
        await self._audit.log_event(
            AuditEventType.CITIZEN_EVIDENCE_UPLOADED, ip_address=ip_address, user_agent=user_agent,
            resource_type="citizen_issue", resource_id=reference_id,
            details={"evidence_id": evidence_id, "file_size_bytes": len(content)},
        )
        return CitizenEvidenceUploadResponse()

    async def list_recent_updates(self, limit: int = 10) -> list[dict]:
        """
        Public list of recently updated / resolved citizen social-audit reports.
        Displays work title, location, issue category, status, and authority's resolution remarks.
        """
        cursor = self._issues.find(
            {},
            {
                "_id": 0,
                "reference_id": 1,
                "work_id": 1,
                "work_title": 1,
                "district_name": 1,
                "state_name": 1,
                "category": 1,
                "issue_type": 1,
                "status": 1,
                "public_status_message": 1,
                "moderation_reason": 1,
                "submitted_at": 1,
                "updated_at": 1,
            }
        ).sort("updated_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        results = []
        for doc in docs:
            # Fallback for district / state from work if empty
            district = doc.get("district_name") or ""
            state = doc.get("state_name") or ""
            if not district and doc.get("work_id"):
                w = await self._works.find_one({"work_id": doc["work_id"]}, {"_id": 0, "district_name": 1, "state_name": 1, "category": 1})
                if w:
                    district = w.get("district_name", "")
                    state = w.get("state_name", "")
                    if not doc.get("category"):
                        doc["category"] = w.get("category", "")
            
            raw_status = doc.get("status", "received")
            status_enum = CitizenIssueStatus(raw_status) if raw_status in CitizenIssueStatus._value2member_map_ else CitizenIssueStatus.RECEIVED
            changes = doc.get("moderation_reason") or doc.get("public_status_message") or "Review and ground inspection in progress"
            results.append({
                "reference_id": doc.get("reference_id"),
                "work_title": doc.get("work_title", "Public Development Project"),
                "district_name": district,
                "state_name": state,
                "category": doc.get("category", ""),
                "issue_type": doc.get("issue_type", "other"),
                "status": raw_status,
                "status_message": doc.get("public_status_message") or STATUS_MESSAGES.get(status_enum, "In progress"),
                "changes_done": changes,
                "submitted_at": doc.get("submitted_at") or datetime.now(timezone.utc),
                "updated_at": doc.get("updated_at") or datetime.now(timezone.utc),
            })
        return results

    async def track_issue(self, reference_id: str) -> Optional[CitizenIssueTrackingResponse]:
        issue = await self._issues.find_one({"reference_id": reference_id.upper()}, {"_id": 0})
        if not issue:
            return None
        return CitizenIssueTrackingResponse(
            reference_id=str(issue["reference_id"]), work_id=str(issue["work_id"]), work_title=str(issue.get("work_title", "Public work")),
            issue_type=CitizenIssueType(issue["issue_type"]), status=CitizenIssueStatus(issue["status"]),
            status_message=str(issue.get("public_status_message") or STATUS_MESSAGES[CitizenIssueStatus(issue["status"])]),
            submitted_at=issue["submitted_at"], updated_at=issue["updated_at"], evidence_received=bool(issue.get("evidence")),
        )

    async def list_for_moderation(
        self,
        *,
        allowed_work_ids: set[str],
        status: CitizenIssueStatus | None = None,
        page: int = 1,
        page_size: int = 25,
        assigned_inspector_id: Optional[str] = None,
        viewer_role: str = "",
    ) -> CitizenIssueModerationList:
        if not allowed_work_ids:
            return CitizenIssueModerationList(reports=[], total=0, page=page, page_size=page_size, total_pages=1)
        query: dict[str, Any] = {"work_id": {"$in": sorted(allowed_work_ids)}}
        if assigned_inspector_id:
            query["assigned_inspector_id"] = assigned_inspector_id
        docs = await self._issues.find(query, {"_id": 0}).sort(
            [("updated_at", -1), ("reference_id", 1)]
        ).to_list(length=None)
        if status:
            docs = [doc for doc in docs if doc.get("status") == status.value]
        total = len(docs)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        return CitizenIssueModerationList(
            reports=[_moderation_response(doc, viewer_role=viewer_role) for doc in docs[start:start + page_size]],
            total=total, page=page, page_size=page_size, total_pages=total_pages,
        )

    async def get_for_moderation(
        self,
        reference_id: str,
        *,
        allowed_work_ids: set[str],
        assigned_inspector_id: Optional[str] = None,
        viewer_role: str = "",
    ) -> Optional[CitizenIssueModerationResponse]:
        issue = await self._issues.find_one({"reference_id": reference_id.upper()}, {"_id": 0})
        if not issue or str(issue.get("work_id")) not in allowed_work_ids:
            return None
        if assigned_inspector_id and issue.get("assigned_inspector_id") != assigned_inspector_id:
            return None
        return _moderation_response(issue, viewer_role=viewer_role)

    async def get_evidence_file(
        self,
        reference_id: str,
        evidence_id: str,
        *,
        allowed_work_ids: set[str],
    ) -> tuple[Optional[Path], Optional[str]]:
        issue = await self._issues.find_one({"reference_id": reference_id.upper()}, {"_id": 0})
        if not issue or str(issue.get("work_id")) not in allowed_work_ids:
            return None, None
        evidence_list = list(issue.get("evidence") or [])
        matched = next((e for e in evidence_list if e.get("evidence_id") == evidence_id), None)
        if not matched:
            return None, None
        storage_ref = matched.get("storage_reference")
        content_type = str(matched.get("content_type", "image/jpeg"))
        if storage_ref:
            p = Path(storage_ref)
            if p.exists():
                return p, content_type
        folder = PRIVATE_EVIDENCE_ROOT / reference_id.upper()
        if folder.exists():
            for p in folder.glob(f"{evidence_id}*"):
                if p.is_file():
                    return p, content_type
        return None, None

    async def escalate_to_case(
        self,
        reference_id: str,
        request: CitizenIssueCreateCaseRequest,
        *,
        allowed_work_ids: set[str],
        moderator_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> dict[str, Any]:
        issue = await self._issues.find_one({"reference_id": reference_id.upper()}, {"_id": 0})
        if not issue or str(issue.get("work_id")) not in allowed_work_ids:
            raise ValueError("Citizen report not found or out of your jurisdiction")
        if issue.get("linked_case_id"):
            raise ValueError(f"Citizen report is already linked to official Case {issue['linked_case_id']}")
        
        now = datetime.now(timezone.utc)
        case_id = str(uuid4())
        work = await self._works.find_one({"work_id": issue["work_id"]}, {"_id": 0}) or {}
        
        inspector_id = request.assigned_inspector_id or issue.get("assigned_inspector_id")
        case_doc = {
            "case_id": case_id,
            "work_id": issue["work_id"],
            "source_type": "manual",
            "source_id": issue["reference_id"],
            "title": request.title.strip(),
            "description": f"Escalated from Citizen Social-Audit Report ({issue['reference_id']}):\n{issue.get('description', '')}\n\nDistrict Authority Notes:\n{request.case_notes.strip()}",
            "status": "inspection_assigned" if inspector_id else "under_review",
            "severity": request.severity,
            "owner_user_id": moderator_user_id,
            "assigned_inspector_id": inspector_id,
            "state_code": work.get("state_code", ""),
            "district_code": work.get("district_code", ""),
            "due_date": request.due_date,
            "events": [
                {
                    "event_id": str(uuid4()),
                    "event_type": "case_created",
                    "actor_user_id": moderator_user_id,
                    "reason": f"Escalated from citizen report {issue['reference_id']}",
                    "details": {"source": "citizen_report", "reference_id": issue["reference_id"]},
                    "created_at": now,
                }
            ],
            "comments": [],
            "requests": [],
            "corrective_plan": None,
            "verification_scope": "Field verification of citizen-reported ground issue",
            "specific_questions": [f"Verify citizen grievance: {issue.get('issue_type', 'work')}"],
            "anomaly_metrics": {"citizen_report_ref": issue["reference_id"]},
            "created_at": now,
            "updated_at": now,
        }
        await self._db.get_collection("cases").insert_one(case_doc)
        
        # Update citizen issue
        updates: dict[str, Any] = {
            "linked_case_id": case_id,
            "status": CitizenIssueStatus.INSPECTION_ASSIGNED.value if inspector_id else CitizenIssueStatus.UNDER_REVIEW.value,
            "public_status_message": f"Escalated to Official Case (ID: {case_id[:8]}) for formal verification.",
            "moderation_reason": f"Escalated to formal Case Management by District Authority. {request.case_notes.strip()}".strip(),
            "updated_at": now,
        }
        if inspector_id:
            updates["assigned_inspector_id"] = inspector_id
            insp_doc = await self._db.get_collection("users").find_one(
                {"user_id": inspector_id},
                {"_id": 0, "full_name": 1, "username": 1}
            )
            if insp_doc:
                updates["assigned_inspector_name"] = insp_doc.get("full_name") or insp_doc.get("username")
                await self._db.get_collection("users").update_one(
                    {"user_id": inspector_id},
                    {"$addToSet": {"jurisdiction.assigned_task_ids": reference_id.upper()}}
                )
        
        await self._issues.update_one({"reference_id": reference_id.upper()}, {"$set": updates})
        
        await self._audit.log_event(
            AuditEventType.CITIZEN_ISSUE_MODERATED,
            user_id=moderator_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="citizen_issue",
            resource_id=reference_id.upper(),
            details={"action": "escalated_to_case", "case_id": case_id, "work_id": str(issue["work_id"])},
        )
        
        if inspector_id:
            try:
                work_t = str(issue.get("work_title") or "Public Work")
                await NotificationService(self._db).create_event(
                    recipient_user_id=inspector_id,
                    event_type=NotificationEventType.CITIZEN_REPORT_UPDATED,
                    resource_type="citizen_issue",
                    resource_id=reference_id.upper(),
                    idempotency_key=f"citizen-case:{reference_id.upper()}:{case_id}:{inspector_id}",
                    title=f"Citizen Case Assigned: {work_t[:40]}",
                    message=f"Official investigation Case {case_id[:8]} created from citizen report {reference_id.upper()} and assigned to you.",
                )
            except Exception as exc:
                logger.warning("Could not create case assignment notification: %s", type(exc).__name__)
        
        return {
            "case_id": case_id,
            "reference_id": reference_id.upper(),
            "status": updates["status"],
            "message": "Citizen issue successfully escalated to official Case Management",
        }

    async def moderate_issue(
        self,
        reference_id: str,
        request: CitizenIssueModerationUpdate,
        *,
        allowed_work_ids: set[str],
        moderator_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[CitizenIssueModerationResponse]:
        issue = await self._issues.find_one({"reference_id": reference_id.upper()}, {"_id": 0})
        if not issue or str(issue.get("work_id")) not in allowed_work_ids:
            return None
        current = CitizenIssueStatus(issue["status"])
        if request.status not in ALLOWED_TRANSITIONS[current]:
            raise ValueError(f"Cannot move a citizen report from {current.value} to {request.status.value}")
        if request.status in {CitizenIssueStatus.RESOLVED, CitizenIssueStatus.CLOSED} and not request.reason.strip():
            raise ValueError("A moderation reason is required when resolving or closing a citizen report")
        if request.status == CitizenIssueStatus.INSPECTION_ASSIGNED and not request.assigned_inspector_id:
            raise ValueError("An inspector ID is required when assigning inspection")
        now = datetime.now(timezone.utc)
        updates = {
            "status": request.status.value,
            "public_status_message": request.public_status_message.strip() or STATUS_MESSAGES[request.status],
            "moderation_reason": request.reason.strip(),
            "updated_at": now,
        }
        if request.assigned_inspector_id:
            updates["assigned_inspector_id"] = request.assigned_inspector_id
            # Resolve inspector name and register task to inspector's jurisdiction
            insp_doc = await self._db.get_collection("users").find_one(
                {"user_id": request.assigned_inspector_id},
                {"_id": 0, "full_name": 1, "username": 1}
            )
            if insp_doc:
                updates["assigned_inspector_name"] = insp_doc.get("full_name") or insp_doc.get("username")
                await self._db.get_collection("users").update_one(
                    {"user_id": request.assigned_inspector_id},
                    {"$addToSet": {"jurisdiction.assigned_task_ids": reference_id.upper()}}
                )

        await self._issues.update_one({"reference_id": reference_id.upper()}, {"$set": updates})
        issue.update(updates)
        await self._audit.log_event(
            AuditEventType.CITIZEN_ISSUE_MODERATED, user_id=moderator_user_id, ip_address=ip_address, user_agent=user_agent,
            resource_type="citizen_issue", resource_id=reference_id.upper(),
            details={"status": request.status.value, "work_id": str(issue["work_id"]), "assigned_inspector": bool(request.assigned_inspector_id)},
        )
        # Notification text contains no citizen description, contact detail,
        # image, or location. A recipient opens the restricted queue only if
        # their role and jurisdiction permit it.
        if request.assigned_inspector_id:
            try:
                work_t = str(issue.get("work_title") or "Public Work")
                await NotificationService(self._db).create_event(
                    recipient_user_id=request.assigned_inspector_id,
                    event_type=NotificationEventType.CITIZEN_REPORT_UPDATED,
                    resource_type="citizen_issue", resource_id=reference_id.upper(),
                    idempotency_key=f"citizen-report:{reference_id.upper()}:{request.status.value}:{request.assigned_inspector_id}",
                    title=f"Citizen Issue Assigned: {work_t[:40]}",
                    message=f"You have been assigned to verify citizen report {reference_id.upper()}. Reason: {request.reason or 'Site inspection required'}",
                )
            except Exception as exc:
                logger.warning("Could not create citizen-report notification: %s", type(exc).__name__)
        return _moderation_response(issue, viewer_role="district_authority")

    async def list_all_community_issues(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
    ) -> CitizenCommunityIssueListResponse:
        """
        Public-safe list of all community-raised citizen issues across the portal.
        No citizen identity or contact data is exposed.
        """
        total = await self._issues.count_documents({})
        cursor = self._issues.find(
            {},
            {
                "_id": 0,
                "reference_id": 1,
                "work_id": 1,
                "work_title": 1,
                "district_name": 1,
                "state_name": 1,
                "category": 1,
                "issue_type": 1,
                "description": 1,
                "status": 1,
                "public_status_message": 1,
                "moderation_reason": 1,
                "evidence": 1,
                "submitted_at": 1,
                "updated_at": 1,
            }
        ).sort("submitted_at", -1).skip((page - 1) * page_size).limit(page_size)
        docs = await cursor.to_list(length=page_size)
        items = []
        for doc in docs:
            raw_status = doc.get("status", "received")
            status_enum = CitizenIssueStatus(raw_status) if raw_status in CitizenIssueStatus._value2member_map_ else CitizenIssueStatus.RECEIVED
            evidence_list = doc.get("evidence") or []
            items.append(CitizenCommunityIssueItem(
                reference_id=str(doc.get("reference_id", "")),
                work_id=str(doc.get("work_id", "")),
                work_title=str(doc.get("work_title", "Public Development Project")),
                district_name=str(doc.get("district_name", "")),
                state_name=str(doc.get("state_name", "")),
                category=str(doc.get("category", "")),
                issue_type=str(doc.get("issue_type", "other")),
                description=str(doc.get("description", "")),
                status=raw_status,
                status_message=str(doc.get("public_status_message") or STATUS_MESSAGES.get(status_enum, "Received")),
                changes_done=str(doc.get("moderation_reason") or ""),
                evidence_received=len(evidence_list) > 0,
                evidence_count=len(evidence_list),
                submitted_at=doc.get("submitted_at") or datetime.now(timezone.utc),
                updated_at=doc.get("updated_at") or datetime.now(timezone.utc),
            ))
        total_pages = max(1, math.ceil(total / page_size))
        return CitizenCommunityIssueListResponse(
            issues=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def list_citizen_user_issues(
        self,
        *,
        user_id: str,
        email: str,
    ) -> list[CitizenPersonalIssueItem]:
        """
        Returns only issues submitted by the logged-in citizen.
        Includes real-time lifecycle tracking, assigned inspector status, and authority resolution remarks.
        """
        cursor = self._issues.find(
            {
                "$or": [
                    {"citizen_user_id": user_id},
                    {"citizen_email": email},
                ]
            },
            {"_id": 0}
        ).sort("submitted_at", -1)
        docs = await cursor.to_list(length=100)
        items = []
        for doc in docs:
            raw_status = doc.get("status", "received")
            status_enum = CitizenIssueStatus(raw_status) if raw_status in CitizenIssueStatus._value2member_map_ else CitizenIssueStatus.RECEIVED
            evidence_list = doc.get("evidence") or []
            items.append(CitizenPersonalIssueItem(
                reference_id=str(doc.get("reference_id", "")),
                work_id=str(doc.get("work_id", "")),
                work_title=str(doc.get("work_title", "Public Development Project")),
                district_name=str(doc.get("district_name", "")),
                state_name=str(doc.get("state_name", "")),
                category=str(doc.get("category", "")),
                issue_type=str(doc.get("issue_type", "other")),
                description=str(doc.get("description", "")),
                status=raw_status,
                status_message=str(doc.get("public_status_message") or STATUS_MESSAGES.get(status_enum, "In progress")),
                moderation_reason=str(doc.get("moderation_reason", "")),
                assigned_inspector_name=doc.get("assigned_inspector_name"),
                evidence_received=len(evidence_list) > 0,
                evidence_count=len(evidence_list),
                location_consent=bool(doc.get("location_consent")),
                latitude=doc.get("latitude"),
                longitude=doc.get("longitude"),
                submitted_at=doc.get("submitted_at") or datetime.now(timezone.utc),
                updated_at=doc.get("updated_at") or datetime.now(timezone.utc),
            ))
        return items

    async def _verify_challenge(self, verification_id: str, answer: str) -> None:
        challenge = await self._challenges.find_one({"verification_id": verification_id}, {"_id": 0})
        now = datetime.now(timezone.utc)
        expires_at = challenge.get("expires_at") if challenge else None
        if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not challenge or challenge.get("used_at") or not expires_at or expires_at <= now:
            raise ValueError("The demo verification challenge has expired. Request a new one.")
        await self._challenges.update_one({"verification_id": verification_id}, {"$set": {"used_at": now}})
        expected = str(challenge.get("answer_hash", ""))
        if not hmac.compare_digest(expected, _challenge_answer_hash(verification_id, answer.strip())):
            raise ValueError("Demo verification answer is incorrect")


def _matches_public_search(
    doc: dict[str, Any], *, query: str | None, pincode: str | None, district: str | None,
    constituency: str | None, work_id: str | None, category: WorkCategory | None, mp_name: str | None,
) -> bool:
    location = doc.get("location") if isinstance(doc.get("location"), dict) else {}
    doc_pincode = str(doc.get("pincode") or location.get("pincode") or "")
    def contains(value: Any, expected: str | None) -> bool:
        return not expected or expected.strip().casefold() in str(value or "").casefold()
    if not contains(doc_pincode, pincode) or not contains(doc.get("district_name"), district): return False
    if not contains(doc.get("constituency"), constituency) or not contains(doc.get("work_id"), work_id): return False
    if not contains(doc.get("mp_name"), mp_name): return False
    if category and str(doc.get("category", "")) != category.value: return False
    if query:
        fields = [doc.get("work_id"), doc.get("title"), doc.get("description"), doc.get("district_name"), doc.get("constituency"), doc.get("mp_name"), doc_pincode, doc.get("category")]
        if not any(contains(value, query) for value in fields): return False
    return True


def _public_summary(doc: dict[str, Any]) -> PublicWorkSummary:
    location = doc.get("location") if isinstance(doc.get("location"), dict) else {}
    return PublicWorkSummary(
        work_id=str(doc["work_id"]), title=str(doc.get("title", "Untitled work")),
        category=WorkCategory(doc.get("category", WorkCategory.OTHER.value)), status=WorkStatus(doc.get("status", WorkStatus.RECOMMENDED.value)),
        state_name=str(doc.get("state_name", "") or ""), district_name=str(doc.get("district_name", "") or ""),
        constituency=str(doc.get("constituency", "") or ""), mp_name=str(doc.get("mp_name", "") or ""),
        pincode=str(doc.get("pincode") or location.get("pincode") or ""),
        physical_progress_pct=float(doc.get("physical_progress_pct", 0) or 0),
        location_address=str(location.get("address", "") or ""), expected_completion_date=doc.get("expected_completion_date"),
        qr_payload=f"SAMARTH:{doc['work_id']}",
    )


def _public_detail(doc: dict[str, Any]) -> PublicWorkDetail:
    summary = _public_summary(doc)
    return PublicWorkDetail(
        **summary.model_dump(), description=str(doc.get("description", "") or ""), sub_category=str(doc.get("sub_category", "") or ""),
        start_date=doc.get("start_date"), actual_completion_date=doc.get("actual_completion_date"), last_updated_at=doc.get("updated_at"),
    )


def _moderation_response(doc: dict[str, Any], viewer_role: str = "") -> CitizenIssueModerationResponse:
    has_location = bool(doc.get("location_consent"))
    evidence_raw = list(doc.get("evidence") or [])
    can_view_images = viewer_role in {"district_authority", "admin"}

    evidence_items: list[CitizenEvidenceItem] = []
    ref_id = str(doc.get("reference_id", ""))
    for ev in evidence_raw:
        ev_id = str(ev.get("evidence_id", ""))
        content_type = str(ev.get("content_type", "image/jpeg"))
        file_size = int(ev.get("file_size_bytes", 0))
        rec_at = ev.get("received_at") or doc.get("submitted_at") or datetime.now(timezone.utc)
        if can_view_images:
            evidence_items.append(
                CitizenEvidenceItem(
                    evidence_id=ev_id,
                    content_type=content_type,
                    file_size_bytes=file_size,
                    received_at=rec_at,
                    url=f"/api/v1/citizen-reports/{ref_id}/evidence/{ev_id}",
                    restricted=False,
                    restriction_message=None,
                )
            )
        else:
            evidence_items.append(
                CitizenEvidenceItem(
                    evidence_id=ev_id,
                    content_type=content_type,
                    file_size_bytes=file_size,
                    received_at=rec_at,
                    url=None,
                    restricted=True,
                    restriction_message="Under MoSPI citizen privacy & whistleblower protection guidelines, citizen evidence photos are confidential and restricted exclusively to District Authorities.",
                )
            )

    return CitizenIssueModerationResponse(
        reference_id=ref_id,
        work_id=str(doc["work_id"]),
        work_title=str(doc.get("work_title", "Public work")),
        issue_type=CitizenIssueType(doc["issue_type"]),
        description=str(doc.get("description", "")),
        status=CitizenIssueStatus(doc["status"]),
        public_status_message=str(doc.get("public_status_message", "")),
        location_consent=has_location,
        latitude=float(doc["latitude"]) if has_location and doc.get("latitude") is not None else None,
        longitude=float(doc["longitude"]) if has_location and doc.get("longitude") is not None else None,
        evidence_count=len(evidence_raw),
        assigned_inspector_id=doc.get("assigned_inspector_id"),
        submitted_at=doc["submitted_at"],
        updated_at=doc["updated_at"],
        moderation_reason=str(doc.get("moderation_reason", "")),
        evidence_items=evidence_items,
        can_view_images=can_view_images,
        linked_case_id=doc.get("linked_case_id"),
    )


def _extract_qr_work_id(payload: str) -> str:
    text = unquote(payload or "").strip()
    marker = re.search(r"SAMARTH:([^\s/?#]+)", text, flags=re.IGNORECASE)
    if marker:
        return marker.group(1)
    parsed = urlparse(text)
    query_id = parse_qs(parsed.query).get("work_id") or parse_qs(parsed.query).get("qr")
    if query_id:
        return _extract_qr_work_id(query_id[0])
    match = re.search(r"/works/([^/?#]+)", parsed.path)
    return unquote(match.group(1)) if match else text


def _challenge_answer_hash(verification_id: str, answer: str) -> str:
    return _sha256(f"{verification_id}:{answer}".encode("utf-8"))


def _sha256(value: str | bytes) -> str:
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode("utf-8")).hexdigest()


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _safe_image_suffix(filename: str, content_type: str) -> str:
    extension = Path(filename).suffix.lower()
    allowed = {".jpg", ".jpeg", ".png", ".webp"}
    if extension in allowed:
        return extension
    return {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]


def _validate_image(content: bytes, content_type: str) -> None:
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("Only JPEG, PNG, and WebP evidence photos are accepted")
    if not content or len(content) > 8 * 1024 * 1024:
        raise ValueError("Evidence photo must be between 1 byte and 8 MB")
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
    except Exception as exc:
        raise ValueError("Evidence photo is not a valid image") from exc
