"""Phase 12 private evidence upload and verification endpoints."""

from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

from app.core.config import get_settings
from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_permissions
from app.core.rate_limit import check_upload_rate_limit, get_client_ip
from app.core.permissions import Permission
from app.models.audit import AuditEventType
from app.models.evidence import (
    CloudinaryUploadCompleteRequest,
    CrossProjectDuplicateScanResponse,
    EvidenceListResponse,
    EvidenceUploadSignatureRequest,
    EvidenceUploadSignatureResponse,
    EvidenceVerificationResponse,
)
from app.models.user import UserInDB
from app.services.audit_service import AuditService
from app.services.evidence_verification_service import EvidenceVerificationService

router = APIRouter(prefix="/api/v1/evidence", tags=["Evidence Verification"])


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


def _service(db: Database) -> EvidenceVerificationService:
    settings = get_settings()
    return EvidenceVerificationService(
        db,
        gps_tolerance_meters=settings.EVIDENCE_GPS_TOLERANCE_METERS,
        timestamp_tolerance_days=settings.EVIDENCE_TIMESTAMP_TOLERANCE_DAYS,
        phash_distance_threshold=settings.EVIDENCE_PHASH_DISTANCE_THRESHOLD,
        allow_local_demo=not settings.is_production,
    )


async def _scoped_work_or_404(
    service: EvidenceVerificationService,
    work_id: str,
    jurisdiction_filter: dict,
) -> dict:
    work = await service.work_in_scope(work_id, jurisdiction_filter)
    if not work:
        raise HTTPException(status_code=404, detail="Work not found in your jurisdiction")
    return work


@router.post(
    "/upload-signature",
    response_model=EvidenceUploadSignatureResponse,
    summary="Issue a signed private evidence upload request",
    description="Uses Cloudinary authenticated uploads when configured; otherwise returns the controlled local demo upload endpoint.",
)
async def issue_upload_signature(
    body: EvidenceUploadSignatureRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_EVIDENCE)),
    _rate_limit: None = Depends(check_upload_rate_limit),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    service = _service(db)
    await _scoped_work_or_404(service, body.work_id, jurisdiction_filter)
    settings = get_settings()
    try:
        response = service.build_upload_signature(
            work_id=body.work_id,
            evidence_id=str(uuid4()),
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await AuditService(db).log_event(
        AuditEventType.EVIDENCE_UPLOAD_SIGNATURE_ISSUED,
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        resource_type="private_evidence_upload",
        resource_id=response.evidence_id,
        details={"work_id": body.work_id, "storage_mode": response.storage_mode.value},
    )
    return response


@router.post(
    "/local-upload",
    response_model=EvidenceVerificationResponse,
    status_code=201,
    summary="Upload and verify local demo evidence",
    description="Available only when Cloudinary is not configured. The stored file is private and never served by this API.",
)
async def upload_local_demo_evidence(
    request: Request,
    work_id: str = Form(...),
    file: UploadFile = File(...),
    user: UserInDB = Depends(require_permissions(Permission.WRITE_EVIDENCE)),
    _rate_limit: None = Depends(check_upload_rate_limit),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    settings = get_settings()
    if settings.is_production:
        raise HTTPException(status_code=503, detail="Local evidence storage is disabled in production")
    if settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET:
        raise HTTPException(status_code=409, detail="Cloudinary is configured; use the signed upload flow")
    service = _service(db)
    work = await _scoped_work_or_404(service, work_id, jurisdiction_filter)
    content = await file.read(settings.MAX_REQUEST_SIZE_MB * 1024 * 1024 + 1)
    try:
        return await service.ingest_local_upload(
            work=work,
            filename=file.filename or "evidence-image",
            content_type=file.content_type or "application/octet-stream",
            content=content,
            uploaded_by=user.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/cloudinary-complete",
    response_model=EvidenceVerificationResponse,
    status_code=201,
    summary="Verify a completed authenticated Cloudinary upload",
)
async def complete_cloudinary_upload(
    body: CloudinaryUploadCompleteRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_EVIDENCE)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    settings = get_settings()
    if not (settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET):
        raise HTTPException(status_code=409, detail="Cloudinary is not configured; use local demo upload")
    service = _service(db)
    work = await _scoped_work_or_404(service, body.work_id, jurisdiction_filter)
    try:
        return await service.complete_cloudinary_upload(
            work=work,
            request=body,
            uploaded_by=user.user_id,
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/scan/cross-project",
    response_model=CrossProjectDuplicateScanResponse,
    summary="Run cross-project private image reuse detection",
    description="Compares only stored perceptual hashes. Evidence files and raw coordinates are never returned.",
)
async def scan_cross_project_images(
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_EVIDENCE)),
    db: Database = Depends(get_database),
):
    return await _service(db).run_cross_project_duplicate_scan(
        performed_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )


@router.get(
    "",
    response_model=EvidenceListResponse,
    summary="List private evidence verification results",
    description="Requires evidence permission. Citizens do not have access to this route or the underlying files.",
)
async def list_evidence(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    work_id: str | None = Query(default=None),
    user: UserInDB = Depends(require_permissions(Permission.READ_EVIDENCE)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    evidence, total, total_pages = await _service(db).list_evidence(
        jurisdiction_filter=jurisdiction_filter,
        work_id=work_id,
        page=page,
        page_size=page_size,
    )
    return EvidenceListResponse(
        evidence=evidence,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{evidence_id}",
    response_model=EvidenceVerificationResponse,
    summary="Get one private evidence verification result",
)
async def get_evidence(
    evidence_id: str,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.READ_EVIDENCE)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    evidence = await _service(db).get_evidence(evidence_id, jurisdiction_filter=jurisdiction_filter)
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence verification result not found")
    await AuditService(db).log_event(
        AuditEventType.EVIDENCE_ACCESS,
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        resource_type="private_evidence_verification",
        resource_id=evidence_id,
        details={"work_id": evidence.work_id},
    )
    return evidence
