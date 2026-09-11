"""
SAMARTH AI — FastAPI Auth Dependencies

Reusable dependency functions for:
- Extracting and validating JWT access tokens
- Loading fresh user data from MongoDB (never from JWT)
- Checking permissions against the RBAC matrix
- Validating jurisdiction scope
- CSRF validation for cookie-based endpoints
"""

import logging
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.database import Database, get_database
from app.core.permissions import (
    Permission,
    build_jurisdiction_filter,
    check_jurisdiction,
    has_all_permissions,
)
from app.core.security import decode_access_token
from app.core.rate_limit import get_client_ip
from app.models.audit import AuditEventType
from app.models.user import (
    JurisdictionScope,
    UserInDB,
    UserRole,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.auth.deps")

# Bearer token scheme (auto_error=False so we can return custom 401)
bearer_scheme = HTTPBearer(auto_error=False)


# ── Core User Extraction ────────────────────────────────────────


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Database = Depends(get_database),
) -> UserInDB:
    """
    Extract JWT access token, validate it, and load the user's
    CURRENT role/jurisdiction/status from MongoDB.

    The JWT contains only sub (user_id) + sid (session_id).
    Everything else is loaded fresh from the database on every request.
    """
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Decode JWT
    try:
        payload = decode_access_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=401,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str = payload["sub"]
    session_id: str = payload["sid"]

    # Verify session is not revoked
    session_doc = await db.get_collection("sessions").find_one({
        "session_id": session_id,
        "is_revoked": False,
    })
    if not session_doc:
        raise HTTPException(
            status_code=401,
            detail="Session expired or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Load fresh user from MongoDB
    user_doc = await db.get_collection("users").find_one({"user_id": user_id})
    if not user_doc:
        raise HTTPException(
            status_code=401,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user_doc.get("is_active", False):
        # Audit access denial for disabled account
        audit = AuditService(db)
        await audit.log_event(
            AuditEventType.ACCESS_DENIED,
            user_id=user_id,
            email=user_doc.get("email"),
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
            details={"reason": "account_disabled", "path": str(request.url.path)},
        )
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Build user model from document
    jurisdiction_data = user_doc.get("jurisdiction", {})
    user = UserInDB(
        user_id=user_doc["user_id"],
        email=user_doc["email"],
        username=user_doc["username"],
        full_name=user_doc["full_name"],
        hashed_password=user_doc["hashed_password"],
        role=UserRole(user_doc["role"]),
        jurisdiction=JurisdictionScope(**jurisdiction_data),
        is_active=user_doc["is_active"],
        must_change_password=user_doc.get("must_change_password", False),
        created_at=user_doc["created_at"],
        updated_at=user_doc["updated_at"],
        last_login=user_doc.get("last_login"),
    )

    # Attach session info to request state for downstream use
    request.state.session_id = session_id
    request.state.current_user = user

    return user


async def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Database = Depends(get_database),
) -> Optional[UserInDB]:
    """
    Safely extract user from JWT if present. Returns None without raising 401
    if unauthenticated, invalid, or expired.
    """
    if credentials is None:
        return None

    try:
        payload = decode_access_token(credentials.credentials)
        user_id: str = payload.get("sub", "")
        session_id: str = payload.get("sid", "")
        if not user_id or not session_id:
            return None

        session_doc = await db.get_collection("sessions").find_one({
            "session_id": session_id,
            "is_revoked": False,
        })
        if not session_doc:
            return None

        user_doc = await db.get_collection("users").find_one({"user_id": user_id, "is_active": True})
        if not user_doc:
            return None

        jurisdiction_data = user_doc.get("jurisdiction", {})
        user = UserInDB(
            user_id=user_doc["user_id"],
            email=user_doc["email"],
            username=user_doc["username"],
            full_name=user_doc["full_name"],
            hashed_password=user_doc["hashed_password"],
            role=UserRole(user_doc["role"]),
            jurisdiction=JurisdictionScope(**jurisdiction_data),
            is_active=user_doc["is_active"],
            must_change_password=user_doc.get("must_change_password", False),
            created_at=user_doc["created_at"],
            updated_at=user_doc["updated_at"],
            last_login=user_doc.get("last_login"),
        )
        request.state.session_id = session_id
        request.state.current_user = user
        return user
    except Exception:
        return None



# ── Permission Checks ───────────────────────────────────────────


def require_permissions(*permissions: Permission):
    """
    Returns a FastAPI dependency that verifies the current user has
    ALL of the specified permissions.

    Usage:
        @router.get("/risk", dependencies=[Depends(require_permissions(Permission.READ_RISK))])
    """

    async def _check(
        request: Request,
        user: UserInDB = Depends(get_current_user),
        db: Database = Depends(get_database),
    ) -> UserInDB:
        if not has_all_permissions(user.role, set(permissions)):
            # Audit access denial
            audit = AuditService(db)
            await audit.log_event(
                AuditEventType.ACCESS_DENIED,
                user_id=user.user_id,
                email=user.email,
                ip_address=_get_ip(request),
                user_agent=request.headers.get("user-agent", ""),
                details={
                    "path": str(request.url.path),
                    "required_permissions": [p.value for p in permissions],
                    "user_role": user.role.value,
                },
            )
            raise HTTPException(
                status_code=403,
                detail="Insufficient permissions",
            )
        return user

    return _check


def require_role(*roles: UserRole):
    """
    Returns a FastAPI dependency that restricts access to specific roles.
    """

    async def _check(
        request: Request,
        user: UserInDB = Depends(get_current_user),
        db: Database = Depends(get_database),
    ) -> UserInDB:
        if user.role not in roles:
            audit = AuditService(db)
            await audit.log_event(
                AuditEventType.ACCESS_DENIED,
                user_id=user.user_id,
                email=user.email,
                ip_address=_get_ip(request),
                user_agent=request.headers.get("user-agent", ""),
                details={
                    "path": str(request.url.path),
                    "required_roles": [r.value for r in roles],
                    "user_role": user.role.value,
                },
            )
            raise HTTPException(
                status_code=403,
                detail=f"Role '{user.role.value}' is not authorized",
            )
        return user

    return _check


# ── Jurisdiction Checks ─────────────────────────────────────────


def require_jurisdiction_access(
    resource_state: Optional[str] = None,
    resource_district: Optional[str] = None,
    resource_constituency: Optional[str] = None,
    resource_task_id: Optional[str] = None,
):
    """
    Returns a FastAPI dependency that validates the user's jurisdiction
    against explicit resource identifiers.
    """

    async def _check(
        request: Request,
        user: UserInDB = Depends(get_current_user),
        db: Database = Depends(get_database),
    ) -> UserInDB:
        if not check_jurisdiction(
            user.role,
            user.jurisdiction,
            resource_state=resource_state,
            resource_district=resource_district,
            resource_constituency=resource_constituency,
            resource_task_id=resource_task_id,
        ):
            audit = AuditService(db)
            await audit.log_event(
                AuditEventType.ACCESS_DENIED,
                user_id=user.user_id,
                email=user.email,
                ip_address=_get_ip(request),
                user_agent=request.headers.get("user-agent", ""),
                details={
                    "path": str(request.url.path),
                    "reason": "jurisdiction_mismatch",
                    "user_jurisdiction": user.jurisdiction.model_dump(),
                    "resource_state": resource_state,
                    "resource_district": resource_district,
                },
            )
            raise HTTPException(
                status_code=403,
                detail="Access denied: jurisdiction mismatch",
            )
        return user

    return _check


async def get_jurisdiction_filter(
    user: UserInDB = Depends(get_current_user),
) -> dict:
    """
    Returns a MongoDB query filter dict scoped to the user's jurisdiction.
    Inject this into any DB query to enforce row-level access control.

    Usage:
        @router.get("/works")
        async def list_works(jfilter: dict = Depends(get_jurisdiction_filter)):
            results = await collection.find({**base_query, **jfilter}).to_list()
    """
    return build_jurisdiction_filter(user.role, user.jurisdiction)


# ── CSRF Validation ──────────────────────────────────────────────


async def validate_csrf(
    request: Request,
    x_csrf_token: Optional[str] = Header(None, alias="X-CSRF-Token"),
    csrf_token: Optional[str] = Cookie(None),
) -> str:
    """
    Validate CSRF token for cookie-based auth endpoints.
    The X-CSRF-Token header must match the csrf_token cookie.
    """
    if not x_csrf_token:
        raise HTTPException(
            status_code=403,
            detail="CSRF token missing (X-CSRF-Token header required)",
        )
    if not csrf_token:
        raise HTTPException(
            status_code=403,
            detail="CSRF cookie missing",
        )
    if x_csrf_token != csrf_token:
        raise HTTPException(
            status_code=403,
            detail="CSRF token mismatch",
        )
    return x_csrf_token


# ── Optional User (public/mixed endpoints) ──────────────────────


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Database = Depends(get_database),
) -> Optional[UserInDB]:
    """
    For endpoints that are accessible both authenticated and unauthenticated.
    Returns None if no valid token is present (does not raise).
    """
    if credentials is None:
        return None
    try:
        return await get_current_user(request, credentials, db)
    except HTTPException:
        return None


# ── Helpers ──────────────────────────────────────────────────────


def _get_ip(request: Request) -> str:
    """Extract the client IP using the trusted-proxy policy."""
    return get_client_ip(request)
