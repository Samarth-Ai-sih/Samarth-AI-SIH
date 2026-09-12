"""MoSPI Executive Command Center API Endpoints.

Provides macro telemetry, inter-state benchmarking, statutory quota tracking,
central treasury tranche authorization, and national portal sync.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, status

from app.core.database import Database, get_database
from app.core.dependencies import get_current_user
from app.models.mospi import (
    InterStateBenchmarkingResponse,
    MacroTelemetryResponse,
    PortalSyncRequest,
    PortalSyncResponse,
    StatutoryQuotaResponse,
    TreasuryAuthorizeRequest,
    TreasuryAuthorizeResponse,
    TreasuryReleasesResponse,
)
from app.models.user import UserInDB, UserRole
from app.services.mospi_service import MoSPIService

logger = logging.getLogger("samarth.api.mospi")

router = APIRouter(prefix="/api/v1/mospi", tags=["MoSPI Executive Command Center"])


def _require_mospi_or_admin(current_user: UserInDB = Depends(get_current_user)) -> UserInDB:
    """Ensure caller is MoSPI or System Administrator."""
    if current_user.role not in (UserRole.MOSPI, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to MoSPI Central Ministry and Administrators only.",
        )
    return current_user


def get_mospi_service(db: Database = Depends(get_database)) -> MoSPIService:
    return MoSPIService(db)


@router.get("/telemetry", response_model=MacroTelemetryResponse)
async def get_macro_telemetry(
    current_user: UserInDB = Depends(_require_mospi_or_admin),
    service: MoSPIService = Depends(get_mospi_service),
) -> MacroTelemetryResponse:
    """Retrieve nationwide macro fund flow and delivery telemetry across ₹4,000+ Cr outlay."""
    return await service.get_macro_telemetry()


@router.get("/benchmarking", response_model=InterStateBenchmarkingResponse)
async def get_inter_state_benchmarking(
    current_user: UserInDB = Depends(_require_mospi_or_admin),
    service: MoSPIService = Depends(get_mospi_service),
) -> InterStateBenchmarkingResponse:
    """Retrieve inter-state expenditure efficiency rankings, delay rates, and dormant fund counts."""
    return await service.get_inter_state_benchmarking()


@router.get("/statutory-quotas", response_model=StatutoryQuotaResponse)
async def get_statutory_quota_oversight(
    current_user: UserInDB = Depends(_require_mospi_or_admin),
    service: MoSPIService = Depends(get_mospi_service),
) -> StatutoryQuotaResponse:
    """Retrieve nationwide statutory compliance monitoring for mandatory 15% SC / 7.5% ST allocation quotas."""
    return await service.get_statutory_quota_oversight()


@router.get("/treasury-releases", response_model=TreasuryReleasesResponse)
async def get_treasury_releases(
    current_user: UserInDB = Depends(_require_mospi_or_admin),
    service: MoSPIService = Depends(get_mospi_service),
) -> TreasuryReleasesResponse:
    """Retrieve central treasury installment release queue (₹2.5 Cr tranches) and UC verification status."""
    return await service.get_treasury_releases()


@router.post("/treasury-releases/{release_id}/authorize", response_model=TreasuryAuthorizeResponse)
async def authorize_treasury_release(
    release_id: str = Path(..., description="Unique ID of the release request"),
    payload: TreasuryAuthorizeRequest = None,
    current_user: UserInDB = Depends(_require_mospi_or_admin),
    service: MoSPIService = Depends(get_mospi_service),
) -> TreasuryAuthorizeResponse:
    """Authorize a ₹2.5 Cr central installment release for a constituency with PFMS reference generation."""
    try:
        remarks = payload.remarks if payload else None
        return await service.authorize_treasury_release(
            release_id,
            authorized_by_name=current_user.full_name or current_user.username,
            remarks=remarks,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/sync-portal", response_model=PortalSyncResponse)
async def sync_national_portal(
    payload: PortalSyncRequest,
    current_user: UserInDB = Depends(_require_mospi_or_admin),
    service: MoSPIService = Depends(get_mospi_service),
) -> PortalSyncResponse:
    """Trigger live synchronization with national financial and scheme gateways (PFMS / eSAKSHI)."""
    return await service.sync_national_portal(payload.target_portal)
