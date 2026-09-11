"""
SAMARTH AI — Phase 4 Auth & RBAC Test Suite

Comprehensive tests covering:
- Auth flows: login, logout, refresh, password change
- Expired and revoked tokens
- Disabled users
- Role changes after login
- RBAC: permission checks for all 8 roles
- Jurisdiction: cross-state, cross-district, cross-constituency
- Inspector task restrictions
- CSRF protection
- Redis rate limiting
- Last-admin protection
- IDOR prevention
"""

import os
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

# ── Test environment setup ───────────────────────────────────────
os.environ.setdefault("MONGODB_URI", "mongodb+srv://test:test@localhost/?appName=test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-minimum-16-chars-for-validation")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ENVIRONMENT", "development")

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.database import get_database
from app.core.security import (
    create_access_token,
    create_refresh_token,
    generate_csrf_token,
    hash_password,
    hash_token,
)
from app.models.user import UserRole, JurisdictionScope
from app.core.permissions import (
    Permission,
    has_permission,
    has_all_permissions,
    check_jurisdiction,
    build_jurisdiction_filter,
    ROLE_PERMISSIONS,
)
from app.services.auth_service import AuthService


# ── Fixtures & Helpers ───────────────────────────────────────────


def make_user_doc(
    role: str = "admin",
    state_code: str = None,
    district_code: str = None,
    constituency: str = None,
    assigned_task_ids: list = None,
    is_active: bool = True,
    must_change_password: bool = False,
    user_id: str = None,
):
    """Create a mock user document."""
    return {
        "user_id": user_id or str(uuid4()),
        "email": f"{role}@test.samarth.gov.in",
        "username": f"test_{role}",
        "full_name": f"Test {role.title()}",
        "hashed_password": hash_password("Test@1234567"),
        "role": role,
        "jurisdiction": {
            "state_code": state_code,
            "district_code": district_code,
            "constituency": constituency,
            "assigned_task_ids": assigned_task_ids or [],
        },
        "is_active": is_active,
        "must_change_password": must_change_password,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
        "last_login": None,
    }


class MockCollection:
    """Mock MongoDB collection that routes calls to AsyncMock."""

    def __init__(self):
        self.find_one = AsyncMock(return_value=None)
        self.insert_one = AsyncMock()
        self.update_one = AsyncMock()
        self.update_many = AsyncMock(return_value=MagicMock(modified_count=0))
        self.count_documents = AsyncMock(return_value=0)
        self.delete_one = AsyncMock()
        self._find_mock = AsyncMock()

    def find(self, *args, **kwargs):
        cursor = MagicMock()
        cursor.sort = MagicMock(return_value=cursor)
        cursor.skip = MagicMock(return_value=cursor)
        cursor.limit = MagicMock(return_value=cursor)
        cursor.to_list = AsyncMock(return_value=[])
        return cursor

    def create_index(self, *args, **kwargs):
        return AsyncMock()()


class MockDatabase:
    """Mock Database that returns MockCollections."""

    def __init__(self):
        self._collections: dict[str, MockCollection] = {}

    def get_collection(self, name: str) -> MockCollection:
        if name not in self._collections:
            self._collections[name] = MockCollection()
        return self._collections[name]

    @property
    def db(self):
        return self

    def __getitem__(self, name):
        return self.get_collection(name)


@pytest.fixture
def mock_db():
    """Create a MockDatabase and override FastAPI dependency."""
    db = MockDatabase()
    app.dependency_overrides[get_database] = lambda: db
    yield db
    app.dependency_overrides.pop(get_database, None)


@pytest.fixture
def mock_redis():
    """Mock Redis for rate limiting."""
    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(return_value=None)
    redis_mock.incr = AsyncMock(return_value=1)
    redis_mock.expire = AsyncMock()
    redis_mock.delete = AsyncMock()
    redis_mock.ttl = AsyncMock(return_value=900)

    pipe_mock = AsyncMock()
    pipe_mock.incr = MagicMock(return_value=pipe_mock)
    pipe_mock.expire = MagicMock(return_value=pipe_mock)
    pipe_mock.execute = AsyncMock(return_value=[1, True])
    redis_mock.pipeline = MagicMock(return_value=pipe_mock)

    return redis_mock


def setup_auth_user(db: MockDatabase, user_doc: dict, session_id: str = None):
    """Set up mock DB to return user and session for auth."""
    sid = session_id or str(uuid4())
    users_col = db.get_collection("users")
    sessions_col = db.get_collection("sessions")

    users_col.find_one = AsyncMock(return_value=user_doc)
    sessions_col.find_one = AsyncMock(return_value={
        "session_id": sid,
        "user_id": user_doc["user_id"],
        "is_revoked": False,
    })

    token, _ = create_access_token(user_doc["user_id"], sid)
    return token, sid


# ══════════════════════════════════════════════════════════════════
# RBAC PERMISSION MATRIX TESTS (pure logic, no HTTP)
# ══════════════════════════════════════════════════════════════════


class TestPermissionMatrix:
    """Test the static RBAC permission matrix."""

    def test_admin_has_all_permissions(self):
        for perm in Permission:
            assert has_permission(UserRole.ADMIN, perm), f"Admin missing {perm}"

    def test_citizen_has_no_internal_work_permission(self):
        citizen_perms = ROLE_PERMISSIONS[UserRole.CITIZEN]
        # Phase 14 citizen discovery is served exclusively by the public-safe
        # router. Citizens must never receive an internal work permission.
        assert citizen_perms == set()

    def test_citizen_no_risk_access(self):
        assert not has_permission(UserRole.CITIZEN, Permission.READ_RISK)

    def test_citizen_no_investigation_access(self):
        assert not has_permission(UserRole.CITIZEN, Permission.READ_INVESTIGATIONS)

    def test_citizen_no_evidence_access(self):
        assert not has_permission(UserRole.CITIZEN, Permission.READ_EVIDENCE)

    def test_citizen_no_payment_access(self):
        assert not has_permission(UserRole.CITIZEN, Permission.READ_PAYMENTS)

    def test_mp_cannot_write_investigations(self):
        assert not has_permission(UserRole.MP, Permission.WRITE_INVESTIGATIONS)

    def test_mp_cannot_write_payments(self):
        assert not has_permission(UserRole.MP, Permission.WRITE_PAYMENTS)

    def test_mp_can_read_works(self):
        assert has_permission(UserRole.MP, Permission.READ_WORKS)

    def test_mp_can_read_risk(self):
        assert has_permission(UserRole.MP, Permission.READ_RISK)

    def test_inspector_can_write_investigations(self):
        assert has_permission(UserRole.INSPECTOR, Permission.WRITE_INVESTIGATIONS)

    def test_inspector_can_write_evidence(self):
        assert has_permission(UserRole.INSPECTOR, Permission.WRITE_EVIDENCE)

    def test_inspector_cannot_write_payments(self):
        assert not has_permission(UserRole.INSPECTOR, Permission.WRITE_PAYMENTS)

    def test_mospi_read_all_jurisdictions(self):
        assert has_permission(UserRole.MOSPI, Permission.READ_ALL_JURISDICTIONS)

    def test_mospi_cannot_write_works(self):
        assert not has_permission(UserRole.MOSPI, Permission.WRITE_WORKS)

    def test_mospi_can_upload_csv(self):
        assert has_permission(UserRole.MOSPI, Permission.UPLOAD_CSV)

    def test_state_nodal_officer_can_read_risk(self):
        assert has_permission(UserRole.STATE_NODAL_OFFICER, Permission.READ_RISK)

    def test_state_nodal_officer_can_write_works(self):
        assert has_permission(UserRole.STATE_NODAL_OFFICER, Permission.WRITE_WORKS)

    def test_district_authority_can_write_payments(self):
        assert has_permission(UserRole.DISTRICT_AUTHORITY, Permission.WRITE_PAYMENTS)

    def test_agency_can_write_works(self):
        assert has_permission(UserRole.AGENCY, Permission.WRITE_WORKS)

    def test_agency_cannot_manage_users(self):
        assert not has_permission(UserRole.AGENCY, Permission.MANAGE_USERS)

    def test_has_all_permissions_subset(self):
        assert has_all_permissions(
            UserRole.ADMIN,
            {Permission.READ_WORKS, Permission.WRITE_WORKS, Permission.MANAGE_USERS},
        )

    def test_has_all_permissions_fails_when_missing(self):
        assert not has_all_permissions(
            UserRole.CITIZEN,
            {Permission.READ_WORKS, Permission.READ_RISK},
        )


# ══════════════════════════════════════════════════════════════════
# JURISDICTION ENFORCEMENT TESTS (pure logic, no HTTP)
# ══════════════════════════════════════════════════════════════════


class TestJurisdictionChecks:
    """Test jurisdiction scoping logic."""

    def test_admin_bypasses_jurisdiction(self):
        j = JurisdictionScope()
        assert check_jurisdiction(UserRole.ADMIN, j, resource_state="ANY")

    def test_mospi_bypasses_jurisdiction(self):
        j = JurisdictionScope()
        assert check_jurisdiction(UserRole.MOSPI, j, resource_state="ANY")

    def test_district_user_own_district(self):
        j = JurisdictionScope(state_code="UP", district_code="LUCKNOW")
        assert check_jurisdiction(
            UserRole.DISTRICT_AUTHORITY, j,
            resource_state="UP", resource_district="LUCKNOW",
        )

    def test_district_user_cross_district_denied(self):
        j = JurisdictionScope(state_code="UP", district_code="LUCKNOW")
        assert not check_jurisdiction(
            UserRole.DISTRICT_AUTHORITY, j,
            resource_state="UP", resource_district="VARANASI",
        )

    def test_district_user_cross_state_denied(self):
        j = JurisdictionScope(state_code="UP", district_code="LUCKNOW")
        assert not check_jurisdiction(
            UserRole.DISTRICT_AUTHORITY, j,
            resource_state="MH", resource_district="LUCKNOW",
        )

    def test_state_officer_own_state(self):
        j = JurisdictionScope(state_code="UP")
        assert check_jurisdiction(
            UserRole.STATE_NODAL_OFFICER, j, resource_state="UP",
        )

    def test_state_officer_cross_state_denied(self):
        j = JurisdictionScope(state_code="UP")
        assert not check_jurisdiction(
            UserRole.STATE_NODAL_OFFICER, j, resource_state="MH",
        )

    def test_state_officer_case_insensitive(self):
        j = JurisdictionScope(state_code="up")
        assert check_jurisdiction(
            UserRole.STATE_NODAL_OFFICER, j, resource_state="UP",
        )

    def test_mp_own_constituency(self):
        j = JurisdictionScope(state_code="UP", constituency="VARANASI")
        assert check_jurisdiction(UserRole.MP, j, resource_constituency="VARANASI")

    def test_mp_cross_constituency_denied(self):
        j = JurisdictionScope(state_code="UP", constituency="VARANASI")
        assert not check_jurisdiction(UserRole.MP, j, resource_constituency="LUCKNOW")

    def test_mp_state_fallback_when_no_constituency_on_resource(self):
        j = JurisdictionScope(state_code="UP", constituency="VARANASI")
        assert check_jurisdiction(UserRole.MP, j, resource_state="UP")

    def test_mp_cross_state_denied(self):
        j = JurisdictionScope(state_code="UP", constituency="VARANASI")
        assert not check_jurisdiction(UserRole.MP, j, resource_state="MH")

    def test_inspector_assigned_task(self):
        j = JurisdictionScope(state_code="RJ", assigned_task_ids=["TASK-001", "TASK-002"])
        assert check_jurisdiction(UserRole.INSPECTOR, j, resource_task_id="TASK-001")

    def test_inspector_unassigned_task_denied(self):
        j = JurisdictionScope(state_code="RJ", assigned_task_ids=["TASK-001", "TASK-002"])
        assert not check_jurisdiction(UserRole.INSPECTOR, j, resource_task_id="TASK-999")

    def test_inspector_geographic_fallback(self):
        j = JurisdictionScope(state_code="RJ", district_code="JAIPUR", assigned_task_ids=["TASK-001"])
        assert check_jurisdiction(
            UserRole.INSPECTOR, j, resource_state="RJ", resource_district="JAIPUR",
        )

    def test_citizen_no_jurisdiction_restriction(self):
        j = JurisdictionScope()
        assert check_jurisdiction(UserRole.CITIZEN, j, resource_state="ANY")

    def test_agency_own_jurisdiction(self):
        j = JurisdictionScope(state_code="DL", district_code="CENTRAL_DELHI")
        assert check_jurisdiction(
            UserRole.AGENCY, j, resource_state="DL", resource_district="CENTRAL_DELHI",
        )

    def test_agency_cross_district_denied(self):
        j = JurisdictionScope(state_code="DL", district_code="CENTRAL_DELHI")
        assert not check_jurisdiction(
            UserRole.AGENCY, j, resource_state="DL", resource_district="SOUTH_DELHI",
        )


# ══════════════════════════════════════════════════════════════════
# JURISDICTION DB FILTER TESTS
# ══════════════════════════════════════════════════════════════════


class TestJurisdictionFilter:
    def test_admin_empty_filter(self):
        assert build_jurisdiction_filter(UserRole.ADMIN, JurisdictionScope()) == {}

    def test_mospi_empty_filter(self):
        assert build_jurisdiction_filter(UserRole.MOSPI, JurisdictionScope()) == {}

    def test_district_authority_filter(self):
        j = JurisdictionScope(state_code="UP", district_code="LUCKNOW")
        f = build_jurisdiction_filter(UserRole.DISTRICT_AUTHORITY, j)
        assert "state_code" in f
        assert "district_code" in f

    def test_mp_constituency_filter(self):
        j = JurisdictionScope(state_code="UP", constituency="VARANASI")
        f = build_jurisdiction_filter(UserRole.MP, j)
        assert "constituency" in f

    def test_inspector_task_filter(self):
        j = JurisdictionScope(assigned_task_ids=["T1", "T2"])
        f = build_jurisdiction_filter(UserRole.INSPECTOR, j)
        assert f["task_id"]["$in"] == ["T1", "T2"]

    def test_citizen_filter_matches_no_internal_records(self):
        assert build_jurisdiction_filter(UserRole.CITIZEN, JurisdictionScope()) == {"_id": None}


# ══════════════════════════════════════════════════════════════════
# JWT & SECURITY TESTS (pure logic)
# ══════════════════════════════════════════════════════════════════


class TestSecurityUtils:
    def test_password_hash_and_verify(self):
        from app.core.security import hash_password, verify_password
        pw = "TestPassword@123"
        hashed = hash_password(pw)
        assert hashed != pw
        assert verify_password(pw, hashed)
        assert not verify_password("WrongPassword", hashed)

    def test_access_token_roundtrip(self):
        from app.core.security import create_access_token, decode_access_token
        token, exp = create_access_token("user-123", "session-456")
        payload = decode_access_token(token)
        assert payload["sub"] == "user-123"
        assert payload["sid"] == "session-456"
        assert payload["type"] == "access"

    def test_expired_token_rejected(self):
        from jose import jwt as jose_jwt
        from app.core.config import get_settings
        from app.core.security import decode_access_token
        settings = get_settings()
        payload = {
            "sub": "user-123", "sid": "session-456",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
            "iat": datetime.now(timezone.utc) - timedelta(hours=2),
            "type": "access",
        }
        token = jose_jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        with pytest.raises(ValueError, match="Invalid token"):
            decode_access_token(token)

    def test_tampered_token_rejected(self):
        from app.core.security import decode_access_token
        token, _ = create_access_token("user-123", "session-456")
        with pytest.raises(ValueError):
            decode_access_token(token[:-5] + "XXXXX")

    def test_refresh_token_is_unique(self):
        assert create_refresh_token() != create_refresh_token()

    def test_token_hash_deterministic(self):
        assert hash_token("test") == hash_token("test")
        assert hash_token("test") != "test"

    def test_csrf_token_unique(self):
        assert generate_csrf_token() != generate_csrf_token()


# ══════════════════════════════════════════════════════════════════
# HTTP API TESTS (with mocked DB via dependency_overrides)
# ══════════════════════════════════════════════════════════════════


class TestLoginEndpoint:
    """Test POST /api/v1/auth/login."""

    @pytest.mark.asyncio
    async def test_login_success(self, mock_db, mock_redis):
        user_doc = make_user_doc("admin")
        mock_db.get_collection("users").find_one = AsyncMock(return_value=user_doc)

        with patch("app.core.rate_limit.get_redis_client") as mock_rc:
            mock_rc.return_value.client = mock_redis
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/auth/login", json={
                    "email": "admin@test.samarth.gov.in",
                    "password": "Test@1234567",
                })

        assert res.status_code == 200
        data = res.json()
        assert "access_token" in data
        assert "csrf_token" in data
        assert data["user"]["role"] == "admin"
        assert "refresh_token" not in data  # NEVER in body

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, mock_db, mock_redis):
        user_doc = make_user_doc("admin")
        mock_db.get_collection("users").find_one = AsyncMock(return_value=user_doc)

        with patch("app.core.rate_limit.get_redis_client") as mock_rc:
            mock_rc.return_value.client = mock_redis
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/auth/login", json={
                    "email": "admin@test.samarth.gov.in",
                    "password": "WrongPassword1",
                })

        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_login_disabled_user(self, mock_db, mock_redis):
        user_doc = make_user_doc("admin", is_active=False)
        mock_db.get_collection("users").find_one = AsyncMock(return_value=user_doc)

        with patch("app.core.rate_limit.get_redis_client") as mock_rc:
            mock_rc.return_value.client = mock_redis
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/auth/login", json={
                    "email": "admin@test.samarth.gov.in",
                    "password": "Test@1234567",
                })

        assert res.status_code == 401
        assert "disabled" in res.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, mock_db, mock_redis):
        mock_db.get_collection("users").find_one = AsyncMock(return_value=None)

        with patch("app.core.rate_limit.get_redis_client") as mock_rc:
            mock_rc.return_value.client = mock_redis
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/auth/login", json={
                    "email": "nobody@test.gov.in",
                    "password": "Test@1234567",
                })

        assert res.status_code == 401


class TestRateLimiting:
    @pytest.mark.asyncio
    async def test_rate_limit_exceeded(self, mock_db, mock_redis):
        mock_redis.get = AsyncMock(return_value="5")  # At limit

        with patch("app.core.rate_limit.get_redis_client") as mock_rc:
            mock_rc.return_value.client = mock_redis
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                res = await client.post("/api/v1/auth/login", json={
                    "email": "admin@test.gov.in",
                    "password": "Test@1234567",
                })

        assert res.status_code == 429
        assert "retry-after" in res.headers


class TestMeEndpoint:
    @pytest.mark.asyncio
    async def test_me_without_token(self, mock_db):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get("/api/v1/auth/me")
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_me_with_valid_token(self, mock_db):
        user_doc = make_user_doc("admin")
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 200
        assert res.json()["role"] == "admin"

    @pytest.mark.asyncio
    async def test_me_with_revoked_session(self, mock_db):
        user_doc = make_user_doc("admin")
        session_id = str(uuid4())
        # Session not found (revoked)
        mock_db.get_collection("sessions").find_one = AsyncMock(return_value=None)
        token, _ = create_access_token(user_doc["user_id"], session_id)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_disabled_user_after_login(self, mock_db):
        """User disabled after token issued → 403."""
        user_doc = make_user_doc("admin", is_active=False)
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 403
        assert "disabled" in res.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_role_change_reflected_after_login(self, mock_db):
        """Role changed in DB → /me returns new role (not old JWT role)."""
        user_doc = make_user_doc("citizen")  # Changed from admin to citizen
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                "/api/v1/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 200
        assert res.json()["role"] == "citizen"


class TestCSRFProtection:
    @pytest.mark.asyncio
    async def test_refresh_without_csrf_rejected(self, mock_db):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Send refresh_token cookie but no CSRF header
            client.cookies.set("refresh_token", "some-token")
            res = await client.post("/api/v1/auth/refresh")

        assert res.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_logout_without_csrf_rejected(self, mock_db):
        user_doc = make_user_doc("admin")
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/api/v1/auth/logout",
                headers={"Authorization": f"Bearer {token}"},
                # No CSRF token
            )

        assert res.status_code == 403


class TestRefreshTimestampHandling:
    @pytest.mark.asyncio
    async def test_refresh_accepts_naive_utc_datetime_returned_by_mongodb(self, mock_db):
        """MongoDB's default decoder returns BSON dates without tzinfo."""
        user_doc = make_user_doc("admin", user_id="admin-refresh")
        raw_refresh = "refresh-token-for-naive-mongo-date"
        mock_db.get_collection("sessions").find_one = AsyncMock(return_value={
            "session_id": "refresh-session",
            "user_id": user_doc["user_id"],
            "refresh_token_hash": hash_token(raw_refresh),
            "csrf_token": "csrf-token",
            "is_revoked": False,
            # Deliberately naive, matching the default PyMongo representation.
            "expires_at": datetime.utcnow() + timedelta(days=1),
        })
        mock_db.get_collection("users").find_one = AsyncMock(return_value=user_doc)

        access_token, new_refresh, _, new_csrf = await AuthService(mock_db).refresh_tokens(
            raw_refresh_token=raw_refresh,
            csrf_token_header="csrf-token",
        )

        assert access_token
        assert new_refresh != raw_refresh
        assert new_csrf != "csrf-token"


class TestLastAdminProtection:
    @pytest.mark.asyncio
    async def test_cannot_deactivate_last_admin(self, mock_db):
        admin_doc = make_user_doc("admin", user_id="admin-1")
        token, _ = setup_auth_user(mock_db, admin_doc)

        # _check_last_admin: 0 other active admins
        mock_db.get_collection("users").count_documents = AsyncMock(return_value=0)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.patch(
                f"/api/v1/users/admin-1/status",
                headers={"Authorization": f"Bearer {token}"},
                json={"is_active": False},
            )

        assert res.status_code == 400
        assert "last" in res.json()["detail"].lower()


class TestIDORPrevention:
    @pytest.mark.asyncio
    async def test_non_admin_cannot_list_users(self, mock_db):
        user_doc = make_user_doc("citizen")
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                "/api/v1/users",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 403

    @pytest.mark.asyncio
    async def test_non_admin_cannot_get_other_user(self, mock_db):
        user_doc = make_user_doc("mp", state_code="UP", constituency="VARANASI")
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                f"/api/v1/users/{str(uuid4())}",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 403


class TestIngestionAuth:
    @pytest.mark.asyncio
    async def test_ingestion_unauthenticated_rejected(self, mock_db):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get("/api/v1/ingestion/batches")

        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_citizen_cannot_access_ingestion(self, mock_db):
        user_doc = make_user_doc("citizen")
        token, _ = setup_auth_user(mock_db, user_doc)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(
                "/api/v1/ingestion/batches",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert res.status_code == 403
