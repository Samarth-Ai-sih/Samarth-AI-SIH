"""Restricted moderation endpoints for citizen social-audit reports."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_role
from app.core.rate_limit import get_client_ip
from app.models.citizen_portal import (
    CitizenIssueCreateCaseRequest,
    CitizenIssueModerationList,
    CitizenIssueModerationResponse,
    CitizenIssueModerationUpdate,
    CitizenIssueStatus,
)
from app.models.user import UserInDB, UserRole
from app.services.citizen_portal_service import CitizenPortalService


router = APIRouter(prefix="/api/v1/citizen-reports", tags=["Citizen Report Moderation"])

# Only Dignified Authorities can access: State Nodal, District Authority, Inspector (assigned), Admin, MoSPI
read_dep = require_role(
    UserRole.DISTRICT_AUTHORITY,
    UserRole.ADMIN,
    UserRole.MOSPI,
    UserRole.STATE_NODAL_OFFICER,
    UserRole.INSPECTOR,
)
write_dep = require_role(UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN)


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


async def _allowed_work_ids(db: Database, jurisdiction_filter: dict) -> set[str]:
    docs = await db.get_collection("works").find(jurisdiction_filter, {"_id": 0, "work_id": 1}).to_list(length=None)
    return {str(doc["work_id"]) for doc in docs if doc.get("work_id")}


@router.get("", response_model=CitizenIssueModerationList, summary="List jurisdiction-scoped citizen reports for moderation")
async def list_citizen_reports(
    status: CitizenIssueStatus | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: UserInDB = Depends(read_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    # Inspectors ONLY see citizen reports where they are specifically assigned
    assigned_inspector_id = user.user_id if user.role == UserRole.INSPECTOR else None

    return await CitizenPortalService(db).list_for_moderation(
        allowed_work_ids=await _allowed_work_ids(db, jurisdiction_filter),
        status=status,
        page=page,
        page_size=page_size,
        assigned_inspector_id=assigned_inspector_id,
        viewer_role=user.role.value,
    )


@router.get("/inspectors", summary="List available field inspectors for district assignment")
async def list_available_inspectors(
    user: UserInDB = Depends(read_dep),
    db: Database = Depends(get_database),
):
    """
    Returns available field inspectors scoped to the user's jurisdiction.
    District Authorities see inspectors assigned to their district/state.
    """
    query: dict = {"role": UserRole.INSPECTOR.value, "is_active": True}
    if user.jurisdiction.district_code:
        district_query = {"role": UserRole.INSPECTOR.value, "is_active": True, "jurisdiction.district_code": user.jurisdiction.district_code}
        district_inspectors = await db.get_collection("users").find(
            district_query,
            {"_id": 0, "user_id": 1, "full_name": 1, "username": 1, "email": 1, "jurisdiction": 1}
        ).to_list(length=50)
        if district_inspectors:
            return [
                {
                    "user_id": i["user_id"],
                    "full_name": i.get("full_name") or i.get("username"),
                    "username": i["username"],
                    "email": i["email"],
                    "district_code": i.get("jurisdiction", {}).get("district_code"),
                    "state_code": i.get("jurisdiction", {}).get("state_code"),
                }
                for i in district_inspectors
            ]
    if user.jurisdiction.state_code:
        query["jurisdiction.state_code"] = user.jurisdiction.state_code

    inspectors = await db.get_collection("users").find(
        query,
        {"_id": 0, "user_id": 1, "full_name": 1, "username": 1, "email": 1, "jurisdiction": 1}
    ).to_list(length=50)

    # Fallback if state query yielded nothing (development/demo safety)
    if not inspectors and user.jurisdiction.state_code:
        inspectors = await db.get_collection("users").find(
            {"role": UserRole.INSPECTOR.value, "is_active": True},
            {"_id": 0, "user_id": 1, "full_name": 1, "username": 1, "email": 1, "jurisdiction": 1}
        ).to_list(length=50)

    return [
        {
            "user_id": i["user_id"],
            "full_name": i.get("full_name") or i.get("username"),
            "username": i["username"],
            "email": i["email"],
            "district_code": i.get("jurisdiction", {}).get("district_code"),
            "state_code": i.get("jurisdiction", {}).get("state_code"),
        }
        for i in inspectors
    ]


@router.get("/{reference_id}", response_model=CitizenIssueModerationResponse, summary="Read a restricted citizen report")
async def get_citizen_report(
    reference_id: str,
    user: UserInDB = Depends(read_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    assigned_inspector_id = user.user_id if user.role == UserRole.INSPECTOR else None
    report = await CitizenPortalService(db).get_for_moderation(
        reference_id,
        allowed_work_ids=await _allowed_work_ids(db, jurisdiction_filter),
        assigned_inspector_id=assigned_inspector_id,
        viewer_role=user.role.value,
    )
    if not report:
        if user.role == UserRole.INSPECTOR:
            raise HTTPException(
                status_code=403,
                detail="Access Denied: Field Inspectors can only access citizen reports specifically assigned to them."
            )
        raise HTTPException(status_code=404, detail="Citizen report not found in your jurisdiction")
    return report


@router.get("/{reference_id}/evidence/{evidence_id}", summary="Download or view citizen evidence photo (District Authority only)")
async def get_citizen_evidence_photo(
    reference_id: str,
    evidence_id: str,
    user: UserInDB = Depends(read_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    # Strict Privacy Enforcement: ONLY District Authority (and Admin) can see citizen photos!
    if user.role not in {UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN}:
        raise HTTPException(
            status_code=403,
            detail="Access Denied: Citizen uploaded photos are confidential and restricted strictly to District Authorities under MoSPI Citizen Safeguards."
        )

    allowed_ids = await _allowed_work_ids(db, jurisdiction_filter)
    path, content_type = await CitizenPortalService(db).get_evidence_file(
        reference_id=reference_id, evidence_id=evidence_id, allowed_work_ids=allowed_ids
    )
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Evidence photo not found or inaccessible")

    return FileResponse(path, media_type=content_type, filename=path.name)


@router.post("/{reference_id}/create-case", summary="Escalate citizen report to official Case Management")
async def escalate_citizen_report_to_case(
    reference_id: str,
    body: CitizenIssueCreateCaseRequest,
    request: Request,
    user: UserInDB = Depends(write_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    """District Authority escalates an actionable citizen report directly to an official Case with inspector assignment."""
    try:
        result = await CitizenPortalService(db).escalate_to_case(
            reference_id=reference_id,
            request=body,
            allowed_work_ids=await _allowed_work_ids(db, jurisdiction_filter),
            moderator_user_id=user.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/{reference_id}/status", response_model=CitizenIssueModerationResponse, summary="Moderate a citizen report")
async def moderate_citizen_report(
    reference_id: str,
    body: CitizenIssueModerationUpdate,
    request: Request,
    user: UserInDB = Depends(write_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    try:
        report = await CitizenPortalService(db).moderate_issue(
            reference_id, body, allowed_work_ids=await _allowed_work_ids(db, jurisdiction_filter),
            moderator_user_id=user.user_id, ip_address=_get_ip(request), user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not report:
        raise HTTPException(status_code=404, detail="Citizen report not found in your jurisdiction")
    return report
