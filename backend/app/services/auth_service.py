"""
SAMARTH AI — Authentication Service

Business logic for:
- Login (credential verification → session + tokens)
- Logout (session revocation)
- Token refresh (rotation: old refresh token invalidated, new one issued)
- Password change
- Session management
- Last-admin protection
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.config import get_settings
from app.core.database import Database
from app.core.security import (
    create_access_token,
    create_refresh_token,
    generate_csrf_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.audit import AuditEventType
from app.models.user import (
    JurisdictionScope,
    SessionInDB,
    UserCreateRequest,
    UserInDB,
    UserResponse,
    UserRole,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.auth")

USERS_COLLECTION = "users"
SESSIONS_COLLECTION = "sessions"


class AuthService:
    """Core authentication and session management service."""

    def __init__(self, db: Database):
        self._db = db
        self._users = db.get_collection(USERS_COLLECTION)
        self._sessions = db.get_collection(SESSIONS_COLLECTION)
        self._audit = AuditService(db)

    # ── Login ────────────────────────────────────────────────────

    async def authenticate(
        self,
        email: str,
        password: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> tuple[UserInDB, str, str, int, str]:
        """
        Authenticate user by email + password.

        Returns (user, access_token, refresh_token, expires_in, csrf_token).
        Raises ValueError on authentication failure.
        """
        # Find user by email (case-insensitive)
        user_doc = await self._users.find_one(
            {"email": {"$regex": f"^{email}$", "$options": "i"}}
        )

        if not user_doc:
            await self._audit.log_event(
                AuditEventType.LOGIN_FAILED,
                email=email,
                ip_address=ip_address,
                user_agent=user_agent,
                details={"reason": "user_not_found"},
            )
            raise ValueError("Invalid email or password")

        user = self._doc_to_user(user_doc)

        if not user.is_active:
            await self._audit.log_event(
                AuditEventType.LOGIN_FAILED,
                user_id=user.user_id,
                email=email,
                ip_address=ip_address,
                user_agent=user_agent,
                details={"reason": "account_disabled"},
            )
            raise ValueError("Account is disabled")

        if not verify_password(password, user.hashed_password):
            await self._audit.log_event(
                AuditEventType.LOGIN_FAILED,
                user_id=user.user_id,
                email=email,
                ip_address=ip_address,
                user_agent=user_agent,
                details={"reason": "wrong_password"},
            )
            raise ValueError("Invalid email or password")

        # Create session
        session_id = str(uuid4())
        refresh_token = create_refresh_token()
        csrf_token = generate_csrf_token()
        settings = get_settings()

        session = SessionInDB(
            session_id=session_id,
            user_id=user.user_id,
            refresh_token_hash=hash_token(refresh_token),
            csrf_token=csrf_token,
            ip_address=ip_address,
            user_agent=user_agent,
            created_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS),
        )
        await self._sessions.insert_one(session.model_dump())

        # Create access token
        access_token, expires_in = create_access_token(user.user_id, session_id)

        # Update last_login
        await self._users.update_one(
            {"user_id": user.user_id},
            {"$set": {"last_login": datetime.now(timezone.utc)}},
        )

        # Audit
        await self._audit.log_event(
            AuditEventType.LOGIN,
            user_id=user.user_id,
            email=user.email,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"session_id": session_id},
        )

        return user, access_token, refresh_token, expires_in, csrf_token

    # ── Logout ───────────────────────────────────────────────────

    async def logout(
        self,
        session_id: str,
        user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> None:
        """Revoke a session (invalidates the refresh token)."""
        await self._sessions.update_one(
            {"session_id": session_id, "user_id": user_id},
            {
                "$set": {
                    "is_revoked": True,
                    "revoked_at": datetime.now(timezone.utc),
                }
            },
        )
        await self._audit.log_event(
            AuditEventType.LOGOUT,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"session_id": session_id},
        )

    async def logout_all_sessions(
        self,
        user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> int:
        """Revoke all active sessions for a user. Returns count revoked."""
        result = await self._sessions.update_many(
            {"user_id": user_id, "is_revoked": False},
            {
                "$set": {
                    "is_revoked": True,
                    "revoked_at": datetime.now(timezone.utc),
                }
            },
        )
        await self._audit.log_event(
            AuditEventType.SESSION_REVOCATION,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"sessions_revoked": result.modified_count},
        )
        return result.modified_count

    # ── Refresh (Token Rotation) ─────────────────────────────────

    async def refresh_tokens(
        self,
        raw_refresh_token: str,
        csrf_token_header: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> tuple[str, str, int, str]:
        """
        Validate refresh token, rotate it, and issue new access + refresh.

        Token rotation: the old refresh token hash is replaced with a
        new one. If the old token is reused, the session is revoked
        (potential token theft).

        Returns (new_access_token, new_refresh_token, expires_in, new_csrf_token).
        """
        token_hash = hash_token(raw_refresh_token)

        # Find the session with this refresh token hash
        session_doc = await self._sessions.find_one({
            "refresh_token_hash": token_hash,
            "is_revoked": False,
        })

        if not session_doc:
            # Possible token reuse attack — check if we've seen this hash
            # in a revoked session
            revoked = await self._sessions.find_one({
                "refresh_token_hash": token_hash,
                "is_revoked": True,
            })
            if revoked:
                # Token reuse detected! Revoke ALL sessions for this user
                logger.warning(
                    "Refresh token reuse detected for user %s — "
                    "revoking all sessions",
                    revoked.get("user_id"),
                )
                await self.logout_all_sessions(
                    revoked["user_id"],
                    ip_address=ip_address,
                    user_agent=user_agent,
                )
            raise ValueError("Invalid or expired refresh token")

        session_id = session_doc["session_id"]
        user_id = session_doc["user_id"]

        # Check session expiry
        expires_at = session_doc["expires_at"]
        # PyMongo returns BSON datetimes as naive UTC values unless its client
        # is configured with tz_aware=True. Normalize that representation before
        # comparing it with the application's aware UTC timestamps; otherwise a
        # valid refresh request raises TypeError and becomes an HTTP 500.
        if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if isinstance(expires_at, datetime) and expires_at < datetime.now(timezone.utc):
            await self._sessions.update_one(
                {"session_id": session_id},
                {"$set": {"is_revoked": True, "revoked_at": datetime.now(timezone.utc)}},
            )
            raise ValueError("Session expired")

        # Validate CSRF token
        if session_doc.get("csrf_token") != csrf_token_header:
            logger.warning(
                "CSRF mismatch on token refresh for session %s",
                session_id,
            )
            raise ValueError("CSRF token mismatch")

        # Verify user is still active
        user_doc = await self._users.find_one({"user_id": user_id})
        if not user_doc or not user_doc.get("is_active", False):
            await self._sessions.update_one(
                {"session_id": session_id},
                {"$set": {"is_revoked": True, "revoked_at": datetime.now(timezone.utc)}},
            )
            raise ValueError("User account is disabled")

        # Rotate: generate new refresh token and CSRF token
        new_refresh_token = create_refresh_token()
        new_csrf_token = generate_csrf_token()

        await self._sessions.update_one(
            {"session_id": session_id},
            {
                "$set": {
                    "refresh_token_hash": hash_token(new_refresh_token),
                    "csrf_token": new_csrf_token,
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                }
            },
        )

        # Issue new access token
        access_token, expires_in = create_access_token(user_id, session_id)

        # Audit
        await self._audit.log_event(
            AuditEventType.TOKEN_REFRESH,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"session_id": session_id},
        )

        return access_token, new_refresh_token, expires_in, new_csrf_token

    # ── User CRUD (Admin only) ───────────────────────────────────

    async def create_user(
        self,
        data: UserCreateRequest,
        created_by_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> UserInDB:
        """
        Create a new user account. No public registration — admin only.
        """
        # Check email uniqueness
        existing = await self._users.find_one(
            {"email": {"$regex": f"^{re.escape(data.email)}$", "$options": "i"}}
        )
        if existing:
            raise ValueError(f"Email {data.email} is already registered")

        # Check username uniqueness
        existing_username = await self._users.find_one(
            {"username": {"$regex": f"^{re.escape(data.username)}$", "$options": "i"}}
        )
        if existing_username:
            raise ValueError(f"Username {data.username} is already taken")

        now = datetime.now(timezone.utc)
        user = UserInDB(
            user_id=str(uuid4()),
            email=data.email.lower(),
            username=data.username.lower(),
            full_name=data.full_name,
            hashed_password=hash_password(data.password),
            role=data.role,
            jurisdiction=data.jurisdiction,
            is_active=data.is_active,
            must_change_password=data.must_change_password,
            created_at=now,
            updated_at=now,
        )

        await self._users.insert_one(user.model_dump())

        await self._audit.log_event(
            AuditEventType.USER_CREATED,
            user_id=created_by_user_id,
            target_user_id=user.user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "email": user.email,
                "role": user.role.value,
                "must_change_password": user.must_change_password,
            },
        )

        return user

    async def get_user_by_id(self, user_id: str) -> Optional[UserInDB]:
        """Load a user from the database by user_id."""
        doc = await self._users.find_one({"user_id": user_id})
        if not doc:
            return None
        return self._doc_to_user(doc)

    async def get_user_by_email(self, email: str) -> Optional[UserInDB]:
        """Load a user from the database by email."""
        doc = await self._users.find_one(
            {"email": {"$regex": f"^{email}$", "$options": "i"}}
        )
        if not doc:
            return None
        return self._doc_to_user(doc)

    async def list_users(
        self, skip: int = 0, limit: int = 50
    ) -> tuple[list[UserInDB], int]:
        """List all users (admin only). Returns (users, total)."""
        total = await self._users.count_documents({})
        cursor = (
            self._users.find({}, {"_id": 0})
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )
        docs = await cursor.to_list(length=limit)
        return [self._doc_to_user(d) for d in docs], total

    # ── Role / Status Updates ────────────────────────────────────

    async def update_user_role(
        self,
        target_user_id: str,
        new_role: UserRole,
        new_jurisdiction: Optional[JurisdictionScope],
        updated_by_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> UserInDB:
        """Update a user's role and optionally their jurisdiction."""
        target = await self.get_user_by_id(target_user_id)
        if not target:
            raise ValueError("User not found")

        old_role = target.role.value
        old_jurisdiction = target.jurisdiction.model_dump()

        update: dict[str, Any] = {
            "role": new_role.value,
            "updated_at": datetime.now(timezone.utc),
        }
        if new_jurisdiction is not None:
            update["jurisdiction"] = new_jurisdiction.model_dump()

        # Last-admin protection: if demoting an admin, check count
        if target.role == UserRole.ADMIN and new_role != UserRole.ADMIN:
            await self._check_last_admin(target_user_id)

        await self._users.update_one(
            {"user_id": target_user_id}, {"$set": update}
        )

        # Audit role change
        await self._audit.log_event(
            AuditEventType.ROLE_CHANGE,
            user_id=updated_by_user_id,
            target_user_id=target_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "old_role": old_role,
                "new_role": new_role.value,
            },
        )

        # Audit jurisdiction change if applicable
        if new_jurisdiction is not None:
            await self._audit.log_event(
                AuditEventType.JURISDICTION_CHANGE,
                user_id=updated_by_user_id,
                target_user_id=target_user_id,
                ip_address=ip_address,
                user_agent=user_agent,
                details={
                    "old_jurisdiction": old_jurisdiction,
                    "new_jurisdiction": new_jurisdiction.model_dump(),
                },
            )

        # Revoke all sessions for the target user so they re-login
        # with updated role/jurisdiction
        await self.logout_all_sessions(target_user_id)

        return await self.get_user_by_id(target_user_id)  # type: ignore

    async def update_user_status(
        self,
        target_user_id: str,
        is_active: bool,
        updated_by_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> UserInDB:
        """Activate or deactivate a user account."""
        target = await self.get_user_by_id(target_user_id)
        if not target:
            raise ValueError("User not found")

        # Last-admin protection
        if not is_active and target.role == UserRole.ADMIN:
            await self._check_last_admin(target_user_id)

        await self._users.update_one(
            {"user_id": target_user_id},
            {
                "$set": {
                    "is_active": is_active,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        await self._audit.log_event(
            AuditEventType.USER_STATUS_CHANGE,
            user_id=updated_by_user_id,
            target_user_id=target_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "old_status": target.is_active,
                "new_status": is_active,
            },
        )

        # If deactivating, revoke all sessions
        if not is_active:
            await self.logout_all_sessions(target_user_id)

        return await self.get_user_by_id(target_user_id)  # type: ignore

    async def admin_reset_password(
        self,
        target_user_id: str,
        new_password: str,
        updated_by_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> UserInDB:
        """Set a temporary password and revoke every target session."""
        target = await self.get_user_by_id(target_user_id)
        if not target:
            raise ValueError("User not found")

        await self._users.update_one(
            {"user_id": target_user_id},
            {"$set": {
                "hashed_password": hash_password(new_password),
                "must_change_password": True,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        await self._audit.log_event(
            AuditEventType.PASSWORD_CHANGE,
            user_id=updated_by_user_id,
            target_user_id=target_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"reset_by_admin": True},
        )
        await self.logout_all_sessions(target_user_id, ip_address, user_agent)
        return await self.get_user_by_id(target_user_id)  # type: ignore

    # ── Password Change ──────────────────────────────────────────

    async def change_password(
        self,
        user_id: str,
        current_password: str,
        new_password: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> None:
        """
        Change a user's password. Requires the current password.
        Revokes all other sessions after change.
        """
        user = await self.get_user_by_id(user_id)
        if not user:
            raise ValueError("User not found")

        if not verify_password(current_password, user.hashed_password):
            raise ValueError("Current password is incorrect")

        if current_password == new_password:
            raise ValueError("New password must be different from current password")

        await self._users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "hashed_password": hash_password(new_password),
                    "must_change_password": False,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        await self._audit.log_event(
            AuditEventType.PASSWORD_CHANGE,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        # Revoke all sessions except current (force re-login on other devices)
        # Actually, revoke ALL sessions — user re-logs in with new password
        await self.logout_all_sessions(user_id, ip_address, user_agent)

    # ── Session Queries ──────────────────────────────────────────

    async def get_active_sessions(self, user_id: str) -> list[dict[str, Any]]:
        """List active (non-revoked) sessions for a user."""
        cursor = self._sessions.find(
            {"user_id": user_id, "is_revoked": False},
            {
                "_id": 0,
                "refresh_token_hash": 0,
                "csrf_token": 0,
            },
        ).sort("created_at", -1)
        return await cursor.to_list(length=100)

    # ── Database Indexes ─────────────────────────────────────────

    async def ensure_indexes(self) -> None:
        """Create required MongoDB indexes."""
        # Users
        await self._users.create_index("user_id", unique=True)
        await self._users.create_index("email", unique=True)
        await self._users.create_index("username", unique=True)
        await self._users.create_index("role")

        # Sessions
        await self._sessions.create_index("session_id", unique=True)
        await self._sessions.create_index("user_id")
        await self._sessions.create_index("refresh_token_hash")
        await self._sessions.create_index(
            "expires_at",
            expireAfterSeconds=0,  # TTL: auto-delete expired sessions
        )

        logger.info("Auth indexes ensured")

    # ── Helpers ───────────────────────────────────────────────────

    async def _check_last_admin(self, exclude_user_id: str) -> None:
        """
        Prevent deactivating or demoting the last active admin.
        Raises ValueError if this would leave zero active admins.
        """
        active_admin_count = await self._users.count_documents({
            "role": UserRole.ADMIN.value,
            "is_active": True,
            "user_id": {"$ne": exclude_user_id},
        })
        if active_admin_count < 1:
            raise ValueError(
                "Cannot deactivate or demote the last active admin account"
            )

    @staticmethod
    def _doc_to_user(doc: dict[str, Any]) -> UserInDB:
        """Convert a MongoDB document to a UserInDB model."""
        jurisdiction_data = doc.get("jurisdiction", {})
        return UserInDB(
            user_id=doc["user_id"],
            email=doc["email"],
            username=doc["username"],
            full_name=doc["full_name"],
            hashed_password=doc["hashed_password"],
            role=UserRole(doc["role"]),
            jurisdiction=JurisdictionScope(**jurisdiction_data),
            is_active=doc.get("is_active", True),
            must_change_password=doc.get("must_change_password", False),
            created_at=doc.get("created_at", datetime.now(timezone.utc)),
            updated_at=doc.get("updated_at", datetime.now(timezone.utc)),
            last_login=doc.get("last_login"),
        )

    @staticmethod
    def user_to_response(user: UserInDB) -> UserResponse:
        """Convert a UserInDB to a public UserResponse (no password hash)."""
        from app.models.user import JurisdictionResponse

        return UserResponse(
            user_id=user.user_id,
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            jurisdiction=JurisdictionResponse(**user.jurisdiction.model_dump()),
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            created_at=user.created_at,
            last_login=user.last_login,
        )
