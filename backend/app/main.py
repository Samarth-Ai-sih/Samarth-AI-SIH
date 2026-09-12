"""
SAMARTH AI — FastAPI Application Entry Point

Configures the FastAPI application with:
- Lifespan-managed MongoDB + Redis connections
- Security middleware stack (request ID, headers, size limits, error masking)
- CORS middleware
- Structured JSON logging
- Health check routes
- Auth, user management, and ingestion routes
- MongoDB index creation on startup
- Graceful startup and shutdown
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings, Settings
from app.core.database import Database, set_database
from app.core.logging_config import setup_logging
from app.core.middleware import (
    GenericErrorMiddleware,
    RequestIdMiddleware,
    RequestSizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.redis_client import RedisClient, set_redis_client
from app.api.v1.health import router as health_router, v1_router as v1_health_router
from app.api.v1.ingestion import router as ingestion_router
from app.api.v1.auth import router as auth_router
from app.api.v1.users import router as users_router
from app.api.v1.works import router as works_router
from app.api.v1.compliance import router as compliance_router
from app.api.v1.risk import router as risk_router
from app.api.v1.financial_intelligence import router as financial_intelligence_router
from app.api.v1.duplicates import router as duplicate_router
from app.api.v1.evidence import router as evidence_router
from app.api.v1.cases import router as case_router
from app.api.v1.public import router as public_router
from app.api.v1.citizen_reports import router as citizen_reports_router
from app.api.v1.background import router as background_router
from app.api.v1.anomalies import router as anomalies_router
from app.api.v1.mospi import router as mospi_router

logger = logging.getLogger("samarth.app")


async def _ensure_indexes(db: Database) -> None:
    """Create MongoDB indexes for auth, audit, works, compliance, risk, ML, and financial analytics."""
    from app.services.auth_service import AuthService
    from app.services.audit_service import AuditService
    from app.services.work_service import WorkService
    from app.services.compliance_service import ComplianceService
    from app.services.risk_service import RiskScoringService
    from app.ml.model_registry import ModelRegistry
    from app.services.financial_intelligence_service import FinancialIntelligenceService
    from app.services.duplicate_detection_service import DuplicateDetectionService
    from app.services.evidence_verification_service import EvidenceVerificationService
    from app.services.case_management_service import CaseManagementService
    from app.services.citizen_portal_service import CitizenPortalService
    from app.services.background_job_service import BackgroundJobService
    from app.services.notification_service import NotificationService
    from app.services.mospi_service import MoSPIService

    auth_svc = AuthService(db)
    audit_svc = AuditService(db)
    work_svc = WorkService(db)
    compliance_svc = ComplianceService(db)
    risk_svc = RiskScoringService(db)
    model_registry = ModelRegistry(db)
    financial_intelligence_svc = FinancialIntelligenceService(db)
    duplicate_detection_svc = DuplicateDetectionService(db)
    evidence_verification_svc = EvidenceVerificationService(
        db,
        gps_tolerance_meters=get_settings().EVIDENCE_GPS_TOLERANCE_METERS,
        timestamp_tolerance_days=get_settings().EVIDENCE_TIMESTAMP_TOLERANCE_DAYS,
        phash_distance_threshold=get_settings().EVIDENCE_PHASH_DISTANCE_THRESHOLD,
    )
    case_management_svc = CaseManagementService(db)
    citizen_portal_svc = CitizenPortalService(db)
    background_job_svc = BackgroundJobService(db)
    notification_svc = NotificationService(db)

    await auth_svc.ensure_indexes()
    await audit_svc.ensure_indexes()
    await work_svc.ensure_indexes()
    await compliance_svc.ensure_indexes()
    await risk_svc.ensure_indexes()
    await model_registry.ensure_indexes()
    await financial_intelligence_svc.ensure_indexes()
    await duplicate_detection_svc.ensure_indexes()
    await evidence_verification_svc.ensure_indexes()
    await case_management_svc.ensure_indexes()
    await citizen_portal_svc.ensure_indexes()
    await background_job_svc.ensure_indexes()
    await notification_svc.ensure_indexes()
    await MoSPIService(db).ensure_defaults()
    logger.info("MongoDB indexes and MoSPI defaults ensured")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Startup:
      - Configure logging
      - Connect to MongoDB Atlas
      - Connect to Redis
      - Create database indexes
      - (Future: initialize Celery, etc.)

    Shutdown:
      - Disconnect from Redis
      - Disconnect from MongoDB
      - Clean up resources
    """
    settings = get_settings()
    setup_logging(settings)

    logger.info(
        "Starting %s v%s [%s]",
        settings.APP_NAME,
        settings.APP_VERSION,
        settings.ENVIRONMENT.value,
    )

    db: Database | None = None
    redis: RedisClient | None = None

    # ── Startup ──────────────────────────────────────────────
    try:
        # MongoDB
        db = Database(settings)
        await db.connect()
        set_database(db)
        logger.info("MongoDB connection ready")

        # Redis
        redis = RedisClient(settings)
        try:
            await redis.connect()
            set_redis_client(redis)
            logger.info("Redis connection ready")
        except Exception as exc:
            logger.warning(
                "Redis connection failed: %s. "
                "Rate limiting will be degraded.",
                exc,
            )

        # Indexes
        if db:
            try:
                await _ensure_indexes(db)
            except Exception as exc:
                logger.warning("Index creation failed: %s", exc)

        logger.info("All startup tasks completed successfully")
    except Exception as exc:
        logger.error(
            "Startup dependency check failed: %s. "
            "Server will start but /ready will report degraded.",
            exc,
        )

    yield

    # ── Shutdown ─────────────────────────────────────────────
    logger.info("Shutting down %s", settings.APP_NAME)
    if redis:
        await redis.disconnect()
    if db:
        await db.disconnect()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description=settings.APP_DESCRIPTION,
        lifespan=lifespan,
        docs_url="/docs" if settings.is_development else None,
        redoc_url="/redoc" if settings.is_development else None,
        openapi_url="/openapi.json" if settings.is_development else None,
    )

    # ── Security Middleware (order matters: outermost first) ──
    # GenericErrorMiddleware must be outermost to catch all errors
    app.add_middleware(GenericErrorMiddleware)
    app.add_middleware(RequestSizeLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    # ── CORS ─────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-CSRF-Token",
        ],
        expose_headers=["X-Request-ID"],
    )

    # ── Routes ───────────────────────────────────────────────
    # Health (public)
    app.include_router(health_router)
    app.include_router(v1_health_router)

    # Auth (public login, protected logout/refresh/me)
    app.include_router(auth_router)

    # Public-safe citizen work discovery and anonymous social-audit reporting
    app.include_router(public_router)

    # User management (admin only)
    app.include_router(users_router)

    # Ingestion (requires auth + UPLOAD_CSV permission)
    app.include_router(ingestion_router)

    # Works (requires auth + READ_WORKS/WRITE_WORKS)
    app.include_router(works_router)

    # Compliance engine (requires auth + READ_COMPLIANCE/WRITE_COMPLIANCE)
    app.include_router(compliance_router)

    # Composite risk scoring (requires auth + READ_RISK/WRITE_RISK)
    app.include_router(risk_router)

    # Financial intelligence (requires auth + READ_WORKS and jurisdiction scope)
    app.include_router(financial_intelligence_router)

    # Possible duplicate-work detection and manual review
    app.include_router(duplicate_router)

    # Private evidence verification (citizen accounts have no evidence permission)
    app.include_router(evidence_router)

    # Case lifecycle and assigned inspector workflow
    app.include_router(case_router)

    # Restricted District Authority moderation of citizen reports
    app.include_router(citizen_reports_router)

    # Durable Celery jobs, user notification preferences, and manual escalation fallback
    app.include_router(background_router)

    # Anomaly & Fraud Detection, Verification Routing, and 'What Happened in This Project' Story Dossier
    app.include_router(anomalies_router)

    # MoSPI Executive Command Center (Macro Telemetry, Benchmarking, Quotas, Releases, Portal Sync)
    app.include_router(mospi_router)

    return app


# Create the application instance
app = create_app()
