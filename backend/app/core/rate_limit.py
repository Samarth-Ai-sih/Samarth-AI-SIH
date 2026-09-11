"""
SAMARTH AI — Redis-Based Rate Limiting

Sliding window counter per client IP using Redis INCR + EXPIRE.
Works correctly across multiple production instances.

Falls back to allowing requests if Redis is unavailable (fail-open
for availability; rate-limit evasion is lower risk than total lockout).
"""

import logging

from fastapi import HTTPException, Request

from app.core.config import get_settings
from app.core.redis_client import get_redis_client

logger = logging.getLogger("samarth.rate_limit")


async def _check_rate_limit(request: Request, *, scope: str, maximum: int, window_seconds: int) -> None:
    """Apply one Redis-backed sliding-window limit to a privacy-safe client key."""
    client_ip = get_client_ip(request)
    key = f"samarth:rate_limit:{scope}:{client_ip}"

    try:
        redis_client = get_redis_client()
        redis = redis_client.client

        current = await redis.get(key)
        if current is not None and int(current) >= maximum:
            ttl = await redis.ttl(key)
            retry_after = max(ttl, 1)
            logger.warning("Rate limit exceeded for scope=%s (%s/%s)", scope, current, maximum)
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(retry_after)},
            )

        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)
        await pipe.execute()
    except HTTPException:
        raise
    except RuntimeError:
        logger.warning("Rate limiter unavailable for scope=%s", scope)
    except Exception as exc:
        logger.warning("Rate limiter Redis error for scope=%s: %s", scope, type(exc).__name__)


async def check_login_rate_limit(request: Request) -> None:
    """
    Check if the client IP has exceeded the login rate limit.

    Raises HTTP 429 with Retry-After header if limit exceeded.
    Used as a FastAPI dependency on the login endpoint.
    """
    settings = get_settings()
    await _check_rate_limit(
        request,
        scope="login",
        maximum=settings.RATE_LIMIT_LOGIN_MAX,
        window_seconds=settings.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
    )


async def check_public_issue_rate_limit(request: Request) -> None:
    """Throttle anonymous reports without retaining citizen identity."""
    settings = get_settings()
    await _check_rate_limit(
        request,
        scope="public_issue",
        maximum=settings.RATE_LIMIT_PUBLIC_ISSUE_MAX,
        window_seconds=settings.RATE_LIMIT_PUBLIC_ISSUE_WINDOW_SECONDS,
    )


async def check_upload_rate_limit(request: Request) -> None:
    """Throttle evidence ingestion, which is expensive to validate and hash."""
    settings = get_settings()
    await _check_rate_limit(
        request,
        scope="upload",
        maximum=settings.RATE_LIMIT_UPLOAD_MAX,
        window_seconds=settings.RATE_LIMIT_UPLOAD_WINDOW_SECONDS,
    )


async def reset_login_rate_limit(ip_address: str) -> None:
    """Reset the rate limit counter for an IP (e.g., after successful login)."""
    key = f"samarth:rate_limit:login:{ip_address}"
    try:
        redis_client = get_redis_client()
        await redis_client.client.delete(key)
    except Exception:
        pass  # Non-critical


def get_client_ip(request: Request) -> str:
    """
    Extract client IP from request, checking X-Forwarded-For
    for reverse proxy setups.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if get_settings().TRUST_PROXY_HEADERS and forwarded_for:
        # Take the first IP (client IP)
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# Backwards-compatible private alias for existing imports.
_get_client_ip = get_client_ip
