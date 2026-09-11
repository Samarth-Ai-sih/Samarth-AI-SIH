"""
SAMARTH AI — Health Check Endpoints

Provides liveness and readiness probes for monitoring and orchestration.

- /health     — Basic liveness (is the process running?)
- /ready      — Readiness (are dependencies available?)
- /api/v1/health — Versioned health check
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.database import get_database, Database

logger = logging.getLogger("samarth.health")

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    """Basic health check response."""
    status: str
    app: str
    version: str
    environment: str
    timestamp: str


class ReadinessResponse(BaseModel):
    """Readiness check response with dependency statuses."""
    status: str
    app: str
    version: str
    environment: str
    timestamp: str
    dependencies: dict[str, dict[str, str]]


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description="Returns OK if the application process is running.",
)
async def health_check(
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    """Basic liveness probe — is the server up?"""
    return HealthResponse(
        status="ok",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT.value,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description="Returns OK if all dependencies (MongoDB, Redis) are available.",
)
async def readiness_check(
    settings: Settings = Depends(get_settings),
) -> ReadinessResponse:
    """Readiness probe — are dependencies available?"""
    dependencies: dict[str, dict[str, str]] = {}

    # Check MongoDB
    try:
        db = get_database()
        mongo_healthy = await db.is_healthy()
        dependencies["mongodb"] = {
            "status": "ok" if mongo_healthy else "degraded",
            "database": settings.MONGODB_DB_NAME,
        }
    except RuntimeError:
        dependencies["mongodb"] = {"status": "not_connected"}

    # Check Redis
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=3)
        await r.ping()
        dependencies["redis"] = {"status": "ok"}
        await r.aclose()
    except Exception as exc:
        dependencies["redis"] = {
            "status": "unavailable",
            "error": str(exc)[:100],
        }

    # Overall status
    all_ok = all(dep["status"] == "ok" for dep in dependencies.values())
    overall_status = "ok" if all_ok else "degraded"

    return ReadinessResponse(
        status=overall_status,
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT.value,
        timestamp=datetime.now(timezone.utc).isoformat(),
        dependencies=dependencies,
    )


# ── Versioned health router ─────────────────────────────────────
v1_router = APIRouter(prefix="/api/v1", tags=["Health"])


@v1_router.get(
    "/health",
    response_model=HealthResponse,
    summary="Versioned health check",
    description="Returns OK if the application process is running (API v1).",
)
async def v1_health_check(
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    """Versioned health check under /api/v1."""
    return HealthResponse(
        status="ok",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT.value,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
