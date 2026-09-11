"""
SAMARTH AI — Auth API Endpoints

Routes:
  POST  /api/v1/auth/login            Authenticate → access token + HttpOnly refresh cookie
  POST  /api/v1/auth/logout           Revoke session (requires CSRF)
  POST  /api/v1/auth/refresh          Rotate refresh token (requires CSRF)
  GET   /api/v1/auth/me               Current user profile
  POST  /api/v1/auth/password-change  Change password (requires current password)
  GET   /api/v1/auth/sessions         List active sessions

Security:
  - Refresh token is NEVER in the response body — HttpOnly cookie only
  - CSRF double-submit: csrf_token cookie (JS-readable) + X-CSRF-Token header
  - Login is rate-limited via Redis sliding window
"""

import logging

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response
from typing import Optional

from app.core.config import get_settings
from app.core.database import Database, get_database
from app.core.dependencies import get_current_user, validate_csrf
from app.core.rate_limit import check_login_rate_limit, get_client_ip, reset_login_rate_limit
from app.models.user import (
    LoginRequest,
    LoginResponse,
    MessageResponse,
    PasswordChangeRequest,
    TokenRefreshResponse,
    UserInDB,
    UserResponse,
)
from app.services.auth_service import AuthService

logger = logging.getLogger("samarth.api.auth")

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


# ── Helpers ──────────────────────────────────────────────────────


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Set refresh token as HttpOnly, Secure, SameSite cookie."""
    settings = get_settings()
    max_age = settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=max_age,
        path="/api/v1/auth",  # Scoped to auth endpoints only
        domain=settings.cookie_domain_value,
    )


def _set_csrf_cookie(response: Response, csrf_token: str) -> None:
    """Set CSRF token as a JS-readable cookie (NOT HttpOnly)."""
    settings = get_settings()
    max_age = settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS * 86400

    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=False,  # Must be readable by JavaScript
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=max_age,
        path="/",
        domain=settings.cookie_domain_value,
    )


def _clear_auth_cookies(response: Response) -> None:
    """Clear both refresh and CSRF cookies."""
    settings = get_settings()
    response.delete_cookie(
        key="refresh_token",
        path="/api/v1/auth",
        domain=settings.cookie_domain_value,
    )
    response.delete_cookie(
        key="csrf_token",
        path="/",
        domain=settings.cookie_domain_value,
    )


# ── Login ────────────────────────────────────────────────────────


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Authenticate user",
    description=(
        "Authenticate with email + password. Returns access token in body "
        "and sets refresh token as HttpOnly cookie. "
        "Rate-limited: 5 attempts per 15 minutes per IP."
    ),
)
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    _rate_limit: None = Depends(check_login_rate_limit),
    db: Database = Depends(get_database),
):
    """Login endpoint with rate limiting."""
    ip = _get_ip(request)
    ua = request.headers.get("user-agent", "")
    svc = AuthService(db)

    try:
        user, access_token, refresh_token, expires_in, csrf_token = (
            await svc.authenticate(body.email, body.password, ip, ua)
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    # Reset rate limit counter on successful login
    await reset_login_rate_limit(ip)

    # Set cookies — refresh token is NEVER in the response body
    _set_refresh_cookie(response, refresh_token)
    _set_csrf_cookie(response, csrf_token)

    return LoginResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=AuthService.user_to_response(user),
        csrf_token=csrf_token,
    )


# ── Logout ───────────────────────────────────────────────────────


@router.post(
    "/logout",
    response_model=MessageResponse,
    summary="Logout (revoke session)",
    description="Revoke the current session and clear auth cookies. Requires CSRF token.",
)
async def logout(
    request: Request,
    response: Response,
    user: UserInDB = Depends(get_current_user),
    _csrf: str = Depends(validate_csrf),
    db: Database = Depends(get_database),
):
    """Logout — revokes the session, clears cookies."""
    session_id = getattr(request.state, "session_id", None)
    if not session_id:
        raise HTTPException(status_code=400, detail="No active session")

    svc = AuthService(db)
    await svc.logout(
        session_id=session_id,
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )

    _clear_auth_cookies(response)
    return MessageResponse(message="Logged out successfully")


# ── Refresh ──────────────────────────────────────────────────────


@router.post(
    "/refresh",
    response_model=TokenRefreshResponse,
    summary="Refresh access token",
    description=(
        "Exchange a valid refresh token cookie for a new access token "
        "and rotated refresh token. Requires CSRF token header."
    ),
)
async def refresh(
    request: Request,
    response: Response,
    refresh_token: Optional[str] = Cookie(None),
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
    db: Database = Depends(get_database),
):
    """Token refresh with rotation and CSRF validation."""
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token cookie")
    if not x_csrf_token:
        raise HTTPException(status_code=403, detail="CSRF token required")

    ip = _get_ip(request)
    ua = request.headers.get("user-agent", "")
    svc = AuthService(db)

    try:
        new_access, new_refresh, expires_in, new_csrf = await svc.refresh_tokens(
            raw_refresh_token=refresh_token,
            csrf_token_header=x_csrf_token,
            ip_address=ip,
            user_agent=ua,
        )
    except ValueError as exc:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail=str(exc))

    # Set rotated cookies
    _set_refresh_cookie(response, new_refresh)
    _set_csrf_cookie(response, new_csrf)

    return TokenRefreshResponse(
        access_token=new_access,
        expires_in=expires_in,
        csrf_token=new_csrf,
    )


# ── Me ───────────────────────────────────────────────────────────


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Current user profile",
    description="Returns the authenticated user's profile with current role and jurisdiction.",
)
async def me(user: UserInDB = Depends(get_current_user)):
    """Get current user profile — role/jurisdiction loaded fresh from DB."""
    return AuthService.user_to_response(user)


# ── Password Change ─────────────────────────────────────────────


@router.post(
    "/password-change",
    response_model=MessageResponse,
    summary="Change password",
    description=(
        "Change the current user's password. Requires the current password. "
        "All sessions are revoked after change (user must re-login)."
    ),
)
async def change_password(
    request: Request,
    response: Response,
    body: PasswordChangeRequest,
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    """Change password — revokes all sessions."""
    svc = AuthService(db)

    try:
        await svc.change_password(
            user_id=user.user_id,
            current_password=body.current_password,
            new_password=body.new_password,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _clear_auth_cookies(response)
    return MessageResponse(
        message="Password changed successfully. Please log in again.",
    )


# ── Sessions ─────────────────────────────────────────────────────


@router.get(
    "/sessions",
    summary="List active sessions",
    description="List all active (non-revoked) sessions for the current user.",
)
async def list_sessions(
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    """List active sessions for the authenticated user."""
    svc = AuthService(db)
    sessions = await svc.get_active_sessions(user.user_id)
    return {"sessions": sessions, "total": len(sessions)}


@router.post(
    "/sessions/revoke-all",
    response_model=MessageResponse,
    summary="Revoke all sessions",
    description="Revoke all active sessions for the current user (logout everywhere).",
)
async def revoke_all_sessions(
    request: Request,
    response: Response,
    user: UserInDB = Depends(get_current_user),
    _csrf: str = Depends(validate_csrf),
    db: Database = Depends(get_database),
):
    """Revoke all sessions — logout from all devices."""
    svc = AuthService(db)
    count = await svc.logout_all_sessions(
        user_id=user.user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    _clear_auth_cookies(response)
    return MessageResponse(
        message=f"All sessions revoked ({count} sessions)",
    )
