"""
SAMARTH AI — CSV Ingestion API

Endpoints for uploading, validating, and importing
MPLADS allocation CSV datasets.

Routes:
  POST   /upload                    Upload CSV file
  GET    /batches                   List all import batches
  GET    /batches/{id}              Get batch details
  GET    /batches/{id}/preview      Preview mapped rows
  PUT    /batches/{id}/mapping      Update column mapping
  POST   /batches/{id}/validate     Run validation
  POST   /batches/{id}/import       Execute import
  POST   /batches/{id}/retry        Retry failed batch
  GET    /batches/{id}/invalid      Export invalid rows
  GET    /stats                     Collection statistics
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.database import get_database, Database
from app.core.dependencies import require_permissions
from app.core.permissions import Permission
from app.core.rate_limit import check_upload_rate_limit
from app.models.ingestion import (
    BatchListResponse,
    ColumnMapping,
    ImportBatchResponse,
    ImportResultResponse,
    InvalidRowsResponse,
    PreviewResponse,
    ValidationResponse,
)
from app.services.ingestion import IngestionService

logger = logging.getLogger("samarth.api.ingestion")

# All ingestion endpoints require authentication + UPLOAD_CSV permission
router = APIRouter(
    prefix="/api/v1/ingestion",
    tags=["Ingestion"],
    dependencies=[Depends(require_permissions(Permission.UPLOAD_CSV))],
)


def get_ingestion_service(db: Database = Depends(get_database)) -> IngestionService:
    """Dependency: create IngestionService with current database."""
    return IngestionService(db)


# ── Upload ───────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=ImportBatchResponse,
    summary="Upload CSV file",
    description="Upload an MPLADS allocation CSV file. Auto-detects Lok Sabha / Rajya Sabha format.",
)
async def upload_csv(
    file: UploadFile = File(..., description="CSV file to upload"),
    _rate_limit: None = Depends(check_upload_rate_limit),
    svc: IngestionService = Depends(get_ingestion_service),
):
    """Upload a CSV file and create an import batch."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only CSV files are accepted")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Uploaded file is empty")
    if len(content) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(400, "File too large (max 10 MB)")
    if b"\x00" in content:
        raise HTTPException(400, "CSV files must not contain binary data")
    try:
        content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "CSV files must be UTF-8 encoded") from exc

    try:
        batch = await svc.upload_csv(file.filename, content)
        return batch
    except Exception as exc:
        logger.error("Upload failed: %s", exc)
        raise HTTPException(500, f"Upload failed: {exc}")


# ── List batches ─────────────────────────────────────────────

@router.get(
    "/batches",
    response_model=BatchListResponse,
    summary="List import batches",
    description="List all import batch records, most recent first.",
)
async def list_batches(
    svc: IngestionService = Depends(get_ingestion_service),
):
    batches = await svc.list_batches()
    return {"batches": batches, "total": len(batches)}


# ── Get batch ────────────────────────────────────────────────

@router.get(
    "/batches/{batch_id}",
    response_model=ImportBatchResponse,
    summary="Get batch details",
)
async def get_batch(
    batch_id: str,
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        return await svc.get_batch(batch_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


# ── Preview ──────────────────────────────────────────────────

@router.get(
    "/batches/{batch_id}/preview",
    response_model=PreviewResponse,
    summary="Preview mapped rows",
    description="Preview first N rows with column mapping applied and MP name normalization.",
)
async def preview_rows(
    batch_id: str,
    limit: int = Query(default=10, ge=1, le=50, description="Number of rows to preview"),
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        return await svc.preview_rows(batch_id, limit)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


# ── Update mapping ───────────────────────────────────────────

class MappingUpdateRequest(BaseModel):
    """Request body for updating column mapping."""
    sr_no: Optional[str] = None
    state: Optional[str] = None
    mp_name: Optional[str] = None
    constituency: Optional[str] = None
    elected_nominated: Optional[str] = None
    allocated_amount: Optional[str] = None


@router.put(
    "/batches/{batch_id}/mapping",
    response_model=ImportBatchResponse,
    summary="Update column mapping",
    description="Override the auto-detected column mapping for a batch.",
)
async def update_mapping(
    batch_id: str,
    mapping: MappingUpdateRequest,
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        mapping_dict = {k: v for k, v in mapping.model_dump().items() if v is not None}
        return await svc.update_mapping(batch_id, mapping_dict)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ── Validate ─────────────────────────────────────────────────

@router.post(
    "/batches/{batch_id}/validate",
    response_model=ValidationResponse,
    summary="Validate batch",
    description="Run validation rules on all rows. Returns validation report.",
)
async def validate_batch(
    batch_id: str,
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        return await svc.validate_batch(batch_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


# ── Import ───────────────────────────────────────────────────

@router.post(
    "/batches/{batch_id}/import",
    response_model=ImportResultResponse,
    summary="Execute import",
    description=(
        "Import validated rows into reference collections. "
        "Idempotent: duplicates are skipped via SHA-256 hash."
    ),
)
async def import_batch(
    batch_id: str,
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        return await svc.import_batch(batch_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ── Retry ────────────────────────────────────────────────────

@router.post(
    "/batches/{batch_id}/retry",
    response_model=ImportResultResponse,
    summary="Retry failed batch",
    description="Re-run import for a failed or partially completed batch.",
)
async def retry_batch(
    batch_id: str,
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        return await svc.retry_batch(batch_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ── Invalid rows export ──────────────────────────────────────

@router.get(
    "/batches/{batch_id}/invalid",
    response_model=InvalidRowsResponse,
    summary="Export invalid rows",
    description="Get all invalid rows from a validated batch for review or re-submission.",
)
async def get_invalid_rows(
    batch_id: str,
    svc: IngestionService = Depends(get_ingestion_service),
):
    try:
        return await svc.get_invalid_rows(batch_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


# ── Stats ────────────────────────────────────────────────────

@router.get(
    "/stats",
    summary="Collection statistics",
    description="Get document counts for all ingestion-related collections.",
)
async def get_stats(
    svc: IngestionService = Depends(get_ingestion_service),
):
    return await svc.get_collection_stats()


# ── Data Query Endpoints ─────────────────────────────────────


@router.get(
    "/allocations",
    summary="List imported allocations",
    description="Paginated list of imported MP allocation records with search and filters.",
)
async def list_allocations(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    search: Optional[str] = Query(default=None, description="Search by MP name or state"),
    state: Optional[str] = Query(default=None, description="Filter by state"),
    house: Optional[str] = Query(default=None, description="Filter by house (lok_sabha/rajya_sabha)"),
    sort_by: str = Query(default="state_name", description="Sort field"),
    sort_order: str = Query(default="asc", description="asc or desc"),
    db: Database = Depends(get_database),
):
    col = db.get_collection("mp_allocations")
    query: dict = {}
    if search:
        query["$or"] = [
            {"mp_name": {"$regex": search, "$options": "i"}},
            {"state_name": {"$regex": search, "$options": "i"}},
            {"constituency_name": {"$regex": search, "$options": "i"}},
        ]
    if state:
        query["state_name"] = {"$regex": f"^{state}$", "$options": "i"}
    if house:
        query["house"] = house

    total = await col.count_documents(query)
    sort_dir = 1 if sort_order == "asc" else -1
    skip = (page - 1) * page_size
    cursor = col.find(query, {"_id": 0}).sort(sort_by, sort_dir).skip(skip).limit(page_size)
    records = await cursor.to_list(length=page_size)
    # Serialize ObjectId fields
    for r in records:
        if "mp_id" in r:
            r["mp_id"] = str(r["mp_id"])
    return {"allocations": records, "total": total, "page": page, "page_size": page_size}


@router.get(
    "/mps",
    summary="List imported MPs",
    description="Paginated list of imported MP records.",
)
async def list_mps(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    house: Optional[str] = Query(default=None),
    db: Database = Depends(get_database),
):
    col = db.get_collection("mps")
    query: dict = {}
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    if state:
        query["state_name"] = {"$regex": f"^{state}$", "$options": "i"}
    if house:
        query["house"] = house

    total = await col.count_documents(query)
    skip = (page - 1) * page_size
    cursor = col.find(query, {"_id": 0}).sort("name", 1).skip(skip).limit(page_size)
    records = await cursor.to_list(length=page_size)
    return {"mps": records, "total": total, "page": page, "page_size": page_size}


@router.get(
    "/states",
    summary="List imported states",
    description="List all imported state reference records.",
)
async def list_states(
    db: Database = Depends(get_database),
):
    col = db.get_collection("states")
    cursor = col.find({}, {"_id": 0}).sort("name", 1)
    records = await cursor.to_list(length=100)
    return {"states": records, "total": len(records)}


@router.get(
    "/constituencies",
    summary="List imported constituencies",
    description="Paginated list of imported constituency records.",
)
async def list_constituencies(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    state: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    db: Database = Depends(get_database),
):
    col = db.get_collection("constituencies")
    query: dict = {}
    if state:
        query["state_name"] = {"$regex": f"^{state}$", "$options": "i"}
    if search:
        query["name"] = {"$regex": search, "$options": "i"}

    total = await col.count_documents(query)
    skip = (page - 1) * page_size
    cursor = col.find(query, {"_id": 0}).sort("name", 1).skip(skip).limit(page_size)
    records = await cursor.to_list(length=page_size)
    return {"constituencies": records, "total": total, "page": page, "page_size": page_size}
