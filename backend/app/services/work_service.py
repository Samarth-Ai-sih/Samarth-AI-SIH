"""
SAMARTH AI — Work Service

Business logic for MPLADS work lifecycle management:
- CRUD operations on works
- Status transitions with timeline tracking
- Payment tranche management
- Progress update tracking
- Work 360° aggregated view
- MongoDB index creation

All write operations produce audit log entries.
"""

import logging
import math
import re
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.background import NotificationEventType
from app.models.work import (
    DirectInspectionDispatchRequest,
    DuplicateWarning,
    MPEntitlementSummaryResponse,
    PaymentTranche,
    PaymentTrancheCreateRequest,
    PreSubmissionDuplicateCheckRequest,
    PreSubmissionDuplicateCheckResponse,
    ProgressUpdate,
    ProgressUpdateCreateRequest,
    StageRoutingInfo,
    StakeholderInfo,
    TimelineEvent,
    WorkCategory,
    WorkCreateRequest,
    WorkInDB,
    WorkLocation,
    WorkRejectRecommendationRequest,
    WorkRoutingResponse,
    WorkSanctionRequest,
    WorkStatus,
    WorkStatusUpdateRequest,
    WorkUpdateRequest,
)
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService

logger = logging.getLogger("samarth.works")

COLLECTION = "works"

# Deliberate work-lifecycle state machine. Terminal cancellation cannot be
# silently reversed; reopening requires a new, explicitly audited work record.
ALLOWED_STATUS_TRANSITIONS: dict[WorkStatus, set[WorkStatus]] = {
    WorkStatus.RECOMMENDED: {WorkStatus.UNDER_REVIEW, WorkStatus.SANCTIONED, WorkStatus.CANCELLED},
    WorkStatus.UNDER_REVIEW: {WorkStatus.RECOMMENDED, WorkStatus.SANCTIONED, WorkStatus.CANCELLED},
    WorkStatus.SANCTIONED: {WorkStatus.IN_PROGRESS, WorkStatus.ON_HOLD, WorkStatus.CANCELLED, WorkStatus.UNDER_VERIFICATION},
    WorkStatus.IN_PROGRESS: {WorkStatus.ON_HOLD, WorkStatus.COMPLETED, WorkStatus.UNDER_VERIFICATION, WorkStatus.CANCELLED},
    WorkStatus.ON_HOLD: {WorkStatus.IN_PROGRESS, WorkStatus.CANCELLED},
    WorkStatus.COMPLETED: {WorkStatus.UNDER_VERIFICATION},
    WorkStatus.UNDER_VERIFICATION: {WorkStatus.COMPLETED, WorkStatus.ON_HOLD},
    WorkStatus.CANCELLED: set(),
}


class WorkService:
    """Work lifecycle service."""

    def __init__(self, db: Database):
        self._db = db
        self._collection = db.get_collection(COLLECTION)
        self._audit = AuditService(db)

    # ── Create ───────────────────────────────────────────────────

    async def create_work(
        self,
        data: WorkCreateRequest,
        *,
        created_by_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> WorkInDB:
        """Create a new work with initial timeline event."""
        now = datetime.now(timezone.utc)
        work_id = str(uuid4())

        initial_timeline = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=data.recommended_date or now,
            event_type="work_recommended",
            title="Work Recommended",
            description=f"Work '{data.title}' recommended for MPLADS funding.",
            actor=created_by_user_id,
        )

        work = WorkInDB(
            work_id=work_id,
            title=data.title,
            description=data.description,
            status=WorkStatus.RECOMMENDED,
            category=data.category,
            sub_category=data.sub_category,
            state_code=data.state_code,
            state_name=data.state_name,
            district_code=data.district_code,
            district_name=data.district_name,
            constituency=data.constituency,
            pincode=data.pincode,
            mp_name=data.mp_name,
            mp_id=data.mp_id,
            implementing_agency=data.implementing_agency,
            sanctioned_amount=data.sanctioned_amount,
            recommended_date=data.recommended_date or now,
            expected_completion_date=data.expected_completion_date,
            location=data.location or WorkInDB.model_fields["location"].default_factory(),
            timeline=[initial_timeline],
            data_source="operator_entered",
            created_by=created_by_user_id,
            sc_st_quota_type=data.sc_st_quota_type or "general",
            recommended_by_mp_id=data.recommended_by_mp_id or (created_by_user_id if data.mp_name else None),
            created_at=now,
            updated_at=now,
        )

        document = work.model_dump()
        document["location"] = self._location_for_storage(work.location)
        await self._collection.insert_one(document)

        # Audit
        await self._audit.log_event(
            AuditEventType.WORK_CREATED,
            user_id=created_by_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={
                "title": data.title,
                "state_code": data.state_code,
                "category": data.category.value,
                "sc_st_quota_type": work.sc_st_quota_type,
            },
        )

        # Dispatch real-time notification to District Authority in matching jurisdiction
        try:
            da_query: dict[str, Any] = {"role": "district_authority"}
            if data.district_code:
                da_query["jurisdiction.district_code"] = re.compile(f"^{re.escape(data.district_code)}$", re.IGNORECASE)
            elif data.state_code:
                da_query["jurisdiction.state_code"] = re.compile(f"^{re.escape(data.state_code)}$", re.IGNORECASE)
            da_users = await self._db.get_collection("users").find(da_query, {"_id": 0, "user_id": 1}).to_list(length=10)
            notif_svc = NotificationService(self._db)
            for da in da_users:
                await notif_svc.create_event(
                    recipient_user_id=da["user_id"],
                    event_type=NotificationEventType.MP_WORK_RECOMMENDED,
                    resource_type="work",
                    resource_id=work_id,
                    idempotency_key=f"mp_rec_{work_id}_{da['user_id']}",
                    title=f"New MP Recommendation: {data.title}",
                    message=f"MP {data.mp_name or 'Hon. MP'} recommended a public asset in {data.constituency or data.district_name} (Rs {data.sanctioned_amount:,.2f}) awaiting Administrative Sanction.",
                )
        except Exception as e:
            logger.warning("Failed to dispatch DA notification for new work %s: %s", work_id, e)

        logger.info("Work created: %s — %s", work_id, data.title)
        return work

    # ── Read ─────────────────────────────────────────────────────

    async def get_work(
        self,
        work_id: str,
        *,
        jurisdiction_filter: dict[str, Any] | None = None,
    ) -> Optional[WorkInDB]:
        """Get a work only when it is visible inside the supplied scope."""
        doc = await self._collection.find_one(
            self._work_query(work_id, jurisdiction_filter), {"_id": 0}
        )
        if not doc:
            return None
        return WorkInDB(**doc)

    @staticmethod
    def _work_query(
        work_id: str,
        jurisdiction_filter: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build a single Mongo query so IDOR checks remain atomic with writes."""
        query: dict[str, Any] = {"work_id": work_id}
        if jurisdiction_filter:
            state_code = jurisdiction_filter.get("state_code")
            if state_code:
                return {
                    "work_id": work_id,
                    "$or": [
                        jurisdiction_filter,
                        {"state_code": state_code, "sno_notice_issued": True},
                    ],
                }
            query.update(jurisdiction_filter)
        return query

    async def list_works(
        self,
        *,
        jurisdiction_filter: dict[str, Any] | None = None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        risk_tier: Optional[str] = None,
        state_code: Optional[str] = None,
        district_code: Optional[str] = None,
        constituency: Optional[str] = None,
        search: Optional[str] = None,
        sort_by: str = "created_at",
        sort_order: int = -1,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int, int]:
        """
        List works with filters, search, sort, and pagination.
        Returns (works_list, total_count, total_pages).
        """
        query = self._build_work_filter(
            jurisdiction_filter=jurisdiction_filter,
            status=status,
            category=category,
            risk_tier=risk_tier,
            state_code=state_code,
            district_code=district_code,
            constituency=constituency,
            search=search,
        )

        total = await self._collection.count_documents(query)
        total_pages = max(1, math.ceil(total / page_size))
        skip = (page - 1) * page_size

        # Projection — exclude heavy embedded arrays for list view
        projection = {
            "_id": 0,
            "payment_tranches": 0,
            "progress_updates": 0,
            "timeline": 0,
        }

        # Validate sort field to prevent injection
        allowed_sorts = {
            "created_at", "updated_at", "title", "status",
            "sanctioned_amount", "funds_released", "physical_progress_pct",
            "state_name", "mp_name", "recommended_date",
        }
        if sort_by not in allowed_sorts:
            sort_by = "created_at"

        cursor = (
            self._collection.find(query, projection)
            .sort(sort_by, sort_order)
            .skip(skip)
            .limit(page_size)
        )
        works = await cursor.to_list(length=page_size)
        return works, total, total_pages

    async def list_map_works(
        self,
        *,
        jurisdiction_filter: dict[str, Any] | None = None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        risk_tier: Optional[str] = None,
        state_code: Optional[str] = None,
        district_code: Optional[str] = None,
        constituency: Optional[str] = None,
        work_id: Optional[str] = None,
        search: Optional[str] = None,
        updated_from: Optional[datetime] = None,
        updated_to: Optional[datetime] = None,
        bounding_box: tuple[float, float, float, float] | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> tuple[list[dict[str, Any]], int, int, int, int]:
        """Return only geographically valid, scoped marker records.

        The count of matching works is deliberately calculated before the
        coordinate filter.  This lets the UI distinguish absent source
        coordinates from an empty result and avoids inventing locations.
        """
        base_query = self._build_work_filter(
            jurisdiction_filter=jurisdiction_filter,
            status=status,
            category=category,
            risk_tier=risk_tier,
            state_code=state_code,
            district_code=district_code,
            constituency=constituency,
            search=search,
            work_id=work_id,
            updated_from=updated_from,
            updated_to=updated_to,
        )
        # In production, exclude synthetic demo/training records from map view.
        # In development/demo, permit records with valid coordinates to populate the map.
        from app.core.config import get_settings
        if get_settings().is_production:
            self._add_filter(
                base_query,
                "data_source",
                {"$nin": ["synthetic_demo", "synthetic_ml_training"]},
            )
        total_matching = await self._collection.count_documents(base_query)

        map_query = deepcopy(base_query)
        if bounding_box:
            min_longitude, min_latitude, max_longitude, max_latitude = bounding_box
            # $geometry (rather than legacy $box) is the GeoJSON query form
            # supported by the work_location_geo_idx 2dsphere index.
            self._add_filter(map_query, "location.geo", {
                "$geoWithin": {
                    "$geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [min_longitude, min_latitude],
                            [max_longitude, min_latitude],
                            [max_longitude, max_latitude],
                            [min_longitude, max_latitude],
                            [min_longitude, min_latitude],
                        ]],
                    }
                }
            })
        else:
            # Valid GeoJSON points are created on work create/update and safely
            # backfilled for legacy records at application startup.
            self._add_filter(map_query, "location.geo.type", "Point")

        coordinate_count = await self._collection.count_documents(map_query)
        total_pages = max(1, math.ceil(coordinate_count / page_size))
        projection = {
            "_id": 0,
            "work_id": 1,
            "title": 1,
            "status": 1,
            "category": 1,
            "state_code": 1,
            "state_name": 1,
            "district_code": 1,
            "district_name": 1,
            "constituency": 1,
            "mp_name": 1,
            "implementing_agency": 1,
            "sanctioned_amount": 1,
            "funds_released": 1,
            "actual_expenditure": 1,
            "physical_progress_pct": 1,
            "composite_risk_score": 1,
            "risk_tier": 1,
            "location": 1,
            "updated_at": 1,
            "created_at": 1,
        }
        cursor = (
            self._collection.find(map_query, projection)
            .sort("updated_at", -1)
            .skip((page - 1) * page_size)
            .limit(page_size)
        )
        return (
            await cursor.to_list(length=page_size),
            total_matching,
            coordinate_count,
            total_pages,
            max(0, total_matching - coordinate_count),
        )

    async def assigned_inspector_work_ids(
        self, *, inspector_user_id: str, assigned_task_ids: list[str]
    ) -> set[str]:
        """Resolve inspector case assignments to work IDs on the server.

        Inspector task IDs are case IDs, not fields on the work document. This
        keeps task assignment authoritative and prevents a query parameter from
        granting map access to another work.
        """
        if not assigned_task_ids:
            return set()
        cases = await self._db.get_collection("cases").find(
            {
                "case_id": {"$in": sorted(set(assigned_task_ids))},
                "assigned_inspector_id": inspector_user_id,
            },
            {"_id": 0, "work_id": 1},
        ).to_list(length=None)
        return {str(case["work_id"]) for case in cases if case.get("work_id")}

    @staticmethod
    def _add_filter(query: dict[str, Any], field: str, condition: Any) -> None:
        """Add a constraint without allowing a client filter to replace scope."""
        if field not in query:
            query[field] = condition
            return
        existing = query.pop(field)
        query.setdefault("$and", []).extend([{field: existing}, {field: condition}])

    @classmethod
    def _build_work_filter(
        cls,
        *,
        jurisdiction_filter: dict[str, Any] | None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        risk_tier: Optional[str] = None,
        state_code: Optional[str] = None,
        district_code: Optional[str] = None,
        constituency: Optional[str] = None,
        work_id: Optional[str] = None,
        search: Optional[str] = None,
        updated_from: Optional[datetime] = None,
        updated_to: Optional[datetime] = None,
    ) -> dict[str, Any]:
        """Build the shared list/map query while preserving jurisdiction scope."""
        query: dict[str, Any] = deepcopy(jurisdiction_filter or {})
        if status:
            cls._add_filter(query, "status", status)
        if category:
            cls._add_filter(query, "category", category)
        if risk_tier:
            cls._add_filter(query, "risk_tier", risk_tier)
        if state_code:
            cls._add_filter(query, "state_code", {"$regex": f"^{re.escape(state_code)}$", "$options": "i"})
        if district_code:
            cls._add_filter(query, "district_code", {"$regex": f"^{re.escape(district_code)}$", "$options": "i"})
        if constituency:
            cls._add_filter(query, "constituency", {"$regex": re.escape(constituency), "$options": "i"})
        if work_id:
            cls._add_filter(query, "work_id", {"$regex": f"^{re.escape(work_id)}$", "$options": "i"})
        if updated_from or updated_to:
            date_filter: dict[str, datetime] = {}
            if updated_from:
                date_filter["$gte"] = updated_from
            if updated_to:
                date_filter["$lte"] = updated_to
            cls._add_filter(query, "updated_at", date_filter)
        if search:
            escaped = re.escape(search)
            query.setdefault("$and", []).append({
                "$or": [
                    {"title": {"$regex": escaped, "$options": "i"}},
                    {"description": {"$regex": escaped, "$options": "i"}},
                    {"mp_name": {"$regex": escaped, "$options": "i"}},
                    {"implementing_agency": {"$regex": escaped, "$options": "i"}},
                    {"work_id": {"$regex": escaped, "$options": "i"}},
                ]
            })
        return query

    @staticmethod
    def _location_for_storage(location: Any) -> dict[str, Any]:
        """Preserve raw coordinates and add GeoJSON only when they are valid."""
        raw = location.model_dump() if isinstance(location, WorkLocation) else dict(location or {})
        latitude, longitude = raw.get("latitude"), raw.get("longitude")
        if _valid_coordinates(latitude, longitude):
            raw["geo"] = {"type": "Point", "coordinates": [float(longitude), float(latitude)]}
        else:
            # Do not manufacture a point from an address or incomplete input.
            raw.pop("geo", None)
        return raw

    async def _backfill_geojson_locations(self) -> int:
        """Add a GeoJSON mirror to legacy valid coordinates without deleting data."""
        cursor = self._collection.find(
            {"location.latitude": {"$exists": True}, "location.longitude": {"$exists": True}},
            {"_id": 0, "work_id": 1, "location": 1},
        )
        records = await cursor.to_list(length=None)
        updated = 0
        for record in records:
            location = record.get("location") if isinstance(record.get("location"), dict) else {}
            if not _valid_coordinates(location.get("latitude"), location.get("longitude")):
                continue
            expected = self._location_for_storage(location).get("geo")
            if location.get("geo") == expected:
                continue
            result = await self._collection.update_one(
                {"work_id": record.get("work_id")}, {"$set": {"location.geo": expected}}
            )
            updated += int(bool(getattr(result, "matched_count", 0)))
        return updated

    # ── Update ───────────────────────────────────────────────────

    async def update_work(
        self,
        work_id: str,
        data: WorkUpdateRequest,
        *,
        updated_by_user_id: str,
        jurisdiction_filter: dict[str, Any] | None = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[WorkInDB]:
        """Partially update work fields."""
        update_fields = data.model_dump(exclude_unset=True)
        if not update_fields:
            return await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)

        # Handle nested location
        if "location" in update_fields and update_fields["location"] is not None:
            update_fields["location"] = self._location_for_storage(update_fields["location"])

        now = datetime.now(timezone.utc)
        update_fields["updated_at"] = now

        # Create timeline event for the update
        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="work_updated",
            title="Work Details Updated",
            description=f"Fields updated: {', '.join(update_fields.keys())}",
            actor=updated_by_user_id,
        )

        result = await self._collection.update_one(
            self._work_query(work_id, jurisdiction_filter),
            {
                "$set": update_fields,
                "$push": {"timeline": timeline_event.model_dump()},
            },
        )

        if result.matched_count == 0:
            return None

        # Audit
        await self._audit.log_event(
            AuditEventType.WORK_UPDATED,
            user_id=updated_by_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={"updated_fields": list(update_fields.keys())},
        )

        return await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)

    # ── Status Transition ────────────────────────────────────────

    async def update_status(
        self,
        work_id: str,
        data: WorkStatusUpdateRequest,
        *,
        updated_by_user_id: str,
        jurisdiction_filter: dict[str, Any] | None = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[WorkInDB]:
        """Update work status with timeline event and audit log."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            return None

        now = datetime.now(timezone.utc)
        old_status = work.status.value
        new_status = data.status.value

        if data.status != work.status and data.status not in ALLOWED_STATUS_TRANSITIONS[work.status]:
            raise ValueError(f"Cannot transition work from {old_status} to {new_status}")

        # Build update
        update: dict[str, Any] = {
            "status": new_status,
            "updated_at": now,
        }

        # Set date fields based on status transition
        if data.status == WorkStatus.SANCTIONED and not work.sanctioned_date:
            update["sanctioned_date"] = now
        elif data.status == WorkStatus.IN_PROGRESS and not work.start_date:
            update["start_date"] = now
        elif data.status == WorkStatus.COMPLETED and not work.actual_completion_date:
            update["actual_completion_date"] = now

        # Status-specific title
        status_titles = {
            "recommended": "Work Recommended",
            "under_review": "Work Under Review",
            "sanctioned": "Work Sanctioned",
            "in_progress": "Work In Progress",
            "on_hold": "Work Put On Hold",
            "completed": "Work Completed",
            "under_verification": "Work Under Verification",
            "cancelled": "Work Cancelled",
        }

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="status_change",
            title=status_titles.get(new_status, f"Status → {new_status}"),
            description=data.reason or f"Status changed from {old_status} to {new_status}.",
            actor=updated_by_user_id,
        )

        result = await self._collection.update_one(
            self._work_query(work_id, jurisdiction_filter),
            {
                "$set": update,
                "$push": {"timeline": timeline_event.model_dump()},
            },
        )

        if result.matched_count == 0:
            return None

        # Audit
        await self._audit.log_event(
            AuditEventType.WORK_STATUS_CHANGE,
            user_id=updated_by_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={
                "old_status": old_status,
                "new_status": new_status,
                "reason": data.reason,
            },
        )

        return await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)

    # ── Delete (Soft) ────────────────────────────────────────────

    async def delete_work(
        self,
        work_id: str,
        *,
        deleted_by_user_id: str,
        jurisdiction_filter: dict[str, Any] | None = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> bool:
        """Soft-delete a work by setting status to cancelled."""
        now = datetime.now(timezone.utc)

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="work_deleted",
            title="Work Cancelled / Deleted",
            description="Work has been cancelled.",
            actor=deleted_by_user_id,
        )

        result = await self._collection.update_one(
            self._work_query(work_id, jurisdiction_filter),
            {
                "$set": {
                    "status": WorkStatus.CANCELLED.value,
                    "updated_at": now,
                },
                "$push": {"timeline": timeline_event.model_dump()},
            },
        )

        if result.matched_count == 0:
            return False

        await self._audit.log_event(
            AuditEventType.WORK_DELETED,
            user_id=deleted_by_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
        )

        return True

    # ── Payment Tranches ─────────────────────────────────────────

    async def add_payment_tranche(
        self,
        work_id: str,
        data: PaymentTrancheCreateRequest,
        *,
        added_by_user_id: str,
        jurisdiction_filter: dict[str, Any] | None = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[WorkInDB]:
        """Add a payment tranche and recalculate funds_released."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            return None

        now = datetime.now(timezone.utc)
        tranche_number = len(work.payment_tranches) + 1

        tranche = PaymentTranche(
            tranche_id=str(uuid4()),
            tranche_number=tranche_number,
            amount=data.amount,
            released_date=data.released_date,
            purpose=data.purpose,
            released_by=added_by_user_id,
            created_at=now,
        )

        new_funds_released = work.funds_released + data.amount

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="payment_released",
            title=f"Payment Tranche #{tranche_number} Released",
            description=f"₹{data.amount:,.2f} released. Purpose: {data.purpose or 'N/A'}",
            actor=added_by_user_id,
        )

        result = await self._collection.update_one(
            self._work_query(work_id, jurisdiction_filter),
            {
                "$push": {
                    "payment_tranches": tranche.model_dump(),
                    "timeline": timeline_event.model_dump(),
                },
                "$set": {
                    "funds_released": new_funds_released,
                    "updated_at": now,
                },
            },
        )

        if result.matched_count == 0:
            return None

        await self._audit.log_event(
            AuditEventType.PAYMENT_ADDED,
            user_id=added_by_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={
                "tranche_number": tranche_number,
                "amount": data.amount,
                "total_released": new_funds_released,
            },
        )

        return await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)

    async def get_payment_tranches(
        self, work_id: str, *, jurisdiction_filter: dict[str, Any] | None = None,
    ) -> Optional[list[dict[str, Any]]]:
        """Return payment tranches for a work."""
        doc = await self._collection.find_one(
            self._work_query(work_id, jurisdiction_filter),
            {"_id": 0, "payment_tranches": 1},
        )
        if not doc:
            return None
        return doc.get("payment_tranches", [])

    # ── Progress Updates ─────────────────────────────────────────

    async def add_progress_update(
        self,
        work_id: str,
        data: ProgressUpdateCreateRequest,
        *,
        added_by_user_id: str,
        jurisdiction_filter: dict[str, Any] | None = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[WorkInDB]:
        """Add a progress update and update physical progress."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            return None

        now = datetime.now(timezone.utc)

        update = ProgressUpdate(
            update_id=str(uuid4()),
            date=data.date or now,
            physical_progress_pct=data.physical_progress_pct,
            description=data.description,
            updated_by=added_by_user_id,
            attachments=data.attachments,
            created_at=now,
        )

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="progress_update",
            title=f"Progress Update: {data.physical_progress_pct:.0f}%",
            description=data.description or f"Physical progress updated to {data.physical_progress_pct}%.",
            actor=added_by_user_id,
        )

        set_fields: dict[str, Any] = {
            "physical_progress_pct": data.physical_progress_pct,
            "updated_at": now,
        }
        if data.physical_progress_pct >= 100:
            if not work.actual_completion_date:
                set_fields["actual_completion_date"] = now
            if getattr(work, "active_case_id", None) and work.status not in (WorkStatus.COMPLETED, WorkStatus.CANCELLED):
                set_fields["status"] = WorkStatus.UNDER_VERIFICATION.value

        result = await self._collection.update_one(
            self._work_query(work_id, jurisdiction_filter),
            {
                "$push": {
                    "progress_updates": update.model_dump(),
                    "timeline": timeline_event.model_dump(),
                },
                "$set": set_fields,
            },
        )

        if result.matched_count == 0:
            return None

        await self._audit.log_event(
            AuditEventType.PROGRESS_UPDATE_ADDED,
            user_id=added_by_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={
                "physical_progress_pct": data.physical_progress_pct,
            },
        )

        return await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)

    async def get_progress_updates(
        self, work_id: str, *, jurisdiction_filter: dict[str, Any] | None = None,
    ) -> Optional[list[dict[str, Any]]]:
        """Return progress updates for a work."""
        doc = await self._collection.find_one(
            self._work_query(work_id, jurisdiction_filter),
            {"_id": 0, "progress_updates": 1},
        )
        if not doc:
            return None
        return doc.get("progress_updates", [])

    # ── Timeline ─────────────────────────────────────────────────

    async def get_timeline(
        self, work_id: str, *, jurisdiction_filter: dict[str, Any] | None = None,
    ) -> Optional[list[dict[str, Any]]]:
        """Return the timeline events for a work."""
        doc = await self._collection.find_one(
            self._work_query(work_id, jurisdiction_filter),
            {"_id": 0, "timeline": 1},
        )
        if not doc:
            return None
        return doc.get("timeline", [])

    # ── Work 360° ────────────────────────────────────────────────

    async def get_work_360(
        self, work_id: str, *, jurisdiction_filter: dict[str, Any] | None = None,
    ) -> Optional[dict[str, Any]]:
        """
        Get the full 360° view of a work:
        all fields + embedded tranches + progress + timeline.
        """
        doc = await self._collection.find_one(
            self._work_query(work_id, jurisdiction_filter), {"_id": 0}
        )
        if not doc:
            return None

        # Sort timeline by timestamp descending
        if "timeline" in doc:
            doc["timeline"] = sorted(
                doc["timeline"],
                key=lambda e: e.get("timestamp", datetime.min),
                reverse=True,
            )

        # Sort progress updates by date descending
        if "progress_updates" in doc:
            doc["progress_updates"] = sorted(
                doc["progress_updates"],
                key=lambda u: u.get("date", datetime.min),
                reverse=True,
            )

        # Sort payment tranches by tranche_number
        if "payment_tranches" in doc:
            doc["payment_tranches"] = sorted(
                doc["payment_tranches"],
                key=lambda t: t.get("tranche_number", 0),
            )

        return doc

    # ── Audit Events for Work ────────────────────────────────────

    async def get_work_audit_events(
        self, work_id: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Get audit events related to this work."""
        audit_collection = self._db.get_collection("audit_logs")
        cursor = (
            audit_collection.find(
                {"resource_id": work_id, "resource_type": "work"},
                {"_id": 0},
            )
            .sort("timestamp", -1)
            .limit(limit)
        )
        return await cursor.to_list(length=limit)

    # ── Indexes ──────────────────────────────────────────────────

    async def ensure_indexes(self) -> None:
        """Create indexes for efficient work queries."""
        backfilled = await self._backfill_geojson_locations()
        await self._collection.create_index("work_id", unique=True)
        await self._collection.create_index("status")
        await self._collection.create_index("state_code")
        await self._collection.create_index("district_code")
        await self._collection.create_index("constituency")
        await self._collection.create_index("mp_name")
        await self._collection.create_index("category")
        await self._collection.create_index("created_at")
        await self._collection.create_index(
            [("state_code", 1), ("district_code", 1), ("status", 1)],
            name="jurisdiction_status_idx",
        )
        # DuplicateDetectionService uses MongoDB's default name for this same
        # key, so retaining it avoids attempting an equivalent duplicate index.
        await self._collection.create_index([("location.geo", "2dsphere")], name="location.geo_2dsphere")
        logger.info("Work indexes ensured; GeoJSON locations backfilled: %s", backfilled)

    # ── MP Recommendation & District Authority Sanction Workflow ─

    async def sanction_work(
        self,
        work_id: str,
        data: WorkSanctionRequest,
        *,
        user_id: str,
        ip_address: str = "",
        user_agent: str = "",
        jurisdiction_filter: Optional[dict[str, Any]] = None,
    ) -> Optional[WorkInDB]:
        """Grant Administrative Sanction to an MP recommendation."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            return None
        if work.status not in (WorkStatus.RECOMMENDED, WorkStatus.UNDER_REVIEW):
            raise ValueError(f"Only works in recommended or under_review status can be sanctioned (current: {work.status.value})")

        now = datetime.now(timezone.utc)
        update: dict[str, Any] = {
            "status": WorkStatus.SANCTIONED.value,
            "sanctioned_amount": data.sanctioned_amount,
            "implementing_agency": data.implementing_agency,
            "sanction_order_ref": data.sanction_order_ref,
            "sanctioned_date": now,
            "updated_at": now,
        }
        if data.expected_completion_date:
            update["expected_completion_date"] = data.expected_completion_date

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="work_sanctioned",
            title="Administrative Sanction (AS) Accorded",
            description=(
                f"Administrative Sanction order issued: {data.sanction_order_ref}. "
                f"Sanctioned outlay: ₹{data.sanctioned_amount:,.2f}. "
                f"Implementing agency: {data.implementing_agency}."
                + (f" Remarks: {data.remarks}" if data.remarks else "")
            ),
            actor=user_id,
        )

        await self._collection.update_one(
            {"work_id": work_id},
            {
                "$set": update,
                "$push": {"timeline": timeline_event.model_dump()},
            },
        )

        await self._audit.log_event(
            AuditEventType.WORK_STATUS_CHANGE,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={
                "action": "administrative_sanction",
                "sanction_order_ref": data.sanction_order_ref,
                "sanctioned_amount": data.sanctioned_amount,
                "implementing_agency": data.implementing_agency,
            },
        )

        # Real-time notification to MP
        try:
            mp_user_id = work.mp_id or work.recommended_by_mp_id
            if not mp_user_id and work.constituency:
                mp_user = await self._db.get_collection("users").find_one(
                    {"role": "mp", "jurisdiction.constituency": {"$regex": f"^{re.escape(work.constituency)}$", "$options": "i"}},
                    {"_id": 0, "user_id": 1}
                )
                if mp_user:
                    mp_user_id = mp_user.get("user_id")

            if mp_user_id:
                notif_svc = NotificationService(self._db)
                await notif_svc.create_event(
                    recipient_user_id=mp_user_id,
                    event_type=NotificationEventType.MP_WORK_SANCTIONED,
                    resource_type="work",
                    resource_id=work_id,
                    idempotency_key=f"sanction_{work_id}_{now.timestamp()}",
                    title=f"Work Sanctioned: {work.title}",
                    message=f"Administrative Sanction accorded (AS Ref: {data.sanction_order_ref}) for ₹{data.sanctioned_amount:,.2f} via {data.implementing_agency}.",
                )
        except Exception as e:
            logger.warning("Failed to notify MP about sanction for work %s: %s", work_id, e)

        return await self.get_work(work_id)

    async def reject_recommendation(
        self,
        work_id: str,
        data: WorkRejectRecommendationRequest,
        *,
        user_id: str,
        ip_address: str = "",
        user_agent: str = "",
        jurisdiction_filter: Optional[dict[str, Any]] = None,
    ) -> Optional[WorkInDB]:
        """District Authority returning or rejecting an MP recommendation with statutory reason."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            return None
        if work.status not in (WorkStatus.RECOMMENDED, WorkStatus.UNDER_REVIEW):
            raise ValueError(f"Only works in recommended or under_review status can be rejected (current: {work.status.value})")

        now = datetime.now(timezone.utc)
        update: dict[str, Any] = {
            "status": WorkStatus.CANCELLED.value,
            "rejection_reason": data.rejection_reason,
            "updated_at": now,
        }

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="recommendation_rejected",
            title="Recommendation Rejected / Clarification Required",
            description=f"District Authority statutory rationale: {data.rejection_reason}",
            actor=user_id,
        )

        await self._collection.update_one(
            {"work_id": work_id},
            {
                "$set": update,
                "$push": {"timeline": timeline_event.model_dump()},
            },
        )

        await self._audit.log_event(
            AuditEventType.WORK_STATUS_CHANGE,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={
                "action": "recommendation_rejected",
                "rejection_reason": data.rejection_reason,
            },
        )

        # Real-time notification to MP
        try:
            mp_user_id = work.mp_id or work.recommended_by_mp_id
            if not mp_user_id and work.constituency:
                mp_user = await self._db.get_collection("users").find_one(
                    {"role": "mp", "jurisdiction.constituency": {"$regex": f"^{re.escape(work.constituency)}$", "$options": "i"}},
                    {"_id": 0, "user_id": 1}
                )
                if mp_user:
                    mp_user_id = mp_user.get("user_id")

            if mp_user_id:
                notif_svc = NotificationService(self._db)
                await notif_svc.create_event(
                    recipient_user_id=mp_user_id,
                    event_type=NotificationEventType.MP_WORK_REJECTED,
                    resource_type="work",
                    resource_id=work_id,
                    idempotency_key=f"reject_{work_id}_{now.timestamp()}",
                    title=f"Recommendation Returned: {work.title}",
                    message=f"District Authority returned recommendation: {data.rejection_reason}",
                )
        except Exception as e:
            logger.warning("Failed to notify MP about rejection for work %s: %s", work_id, e)

        return await self.get_work(work_id)

    async def check_pre_submission_duplicate(
        self,
        req: PreSubmissionDuplicateCheckRequest,
    ) -> PreSubmissionDuplicateCheckResponse:
        """Pre-submission spatial and title duplicate check for MP proposals."""
        warnings: list[DuplicateWarning] = []
        query: dict[str, Any] = {"status": {"$ne": WorkStatus.CANCELLED.value}}
        if req.state_code:
            query["state_code"] = {"$regex": f"^{re.escape(req.state_code.strip())}$", "$options": "i"}

        cursor = self._collection.find(
            query,
            {
                "_id": 0,
                "work_id": 1,
                "title": 1,
                "status": 1,
                "location": 1,
            }
        )
        existing_works = await cursor.to_list(length=2000)

        # 1. Spatial distance check (limit <= 50m)
        if req.latitude is not None and req.longitude is not None and _valid_coordinates(req.latitude, req.longitude):
            target_lat = float(req.latitude)
            target_lng = float(req.longitude)
            for w in existing_works:
                loc = w.get("location") or {}
                lat = loc.get("latitude")
                lng = loc.get("longitude")
                if _valid_coordinates(lat, lng):
                    dist = _haversine_distance_meters(target_lat, target_lng, float(lat), float(lng))
                    if dist <= 50.0:
                        warnings.append(
                            DuplicateWarning(
                                work_id=w["work_id"],
                                title=w.get("title", "Untitled"),
                                status=w.get("status", "recommended"),
                                distance_meters=round(dist, 1),
                                similarity_score=None,
                                warning_reason=f"Existing asset located within {dist:.1f}m (MPLADS proximity limit: 50m).",
                            )
                        )

        # 2. Textual title similarity check
        if req.title and req.title.strip():
            target_title = req.title.strip()
            for w in existing_works:
                ex_title = w.get("title", "")
                sim = _text_similarity(target_title, ex_title)
                if sim >= 0.70:
                    # Avoid duplicate warning for same work
                    if not any(warn.work_id == w["work_id"] for warn in warnings):
                        warnings.append(
                            DuplicateWarning(
                                work_id=w["work_id"],
                                title=ex_title,
                                status=w.get("status", "recommended"),
                                distance_meters=None,
                                similarity_score=round(sim, 2),
                                warning_reason=f"High textual similarity ({sim*100:.0f}%) with existing work.",
                            )
                        )

        return PreSubmissionDuplicateCheckResponse(
            has_potential_duplicate=len(warnings) > 0,
            warnings=warnings[:10],
        )

    async def get_mp_entitlement_summary(
        self,
        *,
        constituency: Optional[str] = None,
        mp_id: Optional[str] = None,
        mp_name: Optional[str] = None,
        state_code: Optional[str] = None,
    ) -> MPEntitlementSummaryResponse:
        """Calculate live ₹5.00 Cr Entitlement & Statutory Quota Telemetry for an MP."""
        query: dict[str, Any] = {}
        if constituency:
            query["constituency"] = {"$regex": f"^{re.escape(constituency.strip())}", "$options": "i"}
        elif mp_id:
            query["$or"] = [{"mp_id": mp_id}, {"recommended_by_mp_id": mp_id}]
        elif mp_name:
            query["mp_name"] = {"$regex": re.escape(mp_name.strip()), "$options": "i"}
        elif state_code:
            query["state_code"] = {"$regex": f"^{re.escape(state_code.strip())}$", "$options": "i"}

        cursor = self._collection.find(
            query,
            {
                "_id": 0,
                "work_id": 1,
                "title": 1,
                "status": 1,
                "sanctioned_amount": 1,
                "funds_released": 1,
                "actual_expenditure": 1,
                "sc_st_quota_type": 1,
                "category": 1,
            }
        )
        works = await cursor.to_list(length=2000)

        total_annual_entitlement = 50000000.0  # ₹5.00 Cr
        tranche_1 = 25000000.0
        tranche_2 = 25000000.0

        recommended_amount = 0.0
        sanctioned_amount = 0.0
        disbursed_amount = 0.0
        actual_expenditure = 0.0
        sc_committed = 0.0
        st_committed = 0.0
        works_count: dict[str, int] = {
            "total": len(works),
            "recommended": 0,
            "under_review": 0,
            "sanctioned": 0,
            "in_progress": 0,
            "on_hold": 0,
            "completed": 0,
            "cancelled": 0,
        }

        for w in works:
            status = w.get("status", "recommended")
            amt = float(w.get("sanctioned_amount") or 0.0)
            released = float(w.get("funds_released") or 0.0)
            exp = float(w.get("actual_expenditure") or 0.0)
            quota = (w.get("sc_st_quota_type") or "general").lower()

            if status in works_count:
                works_count[status] += 1

            if status in ("recommended", "under_review"):
                recommended_amount += amt
            elif status in ("sanctioned", "in_progress", "on_hold", "completed", "under_verification"):
                sanctioned_amount += amt
                disbursed_amount += released
                actual_expenditure += exp
                if quota == "sc":
                    sc_committed += amt
                elif quota == "st":
                    st_committed += amt

        total_committed = sanctioned_amount + recommended_amount
        available_balance = max(0.0, total_annual_entitlement - total_committed)
        utilization_pct = round(min(100.0, (sanctioned_amount / total_annual_entitlement) * 100), 2) if total_annual_entitlement > 0 else 0.0

        sc_target = 7500000.0  # 15%
        sc_pct = round(min(100.0, (sc_committed / sc_target) * 100), 2) if sc_target > 0 else 0.0

        st_target = 3750000.0  # 7.5%
        st_pct = round(min(100.0, (st_committed / st_target) * 100), 2) if st_target > 0 else 0.0

        return MPEntitlementSummaryResponse(
            total_annual_entitlement=total_annual_entitlement,
            tranche_1_allocation=tranche_1,
            tranche_2_allocation=tranche_2,
            recommended_amount=round(recommended_amount, 2),
            sanctioned_amount=round(sanctioned_amount, 2),
            disbursed_amount=round(disbursed_amount, 2),
            actual_expenditure=round(actual_expenditure, 2),
            total_committed=round(total_committed, 2),
            available_balance=round(available_balance, 2),
            utilization_pct=utilization_pct,
            sc_allocation_target=sc_target,
            sc_committed_amount=round(sc_committed, 2),
            sc_quota_achieved_pct=sc_pct,
            st_allocation_target=st_target,
            st_committed_amount=round(st_committed, 2),
            st_quota_achieved_pct=st_pct,
            works_count=works_count,
            mp_name=mp_name or "",
            constituency=constituency or "",
            state_code=state_code or "",
        )

    async def get_work_routing(
        self,
        work_id: str,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
    ) -> Optional[WorkRoutingResponse]:
        """Resolve full 5-tier stakeholder request routing and active custodian details."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            return None

        users_col = self._db.get_collection("users")
        cases_col = self._db.get_collection("cases")

        # 1. Resolve Originating MP
        mp_user = None
        if work.mp_id or work.recommended_by_mp_id:
            mp_user = await users_col.find_one(
                {"user_id": work.mp_id or work.recommended_by_mp_id},
                {"_id": 0, "hashed_password": 0}
            )
        if not mp_user and work.constituency:
            mp_user = await users_col.find_one(
                {"role": "mp", "jurisdiction.constituency": re.compile(f"^{re.escape(work.constituency)}$", re.IGNORECASE)},
                {"_id": 0, "hashed_password": 0}
            )
        if not mp_user and work.mp_name:
            mp_user = await users_col.find_one(
                {"role": "mp", "full_name": re.compile(re.escape(work.mp_name), re.IGNORECASE)},
                {"_id": 0, "hashed_password": 0}
            )

        if mp_user:
            mp_info = StakeholderInfo(
                role="mp",
                role_label="Member of Parliament (Lok Sabha)",
                name=mp_user.get("full_name") or work.mp_name or "Hon. MP",
                email=mp_user.get("email") or "mp@samarth.gov.in",
                user_id=mp_user.get("user_id"),
                jurisdiction=work.constituency or (mp_user.get("jurisdiction", {}) or {}).get("constituency", "Constituency"),
                status="active" if mp_user.get("is_active", True) else "inactive",
            )
        else:
            mp_info = StakeholderInfo(
                role="mp",
                role_label="Member of Parliament (Lok Sabha)",
                name=work.mp_name or "Hon. Member of Parliament",
                email=f"mp.{re.sub(r'[^a-zA-Z0-9]', '', (work.constituency or 'constituency')).lower()}@samarth.gov.in",
                jurisdiction=work.constituency or work.district_name or "Constituency",
                status="active",
            )

        # 2. Resolve District Authority
        da_query: dict[str, Any] = {"role": "district_authority"}
        if work.district_code:
            da_query["jurisdiction.district_code"] = re.compile(f"^{re.escape(work.district_code)}$", re.IGNORECASE)
        elif work.state_code:
            da_query["jurisdiction.state_code"] = re.compile(f"^{re.escape(work.state_code)}$", re.IGNORECASE)
        da_user = await users_col.find_one(da_query, {"_id": 0, "hashed_password": 0})

        if da_user:
            da_info = StakeholderInfo(
                role="district_authority",
                role_label="District Magistrate / Deputy Commissioner",
                name=da_user.get("full_name") or f"District Authority ({work.district_name or work.district_code})",
                email=da_user.get("email") or f"dm.{work.district_code.lower()}@samarth.gov.in",
                user_id=da_user.get("user_id"),
                jurisdiction=f"{work.district_name} ({work.district_code})" if work.district_name else work.district_code,
                status="active" if da_user.get("is_active", True) else "inactive",
            )
        else:
            da_info = StakeholderInfo(
                role="district_authority",
                role_label="District Magistrate / Deputy Commissioner",
                name=f"District Magistrate ({work.district_name or work.district_code or 'District'})",
                email=f"dm.{re.sub(r'[^a-zA-Z0-9]', '', (work.district_code or 'district')).lower()}@samarth.gov.in",
                jurisdiction=work.district_name or work.district_code or "District",
                status="active",
            )

        # 3. Resolve Implementing Agency
        agency_name = work.implementing_agency or "Public Works Department (PWD)"
        agency_query: dict[str, Any] = {"role": "agency"}
        if work.district_code:
            agency_query["jurisdiction.district_code"] = re.compile(f"^{re.escape(work.district_code)}$", re.IGNORECASE)
        agency_user = await users_col.find_one(agency_query, {"_id": 0, "hashed_password": 0})

        if agency_user:
            agency_info = StakeholderInfo(
                role="agency",
                role_label="Implementing / Executing Line Agency",
                name=agency_name or agency_user.get("full_name") or "Executing Line Agency",
                email=agency_user.get("email") or "agency@samarth.gov.in",
                user_id=agency_user.get("user_id"),
                jurisdiction=work.district_name or work.district_code,
                status="active" if agency_user.get("is_active", True) else "inactive",
            )
        else:
            agency_info = StakeholderInfo(
                role="agency",
                role_label="Implementing / Executing Line Agency",
                name=agency_name,
                email=f"agency.{re.sub(r'[^a-zA-Z0-9]', '', (work.district_code or 'execution')).lower()}@samarth.gov.in",
                jurisdiction=work.district_name or work.district_code or "Division",
                status="active",
            )

        # 4. Resolve Field Inspector
        insp_case = await cases_col.find_one({"work_id": work_id}, {"_id": 0})
        inspector_user = None
        if insp_case and insp_case.get("assigned_inspector_id"):
            inspector_user = await users_col.find_one(
                {"user_id": insp_case["assigned_inspector_id"]},
                {"_id": 0, "hashed_password": 0}
            )

        if not inspector_user and work.district_code:
            inspector_user = await users_col.find_one(
                {"role": "inspector", "jurisdiction.district_code": re.compile(f"^{re.escape(work.district_code)}$", re.IGNORECASE)},
                {"_id": 0, "hashed_password": 0}
            )

        if not inspector_user and work.state_code:
            inspector_user = await users_col.find_one(
                {"role": "inspector", "jurisdiction.state_code": re.compile(f"^{re.escape(work.state_code)}$", re.IGNORECASE)},
                {"_id": 0, "hashed_password": 0}
            )

        if inspector_user:
            inspector_info = StakeholderInfo(
                role="inspector",
                role_label="Field Technical Inspector",
                name=inspector_user.get("full_name") or "Field Technical Inspector",
                email=inspector_user.get("email") or "inspector@samarth.gov.in",
                user_id=inspector_user.get("user_id"),
                jurisdiction=work.district_name or work.district_code,
                status="active" if inspector_user.get("is_active", True) else "inactive",
            )
        else:
            inspector_info = StakeholderInfo(
                role="inspector",
                role_label="Field Technical Inspector",
                name=f"Field Inspection Division ({work.district_name or 'District'})",
                email=f"inspector.{re.sub(r'[^a-zA-Z0-9]', '', (work.district_code or 'field')).lower()}@samarth.gov.in",
                jurisdiction=work.district_name or work.district_code or "District",
                status="active",
            )

        # 5. Resolve State Nodal Officer
        sno_user = None
        if work.state_code:
            sno_user = await users_col.find_one(
                {"role": "state_nodal_officer", "jurisdiction.state_code": re.compile(f"^{re.escape(work.state_code)}$", re.IGNORECASE)},
                {"_id": 0, "hashed_password": 0}
            )

        if sno_user:
            sno_info = StakeholderInfo(
                role="state_nodal_officer",
                role_label="State Nodal Officer (Planning Dept)",
                name=sno_user.get("full_name") or f"State Nodal Officer ({work.state_name or work.state_code})",
                email=sno_user.get("email") or "sno@samarth.gov.in",
                user_id=sno_user.get("user_id"),
                jurisdiction=work.state_name or work.state_code,
                status="active",
            )
        else:
            sno_info = StakeholderInfo(
                role="state_nodal_officer",
                role_label="State Nodal Officer (Planning Dept)",
                name=f"State Nodal Officer ({work.state_name or work.state_code or 'State'})",
                email=f"sno.{re.sub(r'[^a-zA-Z0-9]', '', (work.state_code or 'state')).lower()}@samarth.gov.in",
                jurisdiction=work.state_name or work.state_code or "State",
                status="active",
            )

        # Determine Stages & Current Custodian
        status_val = work.status.value if hasattr(work.status, "value") else str(work.status)

        s1 = StageRoutingInfo(
            stage_id="mp_recommendation",
            stage_label="1. MP Project Recommendation",
            status="completed",
            active_custodian=mp_info,
            action_required="Constituency utility proposal submitted to District Authority.",
            action_ref=f"Work ID: {work.work_id}",
            completed_at=work.recommended_date or work.created_at,
            is_current_stage=False,
        )

        s2_status = "completed"
        s2_is_curr = False
        s2_action = f"Administrative Sanction accorded. AS Ref: {work.sanction_order_ref or 'AS-Approved'}."
        s2_sla = None

        if status_val in ("recommended", "under_review"):
            s2_status = "in_progress"
            s2_is_curr = True
            s2_action = "District Magistrate / Collectorate reviewing technical scrutiny & budget allocation."
            s2_sla = 45
        elif status_val == "cancelled" and work.rejection_reason:
            s2_status = "rejected"
            s2_action = f"Returned to Hon. MP: {work.rejection_reason}"

        s2 = StageRoutingInfo(
            stage_id="da_sanction",
            stage_label="2. District Authority Administrative Sanction (AS)",
            status=s2_status,
            active_custodian=da_info,
            action_required=s2_action,
            action_ref=work.sanction_order_ref,
            completed_at=work.sanctioned_date if s2_status == "completed" else None,
            sla_days_remaining=s2_sla,
            is_current_stage=s2_is_curr,
        )

        # Inspection & progress conditions
        has_insp_report = bool(insp_case and (insp_case.get("inspection_reports") or insp_case.get("status") in ("evidence_submitted", "resolved")))
        insp_dispatched = bool(insp_case and (insp_case.get("status") in ("inspection_assigned", "evidence_submitted", "resolved") or work.active_case_id))
        is_100_pct = bool(work.physical_progress_pct is not None and work.physical_progress_pct >= 100)

        # Stage 3: Implementing Agency Civil Execution
        s3_status = "pending"
        s3_is_curr = False
        s3_action = "Awaiting Administrative Sanction before work order issuance."
        s3_completed_at = None

        if s2_status == "completed":
            if (is_100_pct and insp_dispatched) or status_val in ("completed", "under_verification"):
                # Agency recorded 100% and field inspection request dispatched -> Step 3 is completed!
                s3_status = "completed"
                s3_is_curr = False
                s3_action = "Civil construction 100% completed and measurement books finalized. Dispatched for field quality inspection."
                s3_completed_at = work.actual_completion_date or (insp_case.get("created_at") if insp_case else None) or work.updated_at
            elif is_100_pct and not insp_dispatched:
                s3_status = "in_progress"
                s3_is_curr = True
                s3_action = "Civil progress recorded at 100%. Implementing Agency must dispatch field inspection request for geotagged verification."
            elif status_val in ("sanctioned", "in_progress", "on_hold"):
                s3_status = "in_progress"
                s3_is_curr = True
                s3_action = f"Physical progress at {work.physical_progress_pct or 0:.0f}%. Executing line agency recording milestones."

        s3 = StageRoutingInfo(
            stage_id="agency_execution",
            stage_label="3. Implementing Agency Civil Execution",
            status=s3_status,
            active_custodian=agency_info,
            action_required=s3_action,
            action_ref=work.implementing_agency,
            completed_at=s3_completed_at,
            is_current_stage=s3_is_curr,
        )

        # Stage 4: Field Inspection & Geotagged Verification
        s4_status = "pending"
        s4_is_curr = False
        s4_action = "On-site GPS geotagged photo inspection pending scheduling."
        s4_completed_at = None

        if s3_status == "completed" or (s2_status == "completed" and insp_dispatched):
            if has_insp_report:
                s4_status = "completed"
                s4_is_curr = False
                s4_action = "Geotagged physical evidence captured, verified, and reconciled."
                s4_completed_at = (insp_case.get("updated_at") if insp_case else None) or work.updated_at
            elif insp_dispatched:
                s4_status = "in_progress"
                s4_is_curr = True
                insp_ref = (insp_case.get("case_id") if insp_case else None) or work.active_case_id or "CASE-INSP"
                s4_action = f"Field inspection ({insp_ref}) assigned to {inspector_info.name}. On-site physical verification required."
            elif status_val in ("under_verification", "completed") or is_100_pct:
                s4_status = "in_progress"
                s4_is_curr = True
                s4_action = "Independent physical audit underway."

        # Mutually exclusive current stage: if s4 is active, s3 cannot be current
        if s4_is_curr:
            s3.is_current_stage = False

        s4 = StageRoutingInfo(
            stage_id="field_inspection",
            stage_label="4. Field Inspection & Geotagged Verification",
            status=s4_status,
            active_custodian=inspector_info,
            action_required=s4_action,
            action_ref=insp_case.get("case_id") if insp_case else work.active_case_id,
            completed_at=s4_completed_at,
            is_current_stage=s4_is_curr,
        )

        # Stage 5: SNO / MoSPI Audit & Closeout
        s5_status = "pending"
        s5_is_curr = False
        s5_action = "Final Utilization Certificate (UC) and audit reconciliation pending completion."
        if status_val == "completed" and s4_status == "completed":
            s5_status = "completed"
            s5_action = "Full statutory compliance verified. Project reconciled in eSAKSHI portal."
        elif s4_status == "completed":
            s5_status = "in_progress"
            s5_is_curr = True
            s5_action = "Reviewing expenditure vouchers and final UC submission."

        s5 = StageRoutingInfo(
            stage_id="audit_completion",
            stage_label="5. SNO / MoSPI Audit & Closeout",
            status=s5_status,
            active_custodian=sno_info,
            action_required=s5_action,
            is_current_stage=s5_is_curr,
        )

        stages = [s1, s2, s3, s4, s5]
        current_stage = next((s for s in stages if s.is_current_stage), None)
        if not current_stage:
            current_stage = s2 if s2.status != "completed" else (s3 if s3.status != "completed" else (s4 if s4.status != "completed" else s5))

        return WorkRoutingResponse(
            work_id=work.work_id,
            work_title=work.title,
            current_status=work.status,
            category=work.category,
            sanctioned_amount=work.sanctioned_amount,
            district_code=work.district_code,
            district_name=work.district_name,
            state_code=work.state_code,
            constituency=work.constituency,
            originating_mp=mp_info,
            district_authority=da_info,
            implementing_agency=agency_info,
            assigned_inspector=inspector_info,
            state_nodal_officer=sno_info,
            current_custodian=current_stage.active_custodian,
            current_stage_id=current_stage.stage_id,
            current_action_required=current_stage.action_required,
            stages=stages,
        )

    async def dispatch_work_inspection(
        self,
        work_id: str,
        data: DirectInspectionDispatchRequest,
        *,
        actor_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
        jurisdiction_filter: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Dispatch a field inspector directly to a work site."""
        work = await self.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
        if not work:
            raise ValueError("Work not found in your jurisdiction")

        users_col = self._db.get_collection("users")
        cases_col = self._db.get_collection("cases")

        inspector_user = None
        if data.inspector_user_id:
            inspector_user = await users_col.find_one({"user_id": data.inspector_user_id, "role": "inspector", "is_active": True})
        if not inspector_user and work.district_code:
            inspector_user = await users_col.find_one({"role": "inspector", "jurisdiction.district_code": re.compile(f"^{re.escape(work.district_code)}$", re.IGNORECASE), "is_active": True})
        if not inspector_user and work.state_code:
            inspector_user = await users_col.find_one({"role": "inspector", "jurisdiction.state_code": re.compile(f"^{re.escape(work.state_code)}$", re.IGNORECASE), "is_active": True})
        if not inspector_user:
            inspector_user = await users_col.find_one({"role": "inspector", "is_active": True})

        if not inspector_user:
            raise ValueError("No active field inspector available in this jurisdiction to dispatch.")

        case_id = f"CASE-INSP-{uuid4().hex[:8].upper()}"
        now = datetime.now(timezone.utc)

        # Update inspector's assigned_task_ids
        j = dict(inspector_user.get("jurisdiction") or {})
        tasks = list(j.get("assigned_task_ids") or [])
        if case_id not in tasks:
            tasks.append(case_id)
            j["assigned_task_ids"] = tasks
            await users_col.update_one({"user_id": inspector_user["user_id"]}, {"$set": {"jurisdiction": j, "updated_at": now}})

        case_doc = {
            "case_id": case_id,
            "work_id": work_id,
            "source_type": "manual",
            "title": f"Field Inspection: {work.title[:50]}",
            "description": data.instructions,
            "status": "inspection_assigned",
            "severity": "high" if data.priority in ("urgent", "critical") else "medium",
            "owner_user_id": actor_user_id,
            "assigned_inspector_id": inspector_user["user_id"],
            "state_code": work.state_code,
            "district_code": work.district_code,
            "created_by": actor_user_id,
            "created_at": now,
            "updated_at": now,
            "events": [
                {
                    "event_id": str(uuid4()),
                    "event_type": "inspection_assigned",
                    "actor_user_id": actor_user_id,
                    "reason": data.instructions,
                    "details": {"inspector_user_id": inspector_user["user_id"], "milestone_stage": data.milestone_stage},
                    "created_at": now,
                }
            ],
        }
        await cases_col.insert_one(case_doc)

        timeline_event = TimelineEvent(
            event_id=str(uuid4()),
            timestamp=now,
            event_type="inspection_dispatched",
            title="Field Inspection Dispatched",
            description=f"Field inspector {inspector_user.get('full_name')} ({inspector_user.get('email')}) assigned for on-site verification (Case Ref: {case_id}). Milestone: {data.milestone_stage}.",
            actor=actor_user_id,
        )

        update_dict: dict[str, Any] = {"active_case_id": case_id, "updated_at": now}
        if (work.physical_progress_pct is not None and work.physical_progress_pct >= 100) and work.status not in (WorkStatus.COMPLETED, WorkStatus.CANCELLED):
            update_dict["status"] = WorkStatus.UNDER_VERIFICATION.value
            if not work.actual_completion_date:
                update_dict["actual_completion_date"] = now
        await self._collection.update_one(
            {"work_id": work_id},
            {"$set": update_dict, "$push": {"timeline": timeline_event.model_dump()}}
        )

        await self._audit.log_event(
            AuditEventType.INSPECTION_ASSIGNED,
            user_id=actor_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="work",
            resource_id=work_id,
            details={"case_id": case_id, "inspector_user_id": inspector_user["user_id"]},
        )

        try:
            notif_svc = NotificationService(self._db)
            await notif_svc.create_event(
                recipient_user_id=inspector_user["user_id"],
                event_type=NotificationEventType.INSPECTOR_ASSIGNED,
                resource_type="case",
                resource_id=case_id,
                idempotency_key=f"insp_disp_{case_id}",
                title=f"Site Inspection Dispatched: {work.title[:40]}",
                message=f"You have been assigned for physical site verification in {work.district_name or work.district_code}. Instructions: {data.instructions}",
            )
        except Exception as e:
            logger.warning("Failed to notify inspector %s: %s", inspector_user["user_id"], e)

        return {
            "case_id": case_id,
            "work_id": work_id,
            "inspector_user_id": inspector_user["user_id"],
            "inspector_name": inspector_user.get("full_name"),
            "inspector_email": inspector_user.get("email"),
            "status": "inspection_assigned",
            "message": f"Inspection successfully dispatched to {inspector_user.get('full_name')} ({inspector_user.get('email')}). Case ID: {case_id}.",
        }


def _valid_coordinates(latitude: Any, longitude: Any) -> bool:
    """Return true only for finite WGS84 latitude/longitude coordinate pairs."""
    try:
        lat, lng = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180


def _haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on the earth in meters."""
    r = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def _text_similarity(str1: str, str2: str) -> float:
    """Calculate token overlap Jaccard similarity between two strings."""
    words1 = set(re.findall(r"\w+", (str1 or "").lower()))
    words2 = set(re.findall(r"\w+", (str2 or "").lower()))
    if not words1 or not words2:
        return 0.0
    return len(words1 & words2) / float(len(words1 | words2))
