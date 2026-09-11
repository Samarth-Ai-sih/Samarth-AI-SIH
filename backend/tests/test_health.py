"""
SAMARTH AI — Health Endpoint Tests

Tests for /health, /ready, and /api/v1/health endpoints.
"""

import os
import pytest
from httpx import AsyncClient, ASGITransport

# Set test environment variables before importing the app
os.environ.setdefault("MONGODB_URI", "mongodb+srv://test:test@localhost/?appName=test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-minimum-16-chars")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ENVIRONMENT", "development")

from app.main import app  # noqa: E402


@pytest.mark.asyncio
async def test_health_endpoint():
    """Test that /health returns 200 with correct schema."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "SAMARTH AI"
    assert "version" in data
    assert "environment" in data
    assert "timestamp" in data


@pytest.mark.asyncio
async def test_v1_health_endpoint():
    """Test that /api/v1/health returns 200 with correct schema."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "SAMARTH AI"


@pytest.mark.asyncio
async def test_ready_endpoint():
    """Test that /ready returns 200 with dependency status."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")

    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "dependencies" in data
    assert "mongodb" in data["dependencies"]
    assert "redis" in data["dependencies"]


@pytest.mark.asyncio
async def test_health_response_schema():
    """Verify response fields are correctly typed."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    data = response.json()
    assert isinstance(data["status"], str)
    assert isinstance(data["app"], str)
    assert isinstance(data["version"], str)
    assert isinstance(data["timestamp"], str)


@pytest.mark.asyncio
async def test_openapi_available_in_dev():
    """In development, /docs should be available."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/openapi.json")

    assert response.status_code == 200
    data = response.json()
    assert data["info"]["title"] == "SAMARTH AI"
