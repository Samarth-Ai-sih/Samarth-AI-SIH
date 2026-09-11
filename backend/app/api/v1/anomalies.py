"""FastAPI endpoints for Anomaly & Fraud Detection, Verification Routing & Project Story Dossier."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_permissions, require_role
from app.core.permissions import Permission
from app.core.rate_limit import get_client_ip
from app.models.anomaly import (
    AuthorityOption,
    ProjectStoryResponse,
    VerificationRequestCreate,
    VerificationRequestResponse,
)
from app.models.user import UserInDB, UserRole
from app.services.anomaly_service import AnomalyIntelligenceService

router = APIRouter(prefix="/api/v1/anomalies", tags=["Anomaly & Verification Intelligence"])

verification_writer_dep = require_role(
    UserRole.DISTRICT_AUTHORITY,
    UserRole.ADMIN,
    UserRole.STATE_NODAL_OFFICER,
    UserRole.MOSPI,
)


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


@router.get(
    "/project-story/{work_id}",
    response_model=ProjectStoryResponse,
    summary="Get comprehensive 'What Happened in This Project' dossier and 5-point anomaly diagnosis",
    description=(
        "Returns the complete project story narrative, 5-point anomaly evaluation, "
        "unified chronological narrative timeline, citizen concerns, and active verification requests."
    ),
)
async def get_project_story(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = AnomalyIntelligenceService(db)
    story = await service.get_project_story(work_id, jurisdiction_filter=jurisdiction_filter)
    if not story:
        raise HTTPException(status_code=404, detail="Work project not found or not in caller's jurisdiction")
    return story


@router.get(
    "/authorities/{work_id}",
    response_model=list[AuthorityOption],
    summary="List available authorities for dispatching verification requests",
    description="Returns available Finance Officers, District Authorities, Field Inspectors, and SNOs in that project's scope.",
)
async def get_available_authorities(
    work_id: str,
    user: UserInDB = Depends(verification_writer_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = AnomalyIntelligenceService(db)
    return await service.get_available_authorities(work_id, jurisdiction_filter=jurisdiction_filter)


@router.post(
    "/verification-request",
    response_model=VerificationRequestResponse,
    status_code=201,
    summary="Generate and dispatch a formal Verification Request to a related authority",
    description=(
        "Dispatches a targeted verification task to the selected authority (Finance, Ground Inspection, SNO). "
        "Creates a tracked case, pushes an immutable event to the project's timeline, and notifies the recipient."
    ),
)
async def create_verification_request(
    body: VerificationRequestCreate,
    request: Request,
    user: UserInDB = Depends(verification_writer_dep),
    db: Database = Depends(get_database),
):
    service = AnomalyIntelligenceService(db)
    try:
        result = await service.create_verification_request(
            body,
            creator_user_id=user.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate verification request: {str(exc)}") from exc
