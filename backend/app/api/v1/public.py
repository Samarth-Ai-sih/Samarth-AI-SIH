from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

from app.core.database import Database, get_database
from app.core.dependencies import get_current_user, get_current_user_optional
from app.core.rate_limit import check_public_issue_rate_limit, check_upload_rate_limit, get_client_ip
from app.models.citizen_portal import (
    CitizenCommunityIssueListResponse,
    CitizenEvidenceUploadResponse,
    CitizenIssueCreateRequest,
    CitizenIssueReceipt,
    CitizenIssueTrackingResponse,
    CitizenPersonalIssueItem,
    CitizenRecentUpdatesResponse,
    CitizenVerificationChallenge,
    PublicWorkDetail,
    PublicWorkListResponse,
)
from app.models.user import UserInDB
from app.models.work import WorkCategory
from app.services.citizen_portal_service import CitizenPortalService


router = APIRouter(prefix="/api/v1/public", tags=["Citizen Portal"])


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


@router.get("/works", response_model=PublicWorkListResponse, summary="Search public-safe works")
async def search_public_works(
    query: str | None = Query(default=None, max_length=150),
    pincode: str | None = Query(default=None, max_length=12),
    district: str | None = Query(default=None, max_length=100),
    constituency: str | None = Query(default=None, max_length=100),
    work_id: str | None = Query(default=None, max_length=120),
    category: WorkCategory | None = Query(default=None),
    mp_name: str | None = Query(default=None, max_length=150),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Database = Depends(get_database),
):
    return await CitizenPortalService(db).search_public_works(
        query=query, pincode=pincode, district=district, constituency=constituency,
        work_id=work_id, category=category, mp_name=mp_name, page=page, page_size=page_size,
    )


@router.get("/works/qr", response_model=PublicWorkDetail, summary="Look up a public work from a QR payload")
async def lookup_public_work_qr(payload: str = Query(min_length=1, max_length=1000), db: Database = Depends(get_database)):
    work = await CitizenPortalService(db).lookup_qr(payload)
    if not work:
        raise HTTPException(status_code=404, detail="No public work matches this QR code")
    return work


@router.get("/works/{work_id}", response_model=PublicWorkDetail, summary="Get public-safe work details")
async def get_public_work(work_id: str, db: Database = Depends(get_database)):
    work = await CitizenPortalService(db).get_public_work(work_id)
    if not work:
        raise HTTPException(status_code=404, detail="Public work not found")
    return work


@router.get("/verification-challenge", response_model=CitizenVerificationChallenge, summary="Get a server-validated demo human-verification challenge")
async def create_citizen_verification_challenge(db: Database = Depends(get_database)):
    return await CitizenPortalService(db).create_verification_challenge()


@router.post("/issues", response_model=CitizenIssueReceipt, status_code=201, summary="Submit a ground issue (optionally authenticated as citizen)")
async def submit_citizen_issue(
    body: CitizenIssueCreateRequest,
    request: Request,
    user: Optional[UserInDB] = Depends(get_current_user_optional),
    _rate_limit: None = Depends(check_public_issue_rate_limit),
    db: Database = Depends(get_database),
):
    try:
        receipt = await CitizenPortalService(db).create_issue(
            body,
            citizen_user_id=user.user_id if user else None,
            citizen_email=user.email if user else None,
            citizen_name=user.full_name if user else None,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not receipt:
        raise HTTPException(status_code=404, detail="Public work not found")
    return receipt


@router.get("/all-issues", response_model=CitizenCommunityIssueListResponse, summary="Public list of all community-raised citizen issues")
async def list_all_community_issues(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Database = Depends(get_database),
):
    """
    Public social-audit feed of all community-raised issues.
    Exposes no citizen PII or contact data.
    """
    return await CitizenPortalService(db).list_all_community_issues(page=page, page_size=page_size)


@router.get("/my-issues", response_model=list[CitizenPersonalIssueItem], summary="Get issues submitted by the logged-in citizen")
async def list_my_citizen_issues(
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    """
    Returns only issues submitted by the authenticated citizen.
    Includes full status progression, inspector assignment details, and senior remarks.
    """
    return await CitizenPortalService(db).list_citizen_user_issues(user_id=user.user_id, email=user.email)



@router.post("/issues/{reference_id}/evidence", response_model=CitizenEvidenceUploadResponse, summary="Attach private optional evidence photos (up to 3)")
async def upload_citizen_issue_evidence(
    reference_id: str,
    request: Request,
    upload_token: str = Form(min_length=20, max_length=200),
    file: UploadFile | None = File(None),
    files: list[UploadFile] = File(None),
    _rate_limit: None = Depends(check_upload_rate_limit),
    db: Database = Depends(get_database),
):
    upload_list: list[UploadFile] = []
    if files:
        upload_list.extend([f for f in files if f is not None])
    if file and file not in upload_list:
        upload_list.append(file)

    if not upload_list:
        raise HTTPException(status_code=400, detail="At least one evidence photo is required")

    last_response = None
    for f in upload_list[:3]:
        content = await f.read(8 * 1024 * 1024 + 1)
        try:
            last_response = await CitizenPortalService(db).upload_issue_evidence(
                reference_id, upload_token=upload_token, filename=f.filename or "citizen-evidence",
                content_type=f.content_type or "application/octet-stream", content=content,
                ip_address=_get_ip(request), user_agent=request.headers.get("user-agent", ""),
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not last_response:
        raise HTTPException(status_code=404, detail="Issue reference not found")
    return last_response


@router.get("/recent-updates", response_model=CitizenRecentUpdatesResponse, summary="List recently updated and resolved citizen reports")
async def get_recent_updates(limit: int = Query(default=10, ge=1, le=50), db: Database = Depends(get_database)):
    reports = await CitizenPortalService(db).list_recent_updates(limit=limit)
    return CitizenRecentUpdatesResponse(reports=reports, total=len(reports))


@router.get("/issues/{reference_id}", response_model=CitizenIssueTrackingResponse, summary="Track the public status of an anonymous ground issue")
async def track_citizen_issue(reference_id: str, db: Database = Depends(get_database)):
    issue = await CitizenPortalService(db).track_issue(reference_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue reference not found")
    return issue

