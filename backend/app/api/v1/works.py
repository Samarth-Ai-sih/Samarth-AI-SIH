"""
SAMARTH AI — Works API (MPLADS Work Lifecycle)

Routes:
  GET    /api/v1/works                      List works (filtered, paginated, sorted, searched)
  GET    /api/v1/works/map                  List filtered, scoped stored work markers
  POST   /api/v1/works                      Create a new work
  GET    /api/v1/works/{work_id}            Get work detail
  GET    /api/v1/works/{work_id}/360        Get Work 360° view
  PATCH  /api/v1/works/{work_id}            Update work fields
  PATCH  /api/v1/works/{work_id}/status     Update work status
  DELETE /api/v1/works/{work_id}            Soft-delete (cancel) work
  GET    /api/v1/works/{work_id}/timeline   Get work timeline
  POST   /api/v1/works/{work_id}/payments   Add payment tranche
  GET    /api/v1/works/{work_id}/payments   List payment tranches
  POST   /api/v1/works/{work_id}/progress   Add progress update
  GET    /api/v1/works/{work_id}/progress   List progress updates

All endpoints require authentication.
Read endpoints require READ_WORKS or READ_PAYMENTS permission.
Write endpoints require WRITE_WORKS or WRITE_PAYMENTS permission.
Jurisdiction filtering is applied automatically on list queries.
"""

import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import Database, get_database
from app.core.dependencies import (
    get_current_user,
    get_jurisdiction_filter,
    require_permissions,
)
from app.core.rate_limit import get_client_ip
from app.core.permissions import Permission, check_jurisdiction, has_permission
from app.models.user import UserInDB, UserRole
from app.models.work import (
    DirectInspectionDispatchRequest,
    DuplicateWarning,
    MapWorkMarkerResponse,
    MPEntitlementSummaryResponse,
    PaymentTrancheCreateRequest,
    PaymentTrancheResponse,
    PreSubmissionDuplicateCheckRequest,
    PreSubmissionDuplicateCheckResponse,
    ProgressUpdateCreateRequest,
    ProgressUpdateResponse,
    TimelineEventResponse,
    WorkCategory,
    WorkCreateRequest,
    WorkDetailResponse,
    WorkListResponse,
    WorkMapResponse,
    WorkRejectRecommendationRequest,
    WorkRoutingResponse,
    WorkSanctionRequest,
    WorkStatus,
    WorkStatusUpdateRequest,
    WorkSummaryResponse,
    WorkUpdateRequest,
)
from app.services.work_service import WorkService

logger = logging.getLogger("samarth.api.works")

router = APIRouter(prefix="/api/v1/works", tags=["Works"])


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


async def _assert_update_stays_in_scope(
    service: WorkService,
    work_id: str,
    body: WorkUpdateRequest,
    user: UserInDB,
    jurisdiction_filter: dict,
) -> None:
    """Prevent a scoped user from moving a work into another jurisdiction."""
    changes = body.model_dump(exclude_unset=True)
    location_fields = {"state_code", "district_code", "constituency"}
    if not location_fields.intersection(changes):
        return
    current = await service.get_work(work_id, jurisdiction_filter=jurisdiction_filter)
    if not current:
        raise HTTPException(status_code=404, detail="Work not found")
    if not check_jurisdiction(
        user.role,
        user.jurisdiction,
        resource_state=changes.get("state_code", current.state_code),
        resource_district=changes.get("district_code", current.district_code),
        resource_constituency=changes.get("constituency", current.constituency),
    ):
        raise HTTPException(status_code=403, detail="Access denied: jurisdiction mismatch")


# ── List Works ───────────────────────────────────────────────────


@router.get(
    "",
    response_model=WorkListResponse,
    summary="List works",
    description="List MPLADS works with filters, search, sorting, and pagination. "
                "Results are scoped by the caller's jurisdiction.",
)
async def list_works(
    request: Request,
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    status: WorkStatus | None = Query(default=None, description="Filter by status"),
    category: WorkCategory | None = Query(default=None, description="Filter by category"),
    state_code: Optional[str] = Query(default=None, min_length=1, max_length=32, description="Filter by state code"),
    district_code: Optional[str] = Query(default=None, min_length=1, max_length=32, description="Filter by district code"),
    constituency: Optional[str] = Query(default=None, min_length=1, max_length=120, description="Filter by constituency"),
    risk_tier: Literal["green", "amber", "red"] | None = Query(default=None, description="Filter by current stored risk tier"),
    search: Optional[str] = Query(default=None, min_length=1, max_length=150, description="Text search"),
    sort_by: Literal["created_at", "updated_at", "title", "status", "sanctioned_amount", "funds_released", "physical_progress_pct", "state_name", "mp_name", "recommended_date"] = Query(default="created_at", description="Allow-listed sort field"),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort order"),
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    order = -1 if sort_order.lower() == "desc" else 1

    works, total, total_pages = await svc.list_works(
        jurisdiction_filter=jfilter,
        status=status.value if status else None,
        category=category.value if category else None,
        risk_tier=risk_tier,
        state_code=state_code,
        district_code=district_code,
        constituency=constituency,
        search=search,
        sort_by=sort_by,
        sort_order=order,
        page=page,
        page_size=page_size,
    )
    return WorkListResponse(
        works=[WorkSummaryResponse(**w) for w in works],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/map",
    response_model=WorkMapResponse,
    summary="List jurisdiction-scoped work markers",
    description=(
        "Returns a bounded page of stored work locations. Results use the same "
        "server-enforced jurisdiction filters as the work register. Only valid "
        "GeoJSON points are returned; no address is geocoded by this endpoint."
    ),
)
async def list_work_map(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    status: WorkStatus | None = Query(default=None),
    category: WorkCategory | None = Query(default=None),
    risk_tier: Literal["green", "amber", "red"] | None = Query(default=None),
    state_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    district_code: Optional[str] = Query(default=None, min_length=1, max_length=32),
    constituency: Optional[str] = Query(default=None, min_length=1, max_length=120),
    work_id: Optional[str] = Query(default=None, min_length=1, max_length=120),
    search: Optional[str] = Query(default=None, min_length=1, max_length=150),
    updated_from: Optional[datetime] = Query(default=None),
    updated_to: Optional[datetime] = Query(default=None),
    min_longitude: Optional[float] = Query(default=None, ge=-180, le=180),
    min_latitude: Optional[float] = Query(default=None, ge=-90, le=90),
    max_longitude: Optional[float] = Query(default=None, ge=-180, le=180),
    max_latitude: Optional[float] = Query(default=None, ge=-90, le=90),
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    bounds_values = (min_longitude, min_latitude, max_longitude, max_latitude)
    if any(value is not None for value in bounds_values) and any(value is None for value in bounds_values):
        raise HTTPException(status_code=422, detail="All four bounding-box coordinates are required")
    bounding_box = None
    if all(value is not None for value in bounds_values):
        bounding_box = (float(min_longitude), float(min_latitude), float(max_longitude), float(max_latitude))
        if bounding_box[0] >= bounding_box[2] or bounding_box[1] >= bounding_box[3]:
            raise HTTPException(status_code=422, detail="Bounding-box minimum values must be less than maximum values")
    if updated_from and updated_to and updated_from > updated_to:
        raise HTTPException(status_code=422, detail="updated_from must not be after updated_to")

    service = WorkService(db)
    effective_filter = jfilter
    if user.role == UserRole.INSPECTOR:
        assigned_work_ids = await service.assigned_inspector_work_ids(
            inspector_user_id=user.user_id,
            assigned_task_ids=user.jurisdiction.assigned_task_ids,
        )
        # Inspectors are scoped to persisted cases assigned to them. Case IDs
        # are not accepted as a client-controlled work-location filter.
        effective_filter = {"work_id": {"$in": sorted(assigned_work_ids)}} if assigned_work_ids else {"_id": None}

    markers, total, coordinate_count, total_pages, without_coordinates = await service.list_map_works(
        jurisdiction_filter=effective_filter,
        status=status.value if status else None,
        category=category.value if category else None,
        risk_tier=risk_tier,
        state_code=state_code,
        district_code=district_code,
        constituency=constituency,
        work_id=work_id,
        search=search,
        updated_from=updated_from,
        updated_to=updated_to,
        bounding_box=bounding_box,
        page=page,
        page_size=page_size,
    )
    can_read_financials = has_permission(user.role, Permission.READ_PAYMENTS)
    can_read_risk = has_permission(user.role, Permission.READ_RISK)
    response_markers = []
    for marker in markers:
        response_markers.append(MapWorkMarkerResponse(
            work_id=marker["work_id"], title=marker.get("title", "Untitled work"),
            status=marker.get("status", WorkStatus.RECOMMENDED.value),
            category=marker.get("category", WorkCategory.OTHER.value),
            state_code=marker.get("state_code", ""), state_name=marker.get("state_name", ""),
            district_code=marker.get("district_code", ""), district_name=marker.get("district_name", ""),
            constituency=marker.get("constituency", ""), mp_name=marker.get("mp_name", ""),
            implementing_agency=marker.get("implementing_agency", ""),
            physical_progress_pct=marker.get("physical_progress_pct", 0),
            location=marker.get("location", {}),
            last_updated_at=marker.get("updated_at") or marker.get("created_at"),
            sanctioned_amount=marker.get("sanctioned_amount") if can_read_financials else None,
            funds_released=marker.get("funds_released") if can_read_financials else None,
            actual_expenditure=marker.get("actual_expenditure") if can_read_financials else None,
            composite_risk_score=marker.get("composite_risk_score") if can_read_risk else None,
            risk_tier=marker.get("risk_tier") if can_read_risk else None,
        ))
    return WorkMapResponse(
        markers=response_markers,
        total_matching_works=total,
        works_with_valid_coordinates=coordinate_count,
        works_without_valid_coordinates=without_coordinates,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        bounding_box_applied=bounding_box is not None,
    )

# ── Create Work ──────────────────────────────────────────────────


@router.post(
    "",
    response_model=WorkSummaryResponse,
    status_code=201,
    summary="Create a new work",
    description="Create a new MPLADS work. Requires WRITE_WORKS permission.",
)
async def create_work(
    request: Request,
    body: WorkCreateRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    db: Database = Depends(get_database),
):
    if not check_jurisdiction(
        user.role,
        user.jurisdiction,
        resource_state=body.state_code,
        resource_district=body.district_code,
        resource_constituency=body.constituency,
    ):
        raise HTTPException(status_code=403, detail="Access denied: jurisdiction mismatch")
    svc = WorkService(db)
    work = await svc.create_work(
        body,
        created_by_user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    return WorkSummaryResponse(
        work_id=work.work_id,
        title=work.title,
        status=work.status,
        category=work.category,
        state_name=work.state_name,
        district_name=work.district_name,
        constituency=work.constituency,
        pincode=work.pincode,
        mp_name=work.mp_name,
        implementing_agency=work.implementing_agency,
        sanctioned_amount=work.sanctioned_amount,
        funds_released=work.funds_released,
        actual_expenditure=work.actual_expenditure,
        physical_progress_pct=work.physical_progress_pct,
        composite_risk_score=work.composite_risk_score,
        risk_tier=work.risk_tier,
        recommended_date=work.recommended_date,
        sanctioned_date=work.sanctioned_date,
        expected_completion_date=work.expected_completion_date,
        created_at=work.created_at,
    )


# ── Pre-Submission Duplicate Check ───────────────────────────────


@router.post(
    "/check-duplicate",
    response_model=PreSubmissionDuplicateCheckResponse,
    summary="Check for spatial/title duplicate works before submission",
    description="Validates that a proposed work does not violate the 50m spatial proximity rule or duplicate existing works.",
)
async def check_duplicate_work(
    body: PreSubmissionDuplicateCheckRequest,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    if not body.state_code and user.jurisdiction.state_code:
        body.state_code = user.jurisdiction.state_code
    if not body.constituency and user.jurisdiction.constituency:
        body.constituency = user.jurisdiction.constituency
    return await svc.check_pre_submission_duplicate(body)


# ── MP Entitlement & Quota Telemetry ─────────────────────────────


@router.get(
    "/mp/entitlement-summary",
    response_model=MPEntitlementSummaryResponse,
    summary="MPLADS ₹5.00 Cr Entitlement & Quota Telemetry",
    description="Returns ₹5.00 Cr annual entitlement progress, SC (15%) and ST (7.5%) statutory quota meters, and committed balances.",
)
async def get_mp_entitlement(
    constituency: Optional[str] = Query(default=None, description="Optional constituency override for admins"),
    state_code: Optional[str] = Query(default=None, description="Optional state code override"),
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    target_constituency = constituency or user.jurisdiction.constituency
    target_state = state_code or user.jurisdiction.state_code
    target_mp_id = user.user_id if user.role == UserRole.MP else None
    target_mp_name = user.full_name if user.role == UserRole.MP else None

    return await svc.get_mp_entitlement_summary(
        constituency=target_constituency,
        mp_id=target_mp_id,
        mp_name=target_mp_name,
        state_code=target_state,
    )


# ── Get Work Detail ──────────────────────────────────────────────


@router.get(
    "/{work_id}",
    response_model=WorkDetailResponse,
    summary="Get work detail",
    description="Get full details of a specific work.",
)
async def get_work(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    work = await svc.get_work(work_id, jurisdiction_filter=jfilter)
    if not work:
        raise HTTPException(status_code=404, detail="Work not found")
    return WorkDetailResponse(**work.model_dump())


# ── Get Work 360° View ───────────────────────────────────────────


@router.get(
    "/{work_id}/360",
    response_model=WorkDetailResponse,
    summary="Get Work 360° view",
    description="Full 360° view of a work including all financials, "
                "timeline, payment tranches, and progress updates.",
)
async def get_work_360(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    data = await svc.get_work_360(work_id, jurisdiction_filter=jfilter)
    if not data:
        raise HTTPException(status_code=404, detail="Work not found")
    return WorkDetailResponse(**data)


# ── Update Work ──────────────────────────────────────────────────


@router.patch(
    "/{work_id}",
    response_model=WorkDetailResponse,
    summary="Update work fields",
    description="Partially update work details. Requires WRITE_WORKS permission.",
)
async def update_work(
    work_id: str,
    request: Request,
    body: WorkUpdateRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    await _assert_update_stays_in_scope(svc, work_id, body, user, jfilter)
    work = await svc.update_work(
        work_id,
        body,
        updated_by_user_id=user.user_id,
        jurisdiction_filter=jfilter,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not work:
        raise HTTPException(status_code=404, detail="Work not found")
    return WorkDetailResponse(**work.model_dump())


# ── Update Status ────────────────────────────────────────────────


@router.patch(
    "/{work_id}/status",
    response_model=WorkDetailResponse,
    summary="Update work status",
    description="Transition the work to a new lifecycle status.",
)
async def update_work_status(
    work_id: str,
    request: Request,
    body: WorkStatusUpdateRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    try:
        work = await svc.update_status(
            work_id,
            body,
            updated_by_user_id=user.user_id,
            jurisdiction_filter=jfilter,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not work:
        raise HTTPException(status_code=404, detail="Work not found")
    return WorkDetailResponse(**work.model_dump())


# ── MP Recommendation Sanction / Rejection ───────────────────────


@router.post(
    "/{work_id}/sanction",
    response_model=WorkDetailResponse,
    summary="Grant Administrative Sanction to MP Recommendation",
    description="District Authority accords statutory Administrative Sanction (AS) to an MP-recommended project.",
)
async def sanction_work(
    work_id: str,
    request: Request,
    body: WorkSanctionRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    if user.role not in (UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN, UserRole.MOSPI):
        raise HTTPException(
            status_code=403,
            detail="Under MPLADS statutory guidelines, only District Authorities (Collector/DM) or Administrators can accord Administrative Sanction.",
        )
    svc = WorkService(db)
    try:
        work = await svc.sanction_work(
            work_id,
            body,
            user_id=user.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            jurisdiction_filter=jfilter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not work:
        raise HTTPException(status_code=404, detail="Work not found or outside your jurisdiction.")
    return WorkDetailResponse(**work.model_dump())


@router.post(
    "/{work_id}/reject-recommendation",
    response_model=WorkDetailResponse,
    summary="Reject or return MP recommendation",
    description="District Authority returns or rejects an MP recommendation with statutory rationale.",
)
async def reject_recommendation(
    work_id: str,
    request: Request,
    body: WorkRejectRecommendationRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    if user.role not in (UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN, UserRole.MOSPI):
        raise HTTPException(
            status_code=403,
            detail="Under MPLADS statutory guidelines, only District Authorities or Administrators can return/reject project recommendations.",
        )
    svc = WorkService(db)
    try:
        work = await svc.reject_recommendation(
            work_id,
            body,
            user_id=user.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            jurisdiction_filter=jfilter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not work:
        raise HTTPException(status_code=404, detail="Work not found or outside your jurisdiction.")
    return WorkDetailResponse(**work.model_dump())


# ── Work Governance & Request Routing ────────────────────────────


@router.get(
    "/{work_id}/routing",
    response_model=WorkRoutingResponse,
    summary="Get Multi-Stakeholder Request Routing & Custodian Chain",
    description="Resolves originating MP, District Authority, Implementing Agency, Field Inspector, and SNO with active custodian ballot and SLA tracking.",
)
async def get_work_routing(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    routing = await svc.get_work_routing(work_id, jurisdiction_filter=jfilter)
    if not routing:
        raise HTTPException(status_code=404, detail="Work not found or outside your jurisdiction.")
    return routing


@router.post(
    "/{work_id}/dispatch-inspection",
    summary="Dispatch Field Inspection to Technical Inspector",
    description="District Authority or Agency dispatches an on-site geotagged inspection task.",
)
async def dispatch_work_inspection(
    work_id: str,
    body: DirectInspectionDispatchRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    if user.role not in (UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN, UserRole.MOSPI, UserRole.AGENCY):
        raise HTTPException(
            status_code=403,
            detail="Only District Authorities, Administrators, or Implementing Agencies can dispatch field inspections.",
        )
    svc = WorkService(db)
    try:
        result = await svc.dispatch_work_inspection(
            work_id,
            body,
            actor_user_id=user.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            jurisdiction_filter=jfilter,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ── Delete (Soft) Work ───────────────────────────────────────────


@router.delete(
    "/{work_id}",
    status_code=204,
    summary="Delete (cancel) work",
    description="Soft-delete a work by setting its status to cancelled.",
)
async def delete_work(
    work_id: str,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    deleted = await svc.delete_work(
        work_id,
        deleted_by_user_id=user.user_id,
        jurisdiction_filter=jfilter,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Work not found")


# ── Timeline ─────────────────────────────────────────────────────


@router.get(
    "/{work_id}/timeline",
    response_model=list[TimelineEventResponse],
    summary="Get work timeline",
    description="Returns the full lifecycle timeline for a work.",
)
async def get_work_timeline(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    events = await svc.get_timeline(work_id, jurisdiction_filter=jfilter)
    if events is None:
        raise HTTPException(status_code=404, detail="Work not found")
    return [TimelineEventResponse(**e) for e in events]


# ── Payment Tranches ─────────────────────────────────────────────


@router.post(
    "/{work_id}/payments",
    response_model=WorkDetailResponse,
    status_code=201,
    summary="Add payment tranche",
    description="Add a new payment tranche to a work. Requires WRITE_PAYMENTS permission.",
)
async def add_payment_tranche(
    work_id: str,
    request: Request,
    body: PaymentTrancheCreateRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_PAYMENTS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    work = await svc.add_payment_tranche(
        work_id,
        body,
        added_by_user_id=user.user_id,
        jurisdiction_filter=jfilter,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not work:
        raise HTTPException(status_code=404, detail="Work not found")
    return WorkDetailResponse(**work.model_dump())


@router.get(
    "/{work_id}/payments",
    response_model=list[PaymentTrancheResponse],
    summary="List payment tranches",
    description="Returns all payment tranches for a work.",
)
async def get_payment_tranches(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_PAYMENTS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    tranches = await svc.get_payment_tranches(work_id, jurisdiction_filter=jfilter)
    if tranches is None:
        raise HTTPException(status_code=404, detail="Work not found")
    return [PaymentTrancheResponse(**t) for t in tranches]


# ── Progress Updates ─────────────────────────────────────────────


@router.post(
    "/{work_id}/progress",
    response_model=WorkDetailResponse,
    status_code=201,
    summary="Add progress update",
    description="Add a progress update to a work. Requires WRITE_WORKS permission.",
)
async def add_progress_update(
    work_id: str,
    request: Request,
    body: ProgressUpdateCreateRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    work = await svc.add_progress_update(
        work_id,
        body,
        added_by_user_id=user.user_id,
        jurisdiction_filter=jfilter,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not work:
        raise HTTPException(status_code=404, detail="Work not found")
    return WorkDetailResponse(**work.model_dump())


@router.get(
    "/{work_id}/progress",
    response_model=list[ProgressUpdateResponse],
    summary="List progress updates",
    description="Returns all progress updates for a work.",
)
async def get_progress_updates(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = WorkService(db)
    updates = await svc.get_progress_updates(work_id, jurisdiction_filter=jfilter)
    if updates is None:
        raise HTTPException(status_code=404, detail="Work not found")
    return [ProgressUpdateResponse(**u) for u in updates]
