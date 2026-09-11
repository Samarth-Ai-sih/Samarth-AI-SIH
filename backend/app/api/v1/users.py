"""
SAMARTH AI — User Management API (Admin Only)

Routes:
  GET    /api/v1/users              List all users
  POST   /api/v1/users              Create a new user (no public registration)
  GET    /api/v1/users/{user_id}    Get user details
  PATCH  /api/v1/users/{user_id}/role      Update role + jurisdiction
  PATCH  /api/v1/users/{user_id}/status    Activate / deactivate

All endpoints require the `admin` role.
Last-admin protection prevents deactivating or demoting the only active admin.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.core.database import Database, get_database
from app.core.dependencies import require_role
from app.core.rate_limit import get_client_ip
from app.models.user import (
    AdminPasswordResetRequest,
    MessageResponse,
    PermissionDefinitionResponse,
    PermissionMatrixResponse,
    RoleUpdateRequest,
    RolePermissionResponse,
    StatusUpdateRequest,
    UserCreateRequest,
    UserInDB,
    UserListResponse,
    UserResponse,
    UserRole,
)
from app.models.audit import AuditListResponse, AuditLogResponse
from app.core.permissions import PERMISSION_METADATA, ROLE_LABELS, ROLE_PERMISSIONS, ROLE_SCOPE_LABELS, Permission
from app.services.auth_service import AuthService
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.api.users")

router = APIRouter(prefix="/api/v1/users", tags=["User Management"])

# All endpoints require admin role
admin_dep = require_role(UserRole.ADMIN)


def _get_ip(request: Request) -> str:
    return get_client_ip(request)


@router.get(
    "/permissions",
    response_model=PermissionMatrixResponse,
    summary="Read the effective RBAC permission matrix",
    description="Admin-only. UI data is derived from the same backend policy used for authorization.",
)
async def get_permission_matrix(admin: UserInDB = Depends(admin_dep)):
    return PermissionMatrixResponse(
        permissions=[
            PermissionDefinitionResponse(permission=permission.value, **PERMISSION_METADATA[permission])
            for permission in Permission
        ],
        roles=[
            RolePermissionResponse(
                role=role,
                label=ROLE_LABELS[role],
                scope_label=ROLE_SCOPE_LABELS[role],
                permissions=sorted(permission.value for permission in ROLE_PERMISSIONS[role]),
            )
            for role in UserRole
        ],
        policy_source="backend.app.core.permissions.ROLE_PERMISSIONS",
    )


# ── List Users ───────────────────────────────────────────────────


@router.get(
    "",
    response_model=UserListResponse,
    summary="List all users",
    description="Admin-only. List all user accounts with pagination.",
)
async def list_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    svc = AuthService(db)
    users, total = await svc.list_users(skip=skip, limit=limit)
    return UserListResponse(
        users=[AuthService.user_to_response(u) for u in users],
        total=total,
    )


# ── Create User ──────────────────────────────────────────────────


@router.post(
    "",
    response_model=UserResponse,
    status_code=201,
    summary="Create a new user",
    description=(
        "Admin-only. No public registration. "
        "Set must_change_password=true to force password change on first login."
    ),
)
async def create_user(
    request: Request,
    body: UserCreateRequest,
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    svc = AuthService(db)
    try:
        user = await svc.create_user(
            data=body,
            created_by_user_id=admin.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return AuthService.user_to_response(user)


@router.post(
    "/{user_id}/password-reset",
    response_model=UserResponse,
    summary="Reset a user's password",
    description="Admin-only. Sets a temporary password, forces a change at next sign-in, and revokes all sessions.",
)
async def reset_user_password(
    user_id: str,
    request: Request,
    body: AdminPasswordResetRequest,
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    try:
        user = await AuthService(db).admin_reset_password(
            target_user_id=user_id,
            new_password=body.new_password,
            updated_by_user_id=admin.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AuthService.user_to_response(user)


@router.post(
    "/{user_id}/sessions/revoke",
    response_model=MessageResponse,
    summary="Revoke a user's sessions",
    description="Admin-only. Forces the target account to sign in again.",
)
async def revoke_user_sessions(
    user_id: str,
    request: Request,
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    svc = AuthService(db)
    if not await svc.get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    count = await svc.logout_all_sessions(
        user_id=user_id,
        ip_address=_get_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    return MessageResponse(message=f"Revoked {count} active session(s)")


@router.get(
    "/{user_id}/audit",
    response_model=AuditListResponse,
    summary="Read a user's audit history",
    description="Admin-only. Returns user-management and security audit events targeting the account.",
)
async def get_user_audit_history(
    user_id: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    if not await AuthService(db).get_user_by_id(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    logs, total = await AuditService(db).get_logs(target_user_id=user_id, skip=skip, limit=limit)
    return AuditListResponse(logs=[AuditLogResponse(**log) for log in logs], total=total)


# ── Get User ─────────────────────────────────────────────────────


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    summary="Get user details",
    description="Admin-only. Get a specific user by their ID.",
)
async def get_user(
    user_id: str,
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    svc = AuthService(db)
    user = await svc.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return AuthService.user_to_response(user)


# ── Update Role ──────────────────────────────────────────────────


@router.patch(
    "/{user_id}/role",
    response_model=UserResponse,
    summary="Update user role",
    description=(
        "Admin-only. Update a user's role and optionally their jurisdiction. "
        "All active sessions for the target user are revoked (forces re-login). "
        "Last-admin protection: cannot demote the only active admin."
    ),
)
async def update_role(
    user_id: str,
    request: Request,
    body: RoleUpdateRequest,
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    svc = AuthService(db)
    try:
        updated = await svc.update_user_role(
            target_user_id=user_id,
            new_role=body.role,
            new_jurisdiction=body.jurisdiction,
            updated_by_user_id=admin.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return AuthService.user_to_response(updated)


# ── Update Status ────────────────────────────────────────────────


@router.patch(
    "/{user_id}/status",
    response_model=UserResponse,
    summary="Activate / deactivate user",
    description=(
        "Admin-only. Toggle a user's active status. "
        "Deactivation revokes all active sessions immediately. "
        "Last-admin protection: cannot deactivate the only active admin."
    ),
)
async def update_status(
    user_id: str,
    request: Request,
    body: StatusUpdateRequest,
    admin: UserInDB = Depends(admin_dep),
    db: Database = Depends(get_database),
):
    svc = AuthService(db)
    try:
        updated = await svc.update_user_status(
            target_user_id=user_id,
            is_active=body.is_active,
            updated_by_user_id=admin.user_id,
            ip_address=_get_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return AuthService.user_to_response(updated)
