"""Phase 11 possible duplicate-work detection and manual review APIs."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_permissions
from app.core.rate_limit import get_client_ip
from app.core.permissions import Permission
from app.models.duplicate import (
    DuplicateCaseCreateRequest,
    DuplicateCaseResponse,
    DuplicateCluster,
    DuplicateClusterListResponse,
    DuplicateComparisonResponse,
    DuplicateDetectionRunRequest,
    DuplicateDetectionScan,
    DuplicateMatch,
    DuplicateMatchListResponse,
    DuplicateMatchStatus,
    DuplicateReviewRequest,
)
from app.models.user import UserInDB
from app.services.duplicate_detection_service import DuplicateDetectionService

router = APIRouter(prefix="/api/v1/duplicates", tags=["Possible Duplicate Works"])


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


@router.post(
    "/scan",
    response_model=DuplicateDetectionScan,
    status_code=201,
    summary="Run possible duplicate-work detection in the caller's jurisdiction",
    description="Creates explainable candidate snapshots and clusters for manual verification.",
)
async def run_duplicate_scan(
    body: DuplicateDetectionRunRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    return await DuplicateDetectionService(db).scan(
        jurisdiction_filter=jurisdiction_filter,
        rule=body.to_rule(),
        created_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )


@router.get(
    "/clusters",
    response_model=DuplicateClusterListResponse,
    summary="List current possible duplicate-work clusters",
)
async def list_duplicate_clusters(
    user: UserInDB = Depends(require_permissions(Permission.READ_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    clusters, scan = await DuplicateDetectionService(db).list_clusters(
        jurisdiction_filter=jurisdiction_filter,
    )
    return DuplicateClusterListResponse(
        clusters=[DuplicateCluster(**cluster) for cluster in clusters],
        total=len(clusters),
        scan=DuplicateDetectionScan(**scan) if scan else None,
    )


@router.get(
    "",
    response_model=DuplicateMatchListResponse,
    summary="Explore latest possible duplicate-work matches",
)
async def list_duplicate_matches(
    status: Optional[DuplicateMatchStatus] = Query(default=None),
    min_similarity_score: float = Query(default=0.0, ge=0, le=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: UserInDB = Depends(require_permissions(Permission.READ_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    matches, total, total_pages, scan = await DuplicateDetectionService(db).list_matches(
        jurisdiction_filter=jurisdiction_filter,
        status=status,
        min_similarity_score=min_similarity_score,
        page=page,
        page_size=page_size,
    )
    return DuplicateMatchListResponse(
        matches=[DuplicateMatch(**match) for match in matches],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        scan=DuplicateDetectionScan(**scan) if scan else None,
    )


@router.get(
    "/{match_id}",
    response_model=DuplicateComparisonResponse,
    summary="Get a split-screen comparison for a possible duplicate-work match",
)
async def duplicate_comparison(
    match_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    comparison = await DuplicateDetectionService(db).get_comparison(
        match_id, jurisdiction_filter=jurisdiction_filter,
    )
    if not comparison:
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    return comparison


@router.post(
    "/{match_id}/cases",
    response_model=DuplicateCaseResponse,
    status_code=201,
    summary="Create a review case for a possible duplicate-work match",
)
async def create_duplicate_case(
    match_id: str,
    body: DuplicateCaseCreateRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = DuplicateDetectionService(db)
    if not await service.get_comparison(match_id, jurisdiction_filter=jurisdiction_filter):
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    case = await service.create_case(
        match_id, body,
        created_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not case:
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    return case


@router.post(
    "/{match_id}/mark-not-duplicate",
    response_model=DuplicateMatch,
    summary="Record manual review that a possible match is not a duplicate",
)
async def mark_not_duplicate(
    match_id: str,
    body: DuplicateReviewRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = DuplicateDetectionService(db)
    if not await service.get_comparison(match_id, jurisdiction_filter=jurisdiction_filter):
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    match = await service.mark_not_duplicate(
        match_id, body,
        reviewed_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not match:
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    return DuplicateMatch(**match)


@router.post(
    "/{match_id}/request-field-verification",
    response_model=DuplicateMatch,
    summary="Request on-site verification for a possible duplicate-work match",
)
async def request_field_verification(
    match_id: str,
    body: DuplicateReviewRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_INVESTIGATIONS)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = DuplicateDetectionService(db)
    if not await service.get_comparison(match_id, jurisdiction_filter=jurisdiction_filter):
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    match = await service.request_field_verification(
        match_id, body,
        requested_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not match:
        raise HTTPException(status_code=404, detail="Possible duplicate-work match not found")
    return DuplicateMatch(**match)
