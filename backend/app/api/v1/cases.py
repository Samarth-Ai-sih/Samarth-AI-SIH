"""Phase 13 case management and field-inspection APIs."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_role
from app.core.rate_limit import get_client_ip
from app.models.case_management import (
    CaseAssignee,
    CaseAssignmentRequest,
    CaseCommentRequest,
    CaseCorrectivePlanRequest,
    CaseCreateRequest,
    CaseDueDateRequest,
    CaseListResponse,
    CaseOverrideRequest,
    CaseReasonRequest,
    CaseResponse,
    CaseSeverity,
    CaseSeverityRequest,
    CaseStatus,
    InspectionReportCreateRequest,
    InspectionSubmissionResponse,
    InspectionTaskResponse,
    NotificationListResponse,
)
from app.models.user import UserInDB, UserRole
from app.services.case_management_service import CaseManagementService

router = APIRouter(prefix="/api/v1/cases", tags=["Case Management & Field Inspection"])

manager_dep = require_role(UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN)
manager_read_dep = require_role(
    UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN, UserRole.MOSPI, UserRole.STATE_NODAL_OFFICER,
)
inspector_dep = require_role(UserRole.INSPECTOR)


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


def _context(request: Request) -> dict[str, str]:
    return {"ip_address": _get_ip(request), "user_agent": request.headers.get("user-agent", "")}


async def _manager_case_or_404(
    service: CaseManagementService,
    case_id: str,
    jurisdiction_filter: dict,
    user: Optional[UserInDB] = None,
) -> CaseResponse:
    case = await service.get_case_for_manager(case_id, jurisdiction_filter=jurisdiction_filter, user=user)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found in your jurisdiction")
    return case


@router.post("", response_model=CaseResponse, status_code=201, summary="Create a case for a scoped work")
async def create_case(
    body: CaseCreateRequest,
    request: Request,
    user: UserInDB = Depends(manager_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    case = await CaseManagementService(db).create_case(
        body, created_by=user.user_id, jurisdiction_filter=jurisdiction_filter, **_context(request),
    )
    if not case:
        raise HTTPException(status_code=404, detail="Work not found in your jurisdiction")
    return case


@router.get("", response_model=CaseListResponse, summary="List cases in the caller's jurisdiction")
async def list_cases(
    status: Optional[CaseStatus] = Query(default=None),
    severity: Optional[CaseSeverity] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: UserInDB = Depends(manager_read_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    cases, total, total_pages = await CaseManagementService(db).list_cases(
        jurisdiction_filter=jurisdiction_filter, status=status, severity=severity, page=page, page_size=page_size,
        current_user=user,
    )
    return CaseListResponse(cases=cases, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/notifications", response_model=NotificationListResponse, summary="List the District Authority's inspection notifications")
async def list_notifications(
    user: UserInDB = Depends(manager_dep),
    db: Database = Depends(get_database),
):
    notifications = await CaseManagementService(db).list_notifications(recipient_user_id=user.user_id)
    return NotificationListResponse(notifications=notifications, total=len(notifications))


@router.get("/assigned", response_model=CaseListResponse, summary="List inspection tasks assigned to the current inspector")
async def list_assigned_inspections(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: UserInDB = Depends(inspector_dep),
    db: Database = Depends(get_database),
):
    cases, total, total_pages = await CaseManagementService(db).list_assigned_cases(
        inspector_user_id=user.user_id, assigned_task_ids=user.jurisdiction.assigned_task_ids,
        page=page, page_size=page_size,
    )
    return CaseListResponse(cases=cases, total=total, page=page, page_size=page_size, total_pages=total_pages)


@router.get("/assigned/{case_id}/task", response_model=InspectionTaskResponse, summary="Get a private assigned inspection task and work details")
async def get_assigned_inspection_task(
    case_id: str,
    user: UserInDB = Depends(inspector_dep),
    db: Database = Depends(get_database),
):
    task = await CaseManagementService(db).get_inspection_task(
        case_id, inspector_user_id=user.user_id, assigned_task_ids=user.jurisdiction.assigned_task_ids,
    )
    if not task:
        raise HTTPException(status_code=404, detail="Assigned inspection task not found")
    return task


@router.get("/assigned/{case_id}/route", summary="Compute B-Tree shortest path route from inspector position to site coordinates")
async def get_assigned_inspection_route(
    case_id: str,
    start_lat: Optional[float] = Query(default=None),
    start_lng: Optional[float] = Query(default=None),
    user: UserInDB = Depends(inspector_dep),
    db: Database = Depends(get_database),
):
    task = await CaseManagementService(db).get_inspection_task(
        case_id, inspector_user_id=user.user_id, assigned_task_ids=user.jurisdiction.assigned_task_ids,
    )
    if not task:
        raise HTTPException(status_code=404, detail="Assigned inspection task not found")

    from app.services.routing_service import RoutingService

    site_lat = task.work.location_latitude if task.work.location_latitude is not None else 26.8467
    site_lng = task.work.location_longitude if task.work.location_longitude is not None else 80.9462
    s_lat = start_lat if start_lat is not None else 26.8530
    s_lng = start_lng if start_lng is not None else 80.9420

    routing = RoutingService()
    return routing.calculate_route(
        start_lat=s_lat,
        start_lng=s_lng,
        target_lat=site_lat,
        target_lng=site_lng,
        work_title=task.work.title,
    )


@router.post("/assigned/{case_id}/report", response_model=InspectionSubmissionResponse, status_code=201, summary="Submit an assigned field inspection report")
async def submit_assigned_inspection_report(
    case_id: str,
    body: InspectionReportCreateRequest,
    request: Request,
    user: UserInDB = Depends(inspector_dep),
    db: Database = Depends(get_database),
):
    try:
        result = await CaseManagementService(db).submit_inspection_report(
            case_id, body, inspector_user_id=user.user_id,
            assigned_task_ids=user.jurisdiction.assigned_task_ids, **_context(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Assigned inspection task not found")
    return result


@router.get("/{case_id}", response_model=CaseResponse, summary="Get a case for District Authority review")
async def get_case(
    case_id: str,
    user: UserInDB = Depends(manager_read_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    return await _manager_case_or_404(CaseManagementService(db), case_id, jurisdiction_filter, user)


@router.get("/{case_id}/assignees", response_model=list[CaseAssignee], summary="List compatible owners or inspectors for a case")
async def list_case_assignees(
    case_id: str,
    inspectors_only: bool = Query(default=False),
    user: UserInDB = Depends(manager_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = CaseManagementService(db)
    await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    return await service.list_assignees_for_case(case_id, inspector_only=inspectors_only)


@router.post("/{case_id}/acknowledge", response_model=CaseResponse)
async def acknowledge_case(
    case_id: str, request: Request, body: Optional[CaseReasonRequest] = None,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db)
    await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.acknowledge(case_id, actor=user.user_id, reason=body.reason if body else "", **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case cannot be acknowledged from its current state")
    return updated


@router.post("/{case_id}/begin-review", response_model=CaseResponse)
async def begin_case_review(
    case_id: str, request: Request, body: Optional[CaseReasonRequest] = None,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db)
    await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.begin_review(case_id, actor=user.user_id, reason=body.reason if body else "", **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case cannot enter review from its current state")
    return updated


@router.post("/{case_id}/comments", response_model=CaseResponse)
async def add_case_comment(
    case_id: str, body: CaseCommentRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db)
    await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.add_comment(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=404, detail="Case not found")
    return updated


@router.post("/{case_id}/request-clarification", response_model=CaseResponse)
async def request_case_clarification(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db)
    await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.request_clarification(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.post("/{case_id}/request-documents", response_model=CaseResponse)
async def request_case_documents(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db)
    await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.request_clarification(case_id, body, actor=user.user_id, documents=True, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.put("/{case_id}/owner", response_model=CaseResponse)
async def assign_case_owner(
    case_id: str, body: CaseAssignmentRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    try: updated = await service.assign_owner(case_id, body, actor=user.user_id, **_context(request))
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.put("/{case_id}/inspector", response_model=CaseResponse)
async def assign_case_inspector(
    case_id: str, body: CaseAssignmentRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    try: updated = await service.assign_inspector(case_id, body, actor=user.user_id, **_context(request))
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.put("/{case_id}/corrective-plan", response_model=CaseResponse)
async def create_case_corrective_plan(
    case_id: str, body: CaseCorrectivePlanRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    try: updated = await service.create_corrective_plan(case_id, body, actor=user.user_id, **_context(request))
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.put("/{case_id}/due-date", response_model=CaseResponse)
async def set_case_due_date(
    case_id: str, body: CaseDueDateRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.set_due_date(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.put("/{case_id}/severity", response_model=CaseResponse)
async def change_case_severity(
    case_id: str, body: CaseSeverityRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    try: updated = await service.change_severity(case_id, body, actor=user.user_id, **_context(request))
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.post("/{case_id}/resolve", response_model=CaseResponse)
async def resolve_case(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.resolve(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is already closed")
    return updated


@router.post("/{case_id}/mark-in-progress", response_model=CaseResponse)
async def mark_case_in_progress(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    """District Authority reviews field inspection: marks work actively in progress, updates citizen report, and notifies State Nodal Officer."""
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.mark_reviewed_in_progress(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is already closed")
    return updated


@router.post("/{case_id}/reject", response_model=CaseResponse)
async def reject_case(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.reject(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is already closed")
    return updated


@router.post("/{case_id}/escalate", response_model=CaseResponse)
async def escalate_case(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.escalate(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Case is closed")
    return updated


@router.post("/{case_id}/reopen", response_model=CaseResponse)
async def reopen_case(
    case_id: str, body: CaseReasonRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.reopen(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=409, detail="Only resolved, rejected, or escalated cases may be reopened")
    return updated


@router.post("/{case_id}/override", response_model=CaseResponse)
async def override_case(
    case_id: str, body: CaseOverrideRequest, request: Request,
    user: UserInDB = Depends(manager_dep), jurisdiction_filter: dict = Depends(get_jurisdiction_filter), db: Database = Depends(get_database),
):
    service = CaseManagementService(db); await _manager_case_or_404(service, case_id, jurisdiction_filter, user)
    updated = await service.override(case_id, body, actor=user.user_id, **_context(request))
    if not updated: raise HTTPException(status_code=404, detail="Case not found")
    return updated
