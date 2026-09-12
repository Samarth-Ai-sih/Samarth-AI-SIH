"""State Nodal Officer (SNO) API Router.

Provides state-level endpoints for:
- Statewide Risk Heatmap & District Performance Matrix
- Bottleneck Escalation to District Magistrates
- Inter-District Fund Reallocation Engine
- Compliance Auditing for Mandatory 10% Physical Inspections
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app.core.database import Database, get_database
from app.core.dependencies import get_current_user
from app.models.sno import (
    BottleneckEscalationResponse,
    InspectionQuotaAuditResponse,
    InterDistrictAllocationResponse,
    IssueInspectionOrderRequest,
    IssueInspectionOrderResponse,
    IssueNoticeRequest,
    IssueNoticeResponse,
    ReallocateFundsRequest,
    ReallocateFundsResponse,
    StateRiskHeatmapResponse,
)
from app.models.user import UserInDB, UserRole
from app.services.sno_service import SNOService

logger = logging.getLogger("samarth.api.sno")

router = APIRouter(prefix="/api/v1/sno", tags=["State Nodal Officer (SNO)"])


def _require_sno_or_admin(current_user: UserInDB = Depends(get_current_user)) -> UserInDB:
    """Ensure caller is State Nodal Officer or System Administrator."""
    if current_user.role not in (UserRole.STATE_NODAL_OFFICER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to State Nodal Officers and System Administrators only.",
        )
    return current_user


def get_sno_service(db: Database = Depends(get_database)) -> SNOService:
    return SNOService(db)


def _resolve_state_code(current_user: UserInDB, state_param: Optional[str] = None) -> str:
    """Resolve state code from user jurisdiction or admin query parameter."""
    if current_user.role == UserRole.STATE_NODAL_OFFICER:
        return current_user.jurisdiction.state_code or "UP"
    # Admin can select state or default to UP
    return state_param or "UP"


@router.get("/heatmap", response_model=StateRiskHeatmapResponse)
async def get_state_risk_heatmap(
    state_code: Optional[str] = Query(None, description="State code filter for Administrators"),
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> StateRiskHeatmapResponse:
    """Retrieve district-by-district performance matrix, delay rates, and lagging district heatmap."""
    effective_state = _resolve_state_code(current_user, state_code)
    return await service.get_state_risk_heatmap(effective_state)


@router.get("/bottlenecks", response_model=BottleneckEscalationResponse)
async def get_bottleneck_escalations(
    state_code: Optional[str] = Query(None, description="State code filter for Administrators"),
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> BottleneckEscalationResponse:
    """Retrieve delayed and stalled project bottlenecks exceeding statutory delay thresholds."""
    effective_state = _resolve_state_code(current_user, state_code)
    return await service.get_bottleneck_escalations(effective_state)


@router.post("/bottlenecks/{work_id}/issue-notice", response_model=IssueNoticeResponse)
async def issue_dm_notice(
    work_id: str = Path(..., description="Unique ID of the delayed project"),
    payload: IssueNoticeRequest = None,
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> IssueNoticeResponse:
    """Issue a formal administrative memo notice to the District Magistrate / Collector."""
    effective_state = _resolve_state_code(current_user)
    try:
        actor_name = current_user.full_name or current_user.username
        req_payload = payload or IssueNoticeRequest()
        return await service.issue_dm_notice(
            state_code=effective_state,
            work_id=work_id,
            payload=req_payload,
            issued_by_name=actor_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/allocations", response_model=InterDistrictAllocationResponse)
async def get_inter_district_allocations(
    state_code: Optional[str] = Query(None, description="State code filter for Administrators"),
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> InterDistrictAllocationResponse:
    """Retrieve state aggregate expenditures and district treasury balances with reallocation logs."""
    effective_state = _resolve_state_code(current_user, state_code)
    return await service.get_inter_district_allocations(effective_state)


@router.post("/allocations/reallocate", response_model=ReallocateFundsResponse)
async def reallocate_district_funds(
    payload: ReallocateFundsRequest,
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> ReallocateFundsResponse:
    """Reallocate fund allocations from a stagnant district to a high-absorption target district."""
    effective_state = _resolve_state_code(current_user)
    actor_name = current_user.full_name or current_user.username
    return await service.reallocate_district_funds(
        state_code=effective_state,
        payload=payload,
        authorized_by=actor_name,
    )


@router.get("/inspections-audit", response_model=InspectionQuotaAuditResponse)
async def get_inspection_quota_audit(
    state_code: Optional[str] = Query(None, description="State code filter for Administrators"),
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> InspectionQuotaAuditResponse:
    """Audit district compliance with MoSPI's mandatory 10% annual physical inspection quota."""
    effective_state = _resolve_state_code(current_user, state_code)
    return await service.get_inspection_quota_audit(effective_state)


@router.post("/inspections-audit/directive", response_model=IssueInspectionOrderResponse)
async def issue_inspection_directive(
    payload: IssueInspectionOrderRequest,
    current_user: UserInDB = Depends(_require_sno_or_admin),
    service: SNOService = Depends(get_sno_service),
) -> IssueInspectionOrderResponse:
    """Issue a mandatory inspection drive order to a district facing a quota deficit."""
    effective_state = _resolve_state_code(current_user)
    actor_name = current_user.full_name or current_user.username
    return await service.issue_inspection_directive(
        state_code=effective_state,
        payload=payload,
        issued_by_name=actor_name,
    )
