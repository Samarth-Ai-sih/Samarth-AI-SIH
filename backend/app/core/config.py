"""
SAMARTH AI — Application Configuration

Strict environment validation using Pydantic Settings.
All required variables must be set via .env or environment.
"""

from enum import Enum
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Environment(str, Enum):
    """Deployment environment."""
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    """
    Application settings with strict validation.
    All values are loaded from environment variables or .env file.
    """

    model_config = SettingsConfigDict(
        # Support the repository-level Compose configuration as well as a
        # backend-local file for direct Python commands. Actual process
        # environment values still take precedence in deployed services.
        env_file=(PROJECT_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────
    APP_NAME: str = "SAMARTH AI"
    APP_VERSION: str = "0.1.0"
    APP_DESCRIPTION: str = (
        "MPLADS Risk Intelligence & Assurance Platform — "
        "Detect Early. Verify on Ground. Deliver Public Assets on Time."
    )
    ENVIRONMENT: Environment = Environment.DEVELOPMENT
    DEBUG: bool = False

    # ── MongoDB Atlas (required) ─────────────────────────────────
    MONGODB_URI: str = Field(
        ...,
        description="MongoDB Atlas connection string (mongodb+srv://...)",
    )
    MONGODB_DB_NAME: str = Field(
        default="samarth_ai",
        description="Primary database name",
    )
    MONGODB_MIN_POOL_SIZE: int = 5
    MONGODB_MAX_POOL_SIZE: int = 50
    MONGODB_DEV_FALLBACK_URI: str = Field(
        default="",
        description=(
            "Optional local MongoDB URI used only when the primary database is "
            "unreachable in development. Never enabled in staging or production."
        ),
    )
    MONGODB_USE_DEV_FALLBACK: bool = Field(
        default=False,
        description=(
            "Use the explicit local MongoDB URI as the development database. "
            "This is rejected outside development."
        ),
    )

    # ── Redis ────────────────────────────────────────────────────
    REDIS_URL: str = Field(
        default="redis://redis:6379/0",
        description="Redis connection URL",
    )

    # ── Celery ───────────────────────────────────────────────────
    CELERY_BROKER_URL: str = Field(
        default="redis://redis:6379/1",
        description="Celery broker URL",
    )
    CELERY_RESULT_BACKEND: str = Field(
        default="redis://redis:6379/2",
        description="Celery result backend URL",
    )
    CELERY_TASK_MAX_RETRIES: int = Field(default=4, ge=0, le=10)
    CELERY_SLA_WARNING_HOURS: int = Field(default=24, ge=1, le=720)

    # ── Notification adapters ──────────────────────────────────
    # External adapters are disabled unless deployment operations explicitly
    # enables a vetted provider. In-app delivery remains available by default.
    NOTIFICATION_EMAIL_ENABLED: bool = False
    NOTIFICATION_SMS_ENABLED: bool = False
    NOTIFICATION_WHATSAPP_ENABLED: bool = False

    # ── JWT Authentication ───────────────────────────────────────
    JWT_SECRET_KEY: str = Field(
        ...,
        description="Secret key for JWT token signing",
    )
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Rate Limiting ────────────────────────────────────────────
    RATE_LIMIT_LOGIN_MAX: int = Field(
        default=5,
        description="Max login attempts per IP within the window",
    )
    RATE_LIMIT_LOGIN_WINDOW_SECONDS: int = Field(
        default=900,
        description="Sliding window in seconds for login rate limiting",
    )
    RATE_LIMIT_PUBLIC_ISSUE_MAX: int = Field(
        default=10,
        ge=1,
        le=1000,
        description="Maximum anonymous citizen issue submissions per IP within the window.",
    )
    RATE_LIMIT_PUBLIC_ISSUE_WINDOW_SECONDS: int = Field(default=3600, ge=60, le=86_400)
    RATE_LIMIT_UPLOAD_MAX: int = Field(
        default=30,
        ge=1,
        le=1000,
        description="Maximum evidence uploads per IP within the window.",
    )
    RATE_LIMIT_UPLOAD_WINDOW_SECONDS: int = Field(default=900, ge=60, le=86_400)
    TRUST_PROXY_HEADERS: bool = Field(
        default=False,
        description="Trust X-Forwarded-For only when the deployment's reverse proxy is trusted.",
    )

    # ── CSRF ─────────────────────────────────────────────────────
    CSRF_SECRET_KEY: str = Field(
        default="",
        description="CSRF secret key; falls back to JWT_SECRET_KEY if empty",
    )

    # ── Session & Cookies ────────────────────────────────────────
    SESSION_MAX_AGE_DAYS: int = Field(default=30, description="Max session lifetime in days")
    COOKIE_DOMAIN: str = Field(default="", description="Cookie domain for production")

    # ── Security ─────────────────────────────────────────────────
    MAX_REQUEST_SIZE_MB: int = Field(default=10, description="Max request body size in MB")

    # ── Audit ────────────────────────────────────────────────────
    AUDIT_LOG_RETENTION_DAYS: int = Field(
        default=0,
        description="Audit log retention in days. 0 = infinite (no auto-deletion).",
    )

    # ── Seed Users ───────────────────────────────────────────────
    SEED_ADMIN_EMAIL: str = Field(default="", description="Seed admin email (from env)")
    SEED_ADMIN_PASSWORD: str = Field(default="", description="Seed admin password (from env)")
    SEED_FORCE_PASSWORD_CHANGE: bool = Field(
        default=True,
        description="Force password change on first login for seeded users",
    )

    # ── CORS ─────────────────────────────────────────────────────
    CORS_ORIGINS: str = Field(
        default="http://localhost:3000",
        description="Comma-separated list of allowed CORS origins",
    )

    # ── Cloudinary ───────────────────────────────────────────────
    CLOUDINARY_CLOUD_NAME: str = Field(default="", description="Cloudinary cloud name")
    CLOUDINARY_API_KEY: str = Field(default="", description="Cloudinary API key")
    CLOUDINARY_API_SECRET: str = Field(default="", description="Cloudinary API secret")

    # ── Evidence verification ───────────────────────────────────
    EVIDENCE_GPS_TOLERANCE_METERS: float = Field(
        default=500.0,
        gt=0,
        description="Maximum site-photo GPS distance before review is recommended.",
    )
    EVIDENCE_TIMESTAMP_TOLERANCE_DAYS: int = Field(
        default=30,
        ge=0,
        description="Allowed lead time before a work recommendation for captured evidence.",
    )
    EVIDENCE_PHASH_DISTANCE_THRESHOLD: int = Field(
        default=8,
        ge=0,
        le=64,
        description="Maximum perceptual-hash Hamming distance for a possible image reuse signal.",
    )

    # ── Logging ──────────────────────────────────────────────────
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"  # "json" or "text"

    # ── Server ───────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # ── Computed properties ──────────────────────────────────────

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse comma-separated CORS origins into a list."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == Environment.DEVELOPMENT

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == Environment.PRODUCTION

    @property
    def csrf_secret(self) -> str:
        """CSRF secret; defaults to JWT_SECRET_KEY if not set."""
        return self.CSRF_SECRET_KEY or self.JWT_SECRET_KEY

    @property
    def cookie_secure(self) -> bool:
        """Only set Secure flag on cookies when HTTPS is used."""
        return self.is_production and any(origin.startswith("https://") for origin in self.cors_origins_list)

    @property
    def cookie_domain_value(self) -> str | None:
        """Return cookie domain or None for localhost."""
        return self.COOKIE_DOMAIN or None

    @model_validator(mode="after")
    def validate_deployment_security(self) -> "Settings":
        """Reject insecure CORS and debug combinations before the app starts."""
        origins = self.cors_origins_list
        if self.is_production and self.DEBUG:
            raise ValueError("DEBUG must be disabled in production")
        if self.is_production and not origins:
            raise ValueError("CORS_ORIGINS must contain at least one explicit origin in production")
        if self.is_production and any(
            not (
                origin.startswith("https://")
                or origin.startswith("http://localhost")
                or origin.startswith("http://127.0.0.1")
                or (
                    urlparse(origin).hostname
                    and all(part.isdigit() for part in urlparse(origin).hostname.split("."))
                )
            )
            for origin in origins
        ):
            raise ValueError("CORS_ORIGINS must use HTTPS origins or IP addresses in production")
        if self.is_production and not self.MONGODB_URI.startswith("mongodb+srv://"):
            raise ValueError("MONGODB_URI must use a MongoDB Atlas SRV URI in production")
        if not self.is_development and (
            self.MONGODB_DEV_FALLBACK_URI or self.MONGODB_USE_DEV_FALLBACK
        ):
            raise ValueError(
                "MONGODB_DEV_FALLBACK_URI and MONGODB_USE_DEV_FALLBACK are development-only"
            )
        if self.MONGODB_USE_DEV_FALLBACK and not self.MONGODB_DEV_FALLBACK_URI:
            raise ValueError(
                "MONGODB_USE_DEV_FALLBACK requires MONGODB_DEV_FALLBACK_URI"
            )
        storage_values = {
            "CLOUDINARY_CLOUD_NAME": self.CLOUDINARY_CLOUD_NAME,
            "CLOUDINARY_API_KEY": self.CLOUDINARY_API_KEY,
            "CLOUDINARY_API_SECRET": self.CLOUDINARY_API_SECRET,
        }
        invalid_storage_values = [
            key for key, value in storage_values.items()
            if not value or "REPLACE" in value.upper() or "CHANGE_ME" in value.upper()
        ]
        if self.is_production and invalid_storage_values:
            raise ValueError(
                "Production evidence storage requires configured Cloudinary credentials: "
                + ", ".join(invalid_storage_values)
            )
        return self

    @field_validator("MONGODB_URI")
    @classmethod
    def validate_mongodb_uri(cls, v: str) -> str:
        if not v.startswith(("mongodb://", "mongodb+srv://")):
            raise ValueError("MONGODB_URI must start with 'mongodb://' or 'mongodb+srv://'")
        return v

    @field_validator("MONGODB_DEV_FALLBACK_URI")
    @classmethod
    def validate_mongodb_dev_fallback_uri(cls, v: str) -> str:
        value = v.strip()
        if value and not value.startswith("mongodb://"):
            raise ValueError("MONGODB_DEV_FALLBACK_URI must start with 'mongodb://'")
        return value

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_jwt_secret(cls, v: str) -> str:
        if len(v) < 16:
            raise ValueError("JWT_SECRET_KEY must be at least 16 characters")
        return v

    @field_validator("CORS_ORIGINS")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        """Allow only explicit HTTP(S) origins; wildcard CORS is never safe with cookies."""
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        for origin in origins:
            parsed = urlparse(origin)
            if (
                origin == "*"
                or parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path not in {"", "/"}
                or parsed.params
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
            ):
                raise ValueError("CORS_ORIGINS must contain explicit http(s) origins without paths or wildcards")
        return ",".join(origins)


@lru_cache()
def get_settings() -> Settings:
    """
    Cached settings instance.
    Raises ValidationError on startup if required env vars are missing.
    """
    return Settings()
