"""Phase 17 security and lifecycle regression coverage."""

import os
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from starlette.requests import Request

os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-minimum-16-chars")
os.environ.setdefault("ENVIRONMENT", "development")

from app.core.config import Environment, Settings
from app.core.database import get_database
from app.core.security import hash_password, verify_password
from app.core.rate_limit import get_client_ip
from app.main import app
from app.models.user import LoginRequest
from app.models.work import WorkCategory, WorkCreateRequest, WorkStatus, WorkStatusUpdateRequest
from app.services.work_service import WorkService
from tests.test_auth import MockDatabase, make_user_doc, setup_auth_user
from tests.test_risk_scoring import MemoryDatabase


def _settings(**overrides):
    return Settings(
        MONGODB_URI="mongodb://localhost:27017",
        JWT_SECRET_KEY="test-secret-key-minimum-16-chars",
        **overrides,
    )


def _work_request() -> WorkCreateRequest:
    return WorkCreateRequest(
        title="Scoped health centre upgrade",
        category=WorkCategory.HEALTHCARE,
        state_code="UP",
        state_name="Uttar Pradesh",
        district_code="LKO",
        district_name="Lucknow",
        constituency="Lucknow Central",
        sanctioned_amount=1_000_000,
        recommended_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_security_settings_reject_wildcard_cors_and_production_debug():
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        _settings(CORS_ORIGINS="*")
    with pytest.raises(ValidationError, match="DEBUG"):
        _settings(ENVIRONMENT=Environment.PRODUCTION, DEBUG=True)
    with pytest.raises(ValidationError, match="MongoDB Atlas SRV"):
        _settings(
            ENVIRONMENT=Environment.PRODUCTION,
            DEBUG=False,
            CORS_ORIGINS="https://review.example.gov.in",
        )
    settings = _settings(CORS_ORIGINS="https://review.example.gov.in,http://localhost:3000")
    assert settings.cors_origins_list == ["https://review.example.gov.in", "http://localhost:3000"]


def test_passwords_over_bcrypt_limit_are_rejected_without_truncation():
    too_long = "a" * 73
    with pytest.raises(ValidationError, match="72 UTF-8 bytes"):
        LoginRequest(email="reviewer@example.gov.in", password=too_long)
    with pytest.raises(ValueError, match="too long"):
        hash_password(too_long)
    assert verify_password(too_long, hash_password("SecurePassword1!")) is False


def test_client_ip_ignores_forwarded_headers_unless_proxy_is_explicitly_trusted(monkeypatch):
    def make_request(headers: dict[str, str]) -> Request:
        scope = {
            "type": "http", "method": "GET", "path": "/", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": ("198.51.100.8", 443), "server": ("test", 80), "scheme": "http", "query_string": b"",
        }
        return Request(scope)

    monkeypatch.setattr("app.core.rate_limit.get_settings", lambda: type("Settings", (), {"TRUST_PROXY_HEADERS": False})())
    assert get_client_ip(make_request({"X-Forwarded-For": "203.0.113.10"})) == "198.51.100.8"
    monkeypatch.setattr("app.core.rate_limit.get_settings", lambda: type("Settings", (), {"TRUST_PROXY_HEADERS": True})())
    assert get_client_ip(make_request({"X-Forwarded-For": "203.0.113.10, 198.51.100.8"})) == "203.0.113.10"


@pytest.mark.asyncio
async def test_api_security_headers_and_allow_listed_work_filters_are_enforced():
    db = MockDatabase()
    token, _ = setup_auth_user(db, make_user_doc("district_authority", state_code="UP", district_code="LKO"))
    app.dependency_overrides[get_database] = lambda: db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            health = await client.get("/health", headers={"X-Request-ID": "safe-request-17"})
            invalid_sort = await client.get(
                "/api/v1/works?sort_by=$where",
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        app.dependency_overrides.pop(get_database, None)

    assert health.status_code == 200
    assert health.headers["x-request-id"] == "safe-request-17"
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["x-frame-options"] == "DENY"
    assert health.headers["content-security-policy"].startswith("default-src 'none'")
    assert health.headers["permissions-policy"].startswith("camera=()")
    assert invalid_sort.status_code == 422


@pytest.mark.asyncio
async def test_work_lifecycle_is_audited_and_all_reads_writes_are_jurisdiction_scoped():
    db = MemoryDatabase({"works": []})
    service = WorkService(db)
    work = await service.create_work(_work_request(), created_by_user_id="district-up")
    own_scope = {"state_code": "UP", "district_code": "LKO"}
    other_scope = {"state_code": "MH", "district_code": "MUM"}

    assert await service.get_work(work.work_id, jurisdiction_filter=other_scope) is None
    assert await service.update_status(
        work.work_id,
        WorkStatusUpdateRequest(status=WorkStatus.UNDER_REVIEW, reason="Document review"),
        updated_by_user_id="district-up",
        jurisdiction_filter=own_scope,
    ) is not None
    assert await service.update_status(
        work.work_id,
        WorkStatusUpdateRequest(status=WorkStatus.SANCTIONED, reason="Sanction approved"),
        updated_by_user_id="district-up",
        jurisdiction_filter=own_scope,
    ) is not None
    assert await service.update_status(
        work.work_id,
        WorkStatusUpdateRequest(status=WorkStatus.IN_PROGRESS, reason="Work started"),
        updated_by_user_id="district-up",
        jurisdiction_filter=other_scope,
    ) is None
    with pytest.raises(ValueError, match="Cannot transition"):
        await service.update_status(
            work.work_id,
            WorkStatusUpdateRequest(status=WorkStatus.COMPLETED, reason="Skipping execution"),
            updated_by_user_id="district-up",
            jurisdiction_filter=own_scope,
        )

    timeline = await service.get_timeline(work.work_id, jurisdiction_filter=own_scope)
    assert timeline and [event["event_type"] for event in timeline] == ["work_recommended", "status_change", "status_change"]
    assert len(db.get_collection("audit_logs").documents) == 3
