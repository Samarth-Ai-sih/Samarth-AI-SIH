"""MongoDB registry for controlled ML artifact lifecycle management."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.database import Database
from app.models.ml import ApprovalStatus, ModelRegistryEntry, ModelType

logger = logging.getLogger("samarth.ml.registry")

MODEL_REGISTRY_COLLECTION = "model_registry"
PREDICTIONS_COLLECTION = "model_predictions"
ARTIFACT_ROOT = Path(__file__).resolve().parents[2] / "model_artifacts"


class ModelRegistry:
    """Persists model metadata and exposes only explicitly approved artifacts."""

    def __init__(self, db: Database):
        self._db = db
        self._models = db.get_collection(MODEL_REGISTRY_COLLECTION)
        self._predictions = db.get_collection(PREDICTIONS_COLLECTION)

    async def ensure_indexes(self) -> None:
        await self._models.create_index("model_id", unique=True)
        await self._models.create_index("model_version", unique=True)
        await self._models.create_index([("model_type", 1), ("approval_status", 1), ("training_date", -1)])
        await self._predictions.create_index("prediction_id", unique=True)
        await self._predictions.create_index([("work_id", 1), ("prediction_timestamp", -1)])
        await self._predictions.create_index("model_version")
        logger.info("ML model-registry and prediction indexes ensured")

    async def register(self, entry: ModelRegistryEntry) -> dict:
        """Insert immutable metadata for an artifact created by a training run."""
        document = entry.model_dump(mode="python")
        await self._models.insert_one(document)
        return document

    async def get_by_version(self, model_version: str) -> Optional[dict]:
        return await self._models.find_one({"model_version": model_version}, {"_id": 0})

    async def get_active(self, model_type: ModelType) -> Optional[dict]:
        """Return the newest approved active model, never a pending artifact."""
        return await self._models.find_one(
            {
                "model_type": model_type.value,
                "approval_status": ApprovalStatus.APPROVED.value,
                "rollback_state": "active",
            },
            {"_id": 0},
            sort=[("training_date", -1), ("model_version", 1)],
        )

    async def list_models(self, model_type: Optional[ModelType] = None) -> list[dict]:
        query = {"model_type": model_type.value} if model_type else {}
        return await self._models.find(query, {"_id": 0}).sort(
            [("training_date", -1), ("model_version", 1)]
        ).to_list(length=None)

    async def approve(self, model_version: str, *, approved_by: str) -> Optional[dict]:
        """Activate an explicitly reviewed model and preserve prior rollback state."""
        candidate = await self._models.find_one({"model_version": model_version}, {"_id": 0})
        if not candidate:
            return None
        now = datetime.now(timezone.utc)
        await self._models.update_many(
            {
                "model_type": candidate["model_type"],
                "approval_status": ApprovalStatus.APPROVED.value,
                "rollback_state": "active",
            },
            {"$set": {"rollback_state": "rollback_candidate"}},
        )
        await self._models.update_one(
            {"model_version": model_version},
            {
                "$set": {
                    "approval_status": ApprovalStatus.APPROVED.value,
                    "rollback_state": "active",
                    "approved_by": approved_by,
                    "approved_at": now,
                }
            },
        )
        return await self.get_by_version(model_version)

    async def rollback(self, model_type: ModelType, *, rolled_back_by: str) -> Optional[dict]:
        """Return to the newest preserved rollback candidate for a model type."""
        candidate = await self._models.find_one(
            {"model_type": model_type.value, "rollback_state": "rollback_candidate"},
            {"_id": 0},
            sort=[("training_date", -1), ("model_version", 1)],
        )
        if not candidate:
            return None
        return await self.approve(candidate["model_version"], approved_by=rolled_back_by)


def artifact_path_for(model_version: str) -> Path:
    """Resolve a safe in-project artifact path for a model version."""
    root = ARTIFACT_ROOT.resolve()
    candidate = (root / f"{model_version}.joblib").resolve()
    if root not in candidate.parents:
        raise ValueError("Artifact path must remain within the model artifact directory.")
    return candidate


def relative_artifact_path(path: Path) -> str:
    """Store portable paths relative to the backend directory."""
    backend_root = ARTIFACT_ROOT.parent
    return path.resolve().relative_to(backend_root.resolve()).as_posix()


def resolve_artifact_path(stored_path: str) -> Path:
    """Resolve and validate a registry path before loading a serialized artifact."""
    backend_root = ARTIFACT_ROOT.parent.resolve()
    candidate = (backend_root / stored_path).resolve()
    artifact_root = ARTIFACT_ROOT.resolve()
    if artifact_root not in candidate.parents:
        raise ValueError("Stored artifact path points outside the model artifact directory.")
    return candidate
