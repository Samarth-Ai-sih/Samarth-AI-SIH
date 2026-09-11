"""
SAMARTH AI — User & Session Models

Pydantic models for:
- User accounts (8 roles, jurisdiction scoping)
- Sessions (refresh token rotation, CSRF tracking)
- Auth request/response schemas
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


def _validate_bcrypt_password_length(value: str) -> str:
    """bcrypt only consumes 72 bytes; reject instead of silently truncating."""
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must not exceed 72 UTF-8 bytes")
    return value


# ── Role Enum ────────────────────────────────────────────────────


class UserRole(str, Enum):
    """Platform roles — ordered by privilege breadth."""
    ADMIN = "admin"
    MOSPI = "mospi"
    STATE_NODAL_OFFICER = "state_nodal_officer"
    DISTRICT_AUTHORITY = "district_authority"
    INSPECTOR = "inspector"
    MP = "mp"
    AGENCY = "agency"
    CITIZEN = "citizen"


# ── Jurisdiction ─────────────────────────────────────────────────


class JurisdictionScope(BaseModel):
    """
    Geographic / task scope constraining a user's data access.

    - state_code: for state-level roles (state_nodal_officer, etc.)
    - district_code: for district-level roles (district_authority, agency)
    - constituency: for MP role
    - assigned_task_ids: for inspector role (task-level granularity)
    """
    state_code: Optional[str] = None
    district_code: Optional[str] = None
    constituency: Optional[str] = None
    assigned_task_ids: list[str] = Field(default_factory=list)


# ── Database Document Models ─────────────────────────────────────


class UserInDB(BaseModel):
    """User document as stored in MongoDB `users` collection."""
    user_id: str
    email: str
    username: str
    full_name: str
    hashed_password: str
    role: UserRole
    jurisdiction: JurisdictionScope = Field(default_factory=JurisdictionScope)
    is_active: bool = True
    must_change_password: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login: Optional[datetime] = None


class SessionInDB(BaseModel):
    """
    Active session document in MongoDB `sessions` collection.

    Each login creates one session. Refresh token rotation updates
    the refresh_token_hash in-place. Logout sets is_revoked=True.
    """
    session_id: str
    user_id: str
    refresh_token_hash: str
    csrf_token: str
    ip_address: str = ""
    user_agent: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_revoked: bool = False
    revoked_at: Optional[datetime] = None


# ── Request Schemas ──────────────────────────────────────────────


class LoginRequest(BaseModel):
    """Login request body."""
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    _password_bytes = field_validator("password")(_validate_bcrypt_password_length)


class PasswordChangeRequest(BaseModel):
    """Password change request — requires current password."""
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    _password_bytes = field_validator("current_password", "new_password")(_validate_bcrypt_password_length)


class UserCreateRequest(BaseModel):
    """Admin-only user creation request."""
    email: EmailStr
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9._@-]+$")
    full_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole
    jurisdiction: JurisdictionScope = Field(default_factory=JurisdictionScope)
    is_active: bool = True
    must_change_password: bool = False

    _password_bytes = field_validator("password")(_validate_bcrypt_password_length)


class RoleUpdateRequest(BaseModel):
    """Update a user's role and optionally their jurisdiction."""
    role: UserRole
    jurisdiction: Optional[JurisdictionScope] = None


class StatusUpdateRequest(BaseModel):
    """Activate or deactivate a user account."""
    is_active: bool


class AdminPasswordResetRequest(BaseModel):
    """Admin-only temporary password reset for another account."""
    new_password: str = Field(min_length=8, max_length=128)

    _password_bytes = field_validator("new_password")(_validate_bcrypt_password_length)


# ── Response Schemas ─────────────────────────────────────────────


class JurisdictionResponse(BaseModel):
    """Jurisdiction info for API responses."""
    state_code: Optional[str] = None
    district_code: Optional[str] = None
    constituency: Optional[str] = None
    assigned_task_ids: list[str] = Field(default_factory=list)


class UserResponse(BaseModel):
    """Public user information — no password hash, no internal IDs."""
    user_id: str
    email: str
    username: str
    full_name: str
    role: UserRole
    jurisdiction: JurisdictionResponse
    is_active: bool
    must_change_password: bool
    created_at: datetime
    last_login: Optional[datetime] = None


class LoginResponse(BaseModel):
    """
    Login response. Note: refresh token is NEVER in the body.
    It is set as an HttpOnly cookie by the backend.
    """
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
    csrf_token: str


class TokenRefreshResponse(BaseModel):
    """Token refresh response — new access token + CSRF token."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    csrf_token: str


class UserListResponse(BaseModel):
    """Paginated user list for admin."""
    users: list[UserResponse]
    total: int


class PermissionDefinitionResponse(BaseModel):
    """A permission definition supplied by the backend-owned RBAC policy."""
    permission: str
    label: str
    description: str
    category: str


class RolePermissionResponse(BaseModel):
    """One role and its effective permissions/scope from the backend policy."""
    role: UserRole
    label: str
    scope_label: str
    permissions: list[str]


class PermissionMatrixResponse(BaseModel):
    """Read-only RBAC policy representation for the Admin UI."""
    permissions: list[PermissionDefinitionResponse]
    roles: list[RolePermissionResponse]
    policy_source: str


class MessageResponse(BaseModel):
    """Generic success message."""
    message: str
    detail: Optional[str] = None
