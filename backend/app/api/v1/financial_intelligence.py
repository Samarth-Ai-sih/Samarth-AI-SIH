"""Phase 10 financial-intelligence APIs backed exclusively by MongoDB works data."""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_permissions
from app.core.permissions import Permission
from app.models.financial import FinancialDashboardResponse, FinancialFilterOptions
from app.models.user import UserInDB
from app.services.financial_intelligence_service import FinancialIntelligenceService

router = APIRouter(prefix="/api/v1/financial-intelligence", tags=["Financial Intelligence"])


@router.get(
    "/filters",
    response_model=FinancialFilterOptions,
    summary="List financial-dashboard filters for the caller's jurisdiction",
)
async def financial_filter_options(
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    return await FinancialIntelligenceService(db).get_filter_options(
        jurisdiction_filter=jurisdiction_filter,
    )


@router.get(
    "/dashboard",
    response_model=FinancialDashboardResponse,
    summary="Get financial intelligence, peer comparisons, and review-priority trends",
    description=(
        "All totals and charts are calculated from MongoDB work records in the caller's jurisdiction. "
        "Possible financial irregularity signals require verification; they are not findings of fraud or misconduct."
    ),
)
async def financial_dashboard(
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    state_code: Optional[str] = Query(default=None),
    district_code: Optional[str] = Query(default=None),
    implementing_agency: Optional[str] = Query(default=None),
    user: UserInDB = Depends(require_permissions(Permission.READ_WORKS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    return await FinancialIntelligenceService(db).dashboard(
        jurisdiction_filter=jurisdiction_filter,
        status=status,
        category=category,
        state_code=state_code,
        district_code=district_code,
        implementing_agency=implementing_agency,
    )
