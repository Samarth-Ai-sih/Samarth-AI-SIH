"""Map/geospatial regression coverage for the Mongo-backed work explorer."""

from copy import deepcopy
from datetime import datetime, timezone
import os
import re
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.works import router as works_router
from app.core.database import get_database
from app.core.dependencies import get_current_user
from app.models.user import JurisdictionScope, UserInDB, UserRole
from app.models.work import WorkCategory, WorkCreateRequest, WorkLocation
from app.services.work_service import WorkService


NOW = datetime(2026, 9, 10, tzinfo=timezone.utc)


def _read_path(document, path):
    value = document
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _matches(document, query):
    for field, expected in query.items():
        if field == "$and":
            if not all(_matches(document, clause) for clause in expected):
                return False
            continue
        if field == "$or":
            if not any(_matches(document, clause) for clause in expected):
                return False
            continue
        actual = _read_path(document, field)
        if isinstance(expected, dict):
            if "$regex" in expected:
                flags = re.IGNORECASE if "i" in str(expected.get("$options", "")) else 0
                if actual is None or re.search(expected["$regex"], str(actual), flags) is None:
                    return False
            elif "$exists" in expected:
                if (actual is not None) != bool(expected["$exists"]):
                    return False
            elif "$geoWithin" in expected:
                polygon = expected["$geoWithin"]["$geometry"]["coordinates"][0]
                min_longitude = min(point[0] for point in polygon)
                max_longitude = max(point[0] for point in polygon)
                min_latitude = min(point[1] for point in polygon)
                max_latitude = max(point[1] for point in polygon)
                if not isinstance(actual, dict) or actual.get("type") != "Point":
                    return False
                longitude, latitude = actual.get("coordinates", [None, None])
                if not (min_longitude <= longitude <= max_longitude and min_latitude <= latitude <= max_latitude):
                    return False
            elif "$nin" in expected:
                if actual in expected["$nin"]:
                    return False
            else:
                if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                    return False
                if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                    return False
                if "$in" in expected and actual not in expected["$in"]:
                    return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, field, direction=None):
        if isinstance(field, list):
            for name, order in reversed(field):
                self.documents.sort(key=lambda item: _read_path(item, name) or NOW, reverse=order < 0)
        else:
            self.documents.sort(key=lambda item: _read_path(item, field) or NOW, reverse=(direction or 1) < 0)
        return self

    def skip(self, value):
        self.documents = self.documents[value:]
        return self

    def limit(self, value):
        self.documents = self.documents[:value]
        return self

    async def to_list(self, length=None):
        return deepcopy(self.documents if length is None else self.documents[:length])


class _Collection:
    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])
        self.indexes = []

    async def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))
        return "memory_index"

    async def insert_one(self, document):
        self.documents.append(deepcopy(document))
        return SimpleNamespace(inserted_id="memory")

    async def count_documents(self, query):
        return sum(_matches(item, query) for item in self.documents)

    def find(self, query, projection=None):
        records = [deepcopy(item) for item in self.documents if _matches(item, query)]
        if projection:
            included = [field for field, value in projection.items() if value and field != "_id"]
            if included:
                records = [{field: item[field] for field in included if field in item} for item in records]
        return _Cursor(records)

    async def find_one(self, query, projection=None):
        records = await self.find(query, projection).to_list(length=1)
        return records[0] if records else None

    async def update_one(self, query, update):
        for item in self.documents:
            if _matches(item, query):
                for field, value in update.get("$set", {}).items():
                    target = item
                    parts = field.split(".")
                    for part in parts[:-1]:
                        target = target.setdefault(part, {})
                    target[parts[-1]] = deepcopy(value)
                for field, value in update.get("$push", {}).items():
                    item.setdefault(field, []).append(deepcopy(value))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


class GeoMemoryDatabase:
    def __init__(self, collections=None):
        self.collections = {name: _Collection(value) for name, value in (collections or {}).items()}

    def get_collection(self, name):
        return self.collections.setdefault(name, _Collection())


def _work(work_id, *, state="UP", district="LKO", latitude=26.8467, longitude=80.9462):
    return {
        "work_id": work_id, "title": f"{work_id} community asset", "status": "in_progress", "category": "healthcare",
        "state_code": state, "state_name": "Uttar Pradesh" if state == "UP" else "Maharashtra",
        "district_code": district, "district_name": "Lucknow" if district == "LKO" else "Mumbai",
        "constituency": "Lucknow Central" if state == "UP" else "Mumbai South", "mp_name": "Example MP",
        "implementing_agency": "Works Agency", "sanctioned_amount": 1_000_000, "funds_released": 600_000,
        "actual_expenditure": 500_000, "physical_progress_pct": 50, "composite_risk_score": 72,
        "risk_tier": "amber", "location": {"latitude": latitude, "longitude": longitude, "address": "Recorded site", "geo": {"type": "Point", "coordinates": [longitude, latitude]}},
        "created_at": NOW, "updated_at": NOW,
    }


def _user(role, **scope):
    return UserInDB(
        user_id=f"{role.value}-map", email=f"{role.value}@example.test", username=f"{role.value}-map",
        full_name="Map Reviewer", hashed_password="not-used", role=role,
        jurisdiction=JurisdictionScope(**scope),
    )


def test_location_rejects_invalid_or_incomplete_coordinates():
    with pytest.raises(ValueError, match="Both latitude and longitude"):
        WorkLocation(latitude=26.8)
    with pytest.raises(ValueError):
        WorkLocation(latitude=91, longitude=80)


@pytest.mark.asyncio
async def test_work_create_preserves_lat_lon_and_persists_geojson_point_for_map_queries():
    db = GeoMemoryDatabase({"works": []})
    service = WorkService(db)
    work = await service.create_work(
        WorkCreateRequest(
            title="Recorded community health centre", category=WorkCategory.HEALTHCARE,
            state_code="UP", state_name="Uttar Pradesh", district_code="LKO", district_name="Lucknow",
            location=WorkLocation(latitude=26.8467, longitude=80.9462, address="Ward Seven"),
        ),
        created_by_user_id="district-map",
    )
    stored = db.get_collection("works").documents[0]
    assert stored["location"]["latitude"] == 26.8467
    assert stored["location"]["longitude"] == 80.9462
    assert stored["location"]["geo"] == {"type": "Point", "coordinates": [80.9462, 26.8467]}

    markers, total, with_coordinates, _, without_coordinates = await service.list_map_works(
        jurisdiction_filter={"state_code": "UP"}, bounding_box=(80.9, 26.8, 81.0, 26.9), page=1, page_size=50,
    )
    assert total == with_coordinates == 1
    assert without_coordinates == 0
    assert markers[0]["work_id"] == work.work_id


def test_map_api_requires_auth_and_citizens_cannot_use_internal_markers():
    app = FastAPI()
    app.include_router(works_router)
    # FastAPI resolves the database dependency while building the nested auth
    # dependency graph, even when HTTP Bearer credentials are absent.
    app.dependency_overrides[get_database] = lambda: GeoMemoryDatabase()
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/works/map").status_code == 401
    finally:
        app.dependency_overrides.clear()

    db = GeoMemoryDatabase({"works": [_work("up-work"), _work("mh-work", state="MH", district="MUM", latitude=19.076, longitude=72.8777)]})
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _user(UserRole.CITIZEN)
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/works/map").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_map_api_enforces_jurisdiction_even_when_a_query_parameter_requests_another_state():
    db = GeoMemoryDatabase({"works": [_work("up-work"), _work("mh-work", state="MH", district="MUM", latitude=19.076, longitude=72.8777)]})
    app = FastAPI()
    app.include_router(works_router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _user(UserRole.DISTRICT_AUTHORITY, state_code="UP", district_code="LKO")
    try:
        with TestClient(app) as client:
            allowed = client.get("/api/v1/works/map")
            bypass_attempt = client.get("/api/v1/works/map?state_code=MH")
            invalid_bounds = client.get("/api/v1/works/map?min_longitude=80&min_latitude=20")
        assert allowed.status_code == 200
        assert [item["work_id"] for item in allowed.json()["markers"]] == ["up-work"]
        # District authority has payment access but not risk access; map data is
        # redacted according to the same permission model, not merely hidden by UI.
        assert allowed.json()["markers"][0]["risk_tier"] is None
        assert allowed.json()["markers"][0]["funds_released"] == 600_000
        assert bypass_attempt.status_code == 200
        assert bypass_attempt.json()["total_matching_works"] == 0
        assert invalid_bounds.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_inspector_map_is_limited_to_persisted_assigned_case_work_ids():
    db = GeoMemoryDatabase({
        "works": [_work("assigned-work"), _work("unassigned-work", latitude=26.8501, longitude=80.95)],
        "cases": [
            {"case_id": "case-assigned", "work_id": "assigned-work", "assigned_inspector_id": "inspector-map"},
            {"case_id": "case-other", "work_id": "unassigned-work", "assigned_inspector_id": "other-inspector"},
        ],
    })
    app = FastAPI()
    app.include_router(works_router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _user(
        UserRole.INSPECTOR, state_code="UP", district_code="LKO", assigned_task_ids=["case-assigned", "case-other"],
    )
    try:
        with TestClient(app) as client:
            denied = client.get("/api/v1/works/map?work_id=unassigned-work")
            assigned = client.get("/api/v1/works/map")
        assert denied.status_code == 200 and denied.json()["markers"] == []
        assert assigned.status_code == 200
        marker = assigned.json()["markers"][0]
        assert marker["work_id"] == "assigned-work"
        assert marker["funds_released"] is None
        assert marker["risk_tier"] is None
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_map_counts_missing_coordinates_and_paginates_large_allowed_result_sets():
    mapped = [_work(f"mapped-{index}", latitude=26.80 + index / 1000, longitude=80.90 + index / 1000) for index in range(3)]
    no_coordinates = _work("no-coordinates")
    no_coordinates["location"] = {"latitude": None, "longitude": None, "address": "Address only"}
    db = GeoMemoryDatabase({"works": [*mapped, no_coordinates]})
    markers, total, coordinate_count, pages, without_coordinates = await WorkService(db).list_map_works(
        jurisdiction_filter={"state_code": "UP"}, page=2, page_size=2,
    )
    assert total == 4
    assert coordinate_count == 3
    assert without_coordinates == 1
    assert pages == 2
    assert len(markers) == 1


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("RUN_MONGODB_INTEGRATION_TESTS") != "1",
    reason="Set RUN_MONGODB_INTEGRATION_TESTS=1 to run against an isolated MongoDB test database.",
)
async def test_map_geojson_query_runs_against_real_mongodb_2dsphere_index():
    """Exercise the actual Motor/MongoDB $geoWithin path on a disposable DB."""
    from app.core.config import get_settings
    from app.core.database import Database

    settings = get_settings()
    if not settings.MONGODB_DB_NAME.endswith("_test"):
        pytest.skip("MongoDB integration tests require a database name ending in '_test'.")
    db = Database(settings)
    work_id = f"map-geo-integration-{uuid4()}"
    try:
        await db.connect()
        service = WorkService(db)
        await service.ensure_indexes()
        await db.get_collection("works").insert_one({
            **_work(work_id, latitude=26.8467, longitude=80.9462),
            "data_source": "operator_entered",
        })
        markers, total, mapped, _, missing = await service.list_map_works(
            jurisdiction_filter={"state_code": "UP"},
            bounding_box=(80.94, 26.84, 80.95, 26.85),
            page=1,
            page_size=20,
        )
        assert total == mapped == 1
        assert missing == 0
        assert markers[0]["work_id"] == work_id
    finally:
        if getattr(db, "_client", None):
            await db.get_collection("works").delete_many({"work_id": work_id})
            await db.disconnect()


def test_admin_map_can_filter_and_use_a_bounding_box_without_exposing_private_evidence_fields():
    db = GeoMemoryDatabase({"works": [_work("up-work"), _work("mh-work", state="MH", district="MUM", latitude=19.076, longitude=72.8777)]})
    app = FastAPI()
    app.include_router(works_router)
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: _user(UserRole.ADMIN)
    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/works/map?risk_tier=amber&min_longitude=80&min_latitude=26&max_longitude=82&max_latitude=28")
        assert response.status_code == 200
        payload = response.json()
        assert payload["works_with_valid_coordinates"] == 1
        marker = payload["markers"][0]
        assert marker["work_id"] == "up-work"
        assert marker["risk_tier"] == "amber"
        assert {"payment_tranches", "evidence", "case", "audit_logs"}.isdisjoint(marker)
    finally:
        app.dependency_overrides.clear()
