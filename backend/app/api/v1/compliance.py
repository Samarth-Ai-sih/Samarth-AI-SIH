"""
SAMARTH AI -- Compliance Engine API

Routes:
  GET    /api/v1/compliance/rules                   List rules (latest versions)
  GET    /api/v1/compliance/rules/{rule_id}          Get rule detail
  POST   /api/v1/compliance/rules                   Create new rule
  PATCH  /api/v1/compliance/rules/{rule_id}          Update rule (new version)
  POST   /api/v1/compliance/rules/seed              Seed default rules

  POST   /api/v1/compliance/run/{work_id}           Run rules on one work
  POST   /api/v1/compliance/run                     Batch run on scoped works

  GET    /api/v1/compliance/results                 List results (filtered)
  GET    /api/v1/compliance/results/{result_id}     Get single result
  PATCH  /api/v1/compliance/results/{result_id}/review  Update review status
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import Database, get_database
from app.core.dependencies import (
    get_current_user,
    get_jurisdiction_filter,
    require_permissions,
)
from app.core.rate_limit import get_client_ip
from app.core.permissions import Permission
from app.models.compliance import (
    BatchRunResponse,
    ResultListResponse,
    ResultResponse,
    ResultReviewRequest,
    RuleCreateRequest,
    RuleListResponse,
    RuleResponse,
    RuleUpdateRequest,
)
from app.models.user import UserInDB
from app.services.compliance_service import ComplianceService

logger = logging.getLogger("samarth.api.compliance")

router = APIRouter(prefix="/api/v1/compliance", tags=["Compliance"])


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


# == Rule Management ======================================================


@router.get(
    "/rules",
    response_model=RuleListResponse,
    summary="List compliance rules",
    description="Returns the latest version of each compliance rule.",
)
async def list_rules(
    user: UserInDB = Depends(require_permissions(Permission.READ_COMPLIANCE)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    rules = await svc.list_rules()
    return RuleListResponse(
        rules=[RuleResponse(**_strip_id(r)) for r in rules],
        total=len(rules),
    )


@router.get(
    "/rules/{rule_id}",
    response_model=RuleResponse,
    summary="Get rule detail",
)
async def get_rule(
    rule_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_COMPLIANCE)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    rule = await svc.get_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return RuleResponse(**_strip_id(rule))


@router.post(
    "/rules",
    response_model=RuleResponse,
    status_code=201,
    summary="Create compliance rule",
)
async def create_rule(
    request: Request,
    body: RuleCreateRequest,
    user: UserInDB = Depends(require_permissions(Permission.MANAGE_COMPLIANCE_RULES)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    rule = await svc.create_rule(
        body,
        created_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    return RuleResponse(**_strip_id(rule))


@router.patch(
    "/rules/{rule_id}",
    response_model=RuleResponse,
    summary="Update compliance rule (creates new version)",
)
async def update_rule(
    rule_id: str,
    request: Request,
    body: RuleUpdateRequest,
    user: UserInDB = Depends(require_permissions(Permission.MANAGE_COMPLIANCE_RULES)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    rule = await svc.update_rule(
        rule_id, body,
        updated_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return RuleResponse(**_strip_id(rule))


@router.post(
    "/rules/seed",
    summary="Seed default compliance rules",
    description="Inserts the 11 default compliance rules if they don't already exist.",
)
async def seed_rules(
    user: UserInDB = Depends(require_permissions(Permission.MANAGE_COMPLIANCE_RULES)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    count = await svc.seed_default_rules(created_by=user.user_id)
    return {"seeded": count, "message": f"{count} new rules seeded."}


# == Rule Execution =======================================================


@router.post(
    "/run/{work_id}",
    summary="Run compliance check on one work",
    description="Evaluates all enabled rules against a specific work.",
)
async def run_single(
    work_id: str,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_COMPLIANCE)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    results = await svc.run_compliance_check(
        work_id,
        run_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not results:
        raise HTTPException(status_code=404, detail="Work not found or no rules to evaluate")

    deviations = sum(1 for r in results if r.get("status") == "deviation_detected")
    return {
        "work_id": work_id,
        "total_results": len(results),
        "deviations_found": deviations,
        "results": [ResultResponse(**_strip_id(r)) for r in results],
    }


@router.post(
    "/run",
    response_model=BatchRunResponse,
    summary="Batch compliance check",
    description="Runs all enabled rules against all works within the caller's jurisdiction.",
)
async def run_batch(
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_COMPLIANCE)),
    jfilter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    return await svc.run_batch_check(
        jfilter,
        run_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )


# == Result Management ====================================================


@router.get(
    "/results",
    response_model=ResultListResponse,
    summary="List compliance results",
    description="List compliance check results with filters and pagination.",
)
async def list_results(
    work_id: Optional[str] = Query(default=None),
    rule_code: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None, description="deviation_detected, compliant, not_applicable"),
    review_status: Optional[str] = Query(default=None, description="pending_review, acknowledged, resolved, dismissed"),
    severity: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: UserInDB = Depends(require_permissions(Permission.READ_COMPLIANCE)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    results, total, total_pages = await svc.list_results(
        work_id=work_id,
        rule_code=rule_code,
        status=status,
        review_status=review_status,
        severity=severity,
        page=page,
        page_size=page_size,
    )
    return ResultListResponse(
        results=[ResultResponse(**_strip_id(r)) for r in results],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/results/{result_id}",
    response_model=ResultResponse,
    summary="Get compliance result detail",
)
async def get_result(
    result_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_COMPLIANCE)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    result = await svc.get_result(result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    return ResultResponse(**_strip_id(result))


@router.patch(
    "/results/{result_id}/review",
    response_model=ResultResponse,
    summary="Update review status",
    description="Update the review status of a compliance result (acknowledge, resolve, dismiss).",
)
async def review_result(
    result_id: str,
    request: Request,
    body: ResultReviewRequest,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_COMPLIANCE)),
    db: Database = Depends(get_database),
):
    svc = ComplianceService(db)
    result = await svc.review_result(
        result_id, body,
        reviewed_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    return ResultResponse(**_strip_id(result))


# == Helpers ===============================================================

def _strip_id(doc: dict) -> dict:
    """Remove MongoDB _id field from document."""
    d = dict(doc)
    d.pop("_id", None)
    return d
