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
from app.models.work import (
    PaymentTranche,
    PaymentTrancheCreateRequest,
    ProgressUpdate,
    ProgressUpdateCreateRequest,
    TimelineEvent,
    WorkCreateRequest,
    WorkInDB,
    WorkLocation,
    WorkStatus,
    WorkStatusUpdateRequest,
    WorkUpdateRequest,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.works")

COLLECTION = "works"

# Deliberate work-lifecycle state machine. Terminal cancellation cannot be
# silently reversed; reopening requires a new, explicitly audited work record.
ALLOWED_STATUS_TRANSITIONS: dict[WorkStatus, set[WorkStatus]] = {
    WorkStatus.RECOMMENDED: {WorkStatus.UNDER_REVIEW, WorkStatus.CANCELLED},
    WorkStatus.UNDER_REVIEW: {WorkStatus.RECOMMENDED, WorkStatus.SANCTIONED, WorkStatus.CANCELLED},
    WorkStatus.SANCTIONED: {WorkStatus.IN_PROGRESS, WorkStatus.ON_HOLD, WorkStatus.CANCELLED},
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
            },
        )

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

        result = await self._collection.update_one(
            self._work_query(work_id, jurisdiction_filter),
            {
                "$push": {
                    "progress_updates": update.model_dump(),
                    "timeline": timeline_event.model_dump(),
                },
                "$set": {
                    "physical_progress_pct": data.physical_progress_pct,
                    "updated_at": now,
                },
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


def _valid_coordinates(latitude: Any, longitude: Any) -> bool:
    """Return true only for finite WGS84 latitude/longitude coordinate pairs."""
    try:
        lat, lng = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180
