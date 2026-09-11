"""
SAMARTH AI — Composite Risk Scoring API

Risk scores are decision-support alerts.  They expose the complete frozen
scoring explanation, but do not make an automated compliance determination.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import Database, get_database
from app.core.dependencies import get_jurisdiction_filter, require_permissions
from app.core.rate_limit import get_client_ip
from app.core.permissions import Permission
from app.models.audit import AuditEventType
from app.models.risk import (
    BatchScoreRequest,
    BatchScoreResponse,
    RiskDistribution,
    RiskScoreListResponse,
    RiskScoreResponse,
    ScoreWorkRequest,
)
from app.models.ml import ModelRegistryEntry, ModelRegistryListResponse, ModelType, PredictionResponse
from app.models.user import UserInDB
from app.ml.inference import ModelInferenceService
from app.ml.model_registry import ModelRegistry
from app.services.audit_service import AuditService
from app.services.risk_service import RiskScoringService

logger = logging.getLogger("samarth.api.risk")

router = APIRouter(prefix="/api/v1/risk", tags=["Risk Scoring"])


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


async def _require_scoped_work(
    db: Database, work_id: str, jurisdiction_filter: dict,
) -> None:
    """Avoid exposing or scoring a work outside the caller's scope."""
    query = {"work_id": work_id, **jurisdiction_filter}
    work = await db.get_collection("works").find_one(query, {"_id": 1})
    if not work:
        raise HTTPException(status_code=404, detail="Work not found")


@router.post(
    "/score/{work_id}",
    response_model=RiskScoreResponse,
    status_code=201,
    summary="Calculate and persist a composite risk score",
    description="Uses the deterministic Phase 8 policy and persists a frozen score snapshot.",
)
async def score_work(
    work_id: str,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    await _require_scoped_work(db, work_id, jurisdiction_filter)
    score = await RiskScoringService(db).score_work(
        work_id,
        calculated_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    if not score:  # Defensive: the scoped lookup above has already checked.
        raise HTTPException(status_code=404, detail="Work not found")
    return RiskScoreResponse(**score.model_dump())


@router.post(
    "/score",
    response_model=RiskScoreResponse,
    status_code=201,
    include_in_schema=False,
)
async def score_work_from_body(
    body: ScoreWorkRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    """Body-based alias retained for clients that use ScoreWorkRequest."""
    return await score_work(body.work_id, request, user, jurisdiction_filter, db)


@router.post(
    "/batch",
    response_model=BatchScoreResponse,
    summary="Batch score works in the caller's jurisdiction",
)
async def score_batch(
    body: BatchScoreRequest,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    return await RiskScoringService(db).score_batch(
        jurisdiction_filter=jurisdiction_filter,
        work_ids=body.work_ids,
        calculated_by=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )


# == Model Predictions ====================================================


@router.post(
    "/predictions/{work_id}",
    response_model=PredictionResponse,
    status_code=201,
    summary="Run and persist a delay and execution-anomaly prediction",
    description=(
        "Uses approved model artifacts when present. Otherwise persists a clearly "
        "labelled deterministic heuristic fallback; it is not an ML prediction."
    ),
)
async def create_prediction(
    work_id: str,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.WRITE_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    await _require_scoped_work(db, work_id, jurisdiction_filter)
    prediction = await ModelInferenceService(db).predict_work(work_id)
    if not prediction:
        raise HTTPException(status_code=404, detail="Work not found")
    await AuditService(db).log_event(
        AuditEventType.ML_PREDICTION_CALCULATED,
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        resource_type="model_prediction",
        resource_id=prediction.prediction_id,
        details={
            "work_id": work_id,
            "model_version": prediction.model_version,
            "inference_source": prediction.inference_source,
        },
    )
    return PredictionResponse(**prediction.model_dump())


@router.get(
    "/predictions/{work_id}",
    response_model=PredictionResponse,
    summary="Get the latest persisted model prediction for a work",
)
async def get_latest_prediction(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    await _require_scoped_work(db, work_id, jurisdiction_filter)
    prediction = await ModelInferenceService(db).get_latest_prediction(work_id)
    if not prediction:
        raise HTTPException(status_code=404, detail="No prediction has been calculated for this work")
    return PredictionResponse(**_strip_id(prediction))


# == Model Registry =======================================================


@router.get(
    "/models",
    response_model=ModelRegistryListResponse,
    summary="List registered ML artifacts and their approval state",
)
async def list_models(
    model_type: Optional[ModelType] = Query(default=None),
    user: UserInDB = Depends(require_permissions(Permission.READ_RISK)),
    db: Database = Depends(get_database),
):
    models = await ModelRegistry(db).list_models(model_type)
    return ModelRegistryListResponse(
        models=[ModelRegistryEntry(**_strip_id(model)) for model in models],
        total=len(models),
    )


@router.post(
    "/models/{model_version}/approve",
    response_model=ModelRegistryEntry,
    summary="Approve a reviewed model artifact for live inference",
)
async def approve_model(
    model_version: str,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.MANAGE_ML_MODELS)),
    db: Database = Depends(get_database),
):
    model = await ModelRegistry(db).approve(model_version, approved_by=user.user_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model registry entry not found")
    await AuditService(db).log_event(
        AuditEventType.ML_MODEL_APPROVED,
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        resource_type="model_registry",
        resource_id=model_version,
        details={"model_type": model["model_type"], "rollback_state": model["rollback_state"]},
    )
    return ModelRegistryEntry(**_strip_id(model))


@router.post(
    "/models/{model_type}/rollback",
    response_model=ModelRegistryEntry,
    summary="Roll a model type back to its latest approved rollback candidate",
)
async def rollback_model(
    model_type: ModelType,
    request: Request,
    user: UserInDB = Depends(require_permissions(Permission.MANAGE_ML_MODELS)),
    db: Database = Depends(get_database),
):
    model = await ModelRegistry(db).rollback(model_type, rolled_back_by=user.user_id)
    if not model:
        raise HTTPException(status_code=409, detail="No rollback candidate is available for this model type")
    await AuditService(db).log_event(
        AuditEventType.ML_MODEL_ROLLED_BACK,
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
        resource_type="model_registry",
        resource_id=model["model_version"],
        details={"model_type": model_type.value, "rollback_state": model["rollback_state"]},
    )
    return ModelRegistryEntry(**_strip_id(model))


@router.get(
    "/distribution",
    response_model=RiskDistribution,
    summary="Get the latest risk-tier distribution",
)
async def get_distribution(
    user: UserInDB = Depends(require_permissions(Permission.READ_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    return await RiskScoringService(db).distribution(jurisdiction_filter)


@router.get(
    "",
    response_model=RiskScoreListResponse,
    summary="List latest composite risk alerts",
)
async def list_scores(
    tier: Optional[str] = Query(default=None, pattern="^(green|amber|red)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: UserInDB = Depends(require_permissions(Permission.READ_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    scores, total, total_pages = await RiskScoringService(db).list_latest_scores(
        jurisdiction_filter=jurisdiction_filter,
        tier=tier,
        page=page,
        page_size=page_size,
    )
    return RiskScoreListResponse(
        scores=[RiskScoreResponse(**_strip_id(score)) for score in scores],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get(
    "/{work_id}",
    response_model=RiskScoreResponse,
    summary="Get the latest composite risk alert for a work",
)
async def get_latest_score(
    work_id: str,
    user: UserInDB = Depends(require_permissions(Permission.READ_RISK)),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    await _require_scoped_work(db, work_id, jurisdiction_filter)
    score = await RiskScoringService(db).get_latest_score(work_id)
    if not score:
        raise HTTPException(status_code=404, detail="No risk score has been calculated for this work")
    return RiskScoreResponse(**_strip_id(score))


def _strip_id(document: dict) -> dict:
    """Remove the MongoDB internal id before Pydantic response validation."""
    result = dict(document)
    result.pop("_id", None)
    return result
