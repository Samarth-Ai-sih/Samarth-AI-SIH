"""
SAMARTH AI — Security Middleware

Production-hardened middleware stack:
- Request ID tracking (X-Request-ID)
- Security headers (HSTS, X-Frame-Options, etc.)
- Request body size limits
- Generic error responses in production (no stack traces)
"""

import logging
import re
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings

logger = logging.getLogger("samarth.middleware")
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Attach a unique request ID to every request/response.
    Accepts X-Request-ID from upstream proxies or generates a new one.
    """

    async def dispatch(self, request: Request, call_next):
        supplied_request_id = request.headers.get("X-Request-ID", "")
        request_id = (
            supplied_request_id
            if _REQUEST_ID_PATTERN.fullmatch(supplied_request_id)
            else str(uuid.uuid4())
        )
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
        )
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        # The API serves JSON only; no browser resources need to be loaded from it.
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )

        settings = get_settings()
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests with Content-Length exceeding the configured limit."""

    async def dispatch(self, request: Request, call_next):
        settings = get_settings()
        max_bytes = settings.MAX_REQUEST_SIZE_MB * 1024 * 1024
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                declared_size = int(content_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header"})
            if declared_size < 0:
                return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header"})
            if declared_size > max_bytes:
                return JSONResponse(
                    status_code=413,
                    content={
                        "detail": (
                            f"Request body too large. "
                            f"Maximum size: {settings.MAX_REQUEST_SIZE_MB}MB"
                        )
                    },
                )
        return await call_next(request)


class GenericErrorMiddleware(BaseHTTPMiddleware):
    """
    In production, mask internal error details in 500 responses.
    Always includes the request ID for log correlation.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            settings = get_settings()
            request_id = getattr(request.state, "request_id", "unknown")
            logger.error(
                "Unhandled error [request_id=%s]: %s",
                request_id,
                exc,
                exc_info=True,
            )
            if settings.is_production:
                return JSONResponse(
                    status_code=500,
                    content={
                        "detail": "An internal error occurred.",
                        "request_id": request_id,
                    },
                )
            # In development, re-raise for detailed error page
            raise
