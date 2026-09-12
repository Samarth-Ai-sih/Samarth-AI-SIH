"""Phase 8 tests for deterministic and MongoDB-backed composite scoring."""

import os
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.risk_service import DEFAULT_WEIGHTS, RiskScoringService


FIXED_TIME = datetime(2026, 9, 8, 9, 30, tzinfo=timezone.utc)

WORK = {
    "work_id": "work-001",
    "title": "Community Health Centre Upgrade",
    "district_code": "LUCKNOW",
    "state_code": "UP",
    "status": "in_progress",
    "sanctioned_amount": 1_000_000,
    "funds_released": 1_200_000,
    "actual_expenditure": 900_000,
    "physical_progress_pct": 40,
    "recommended_date": "2025-01-01T00:00:00+00:00",
    "sanctioned_date": "2025-04-01T00:00:00+00:00",
    "expected_completion_date": "2026-01-01T00:00:00+00:00",
}

TRIGGERED_RESULTS = [
    {
        "result_id": "result-time",
        "work_id": "work-001",
        "rule_code": "COMPLETION_OVERDUE",
        "severity": "warning",
        "status": "deviation_detected",
        "triggered_at": FIXED_TIME,
    },
    {
        "result_id": "result-finance",
        "work_id": "work-001",
        "rule_code": "FUNDS_EXCEED_SANCTIONED",
        "severity": "critical",
        "status": "deviation_detected",
        "triggered_at": FIXED_TIME,
    },
    {
        "result_id": "result-evidence",
        "work_id": "work-001",
        "rule_code": "MISSING_EVIDENCE",
        "severity": "advisory",
        "status": "deviation_detected",
        "triggered_at": FIXED_TIME,
    },
]

RULE_DEFINITIONS = {
    "COMPLETION_OVERDUE": {
        "name": "Planned Completion Exceeded While Incomplete",
        "category": "timeline",
    },
    "FUNDS_EXCEED_SANCTIONED": {
        "name": "Funds Above Sanctioned Amount",
        "category": "financial",
    },
    "MISSING_EVIDENCE": {
        "name": "Missing Documents or Photos",
        "category": "documentation",
    },
}

DUPLICATE = {
    "work_id": "work-duplicate",
    "title": "Community Health Centre Upgrade",
    "district_code": "LUCKNOW",
    "state_code": "UP",
}


class MemoryCursor:
    """Small async Motor-compatible cursor used to test MongoDB writes."""

    def __init__(self, documents):
        self.documents = deepcopy(documents)

    def sort(self, fields, direction=None):
        ordered_fields = fields if isinstance(fields, list) else [(fields, direction or 1)]
        for field, order in reversed(ordered_fields):
            self.documents.sort(key=lambda item: str(item.get(field, "")), reverse=order < 0)
        return self

    def skip(self, count):
        self.documents = self.documents[count:]
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length=None):
        return deepcopy(self.documents if length is None else self.documents[:length])


class MemoryCollection:
    """Subset of MongoDB collection behaviour exercised by RiskScoringService."""

    def __init__(self, documents=None):
        self.documents = deepcopy(documents or [])
        self.inserted_documents = []

    async def create_index(self, *args, **kwargs):
        return "memory_index"

    async def find_one(self, query, projection=None, sort=None):
        matches = [document for document in self.documents if _matches(document, query)]
        if sort:
            cursor = MemoryCursor(matches).sort(sort)
            matches = await cursor.to_list()
        return _project(matches[0], projection) if matches else None

    def find(self, query, projection=None):
        return MemoryCursor([_project(document, projection) for document in self.documents if _matches(document, query)])

    async def count_documents(self, query):
        return sum(1 for document in self.documents if _matches(document, query))

    async def insert_one(self, document):
        copied = deepcopy(document)
        self.documents.append(copied)
        self.inserted_documents.append(copied)
        return SimpleNamespace(inserted_id="memory-id")

    async def update_one(self, query, update):
        for document in self.documents:
            if _matches(document, query):
                document.update(deepcopy(update.get("$set", {})))
                for field, value in update.get("$push", {}).items():
                    document.setdefault(field, []).append(deepcopy(value))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)


class MemoryDatabase:
    def __init__(self, collections):
        self.collections = {
            name: MemoryCollection(documents) for name, documents in collections.items()
        }

    def get_collection(self, name):
        return self.collections.setdefault(name, MemoryCollection())


def _matches(document, query):
    if "$or" in query:
        or_branches = query["$or"]
        sub_query = {k: v for k, v in query.items() if k != "$or"}
        if not _matches(document, sub_query):
            return False
        return any(_matches(document, branch) for branch in or_branches)
    for field, expected in query.items():
        actual = document.get(field)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


def _project(document, projection):
    if not projection:
        return deepcopy(document)
    include = [key for key, value in projection.items() if value and key != "_id"]
    if include:
        return {key: deepcopy(document[key]) for key in include if key in document}
    return {key: deepcopy(value) for key, value in document.items() if projection.get(key, 1)}


class TestDeterministicCompositeScore:
    def test_same_feature_snapshot_has_same_score_and_explanation(self):
        inputs = {
            "triggered_results": TRIGGERED_RESULTS,
            "evidence_count": 0,
            "duplicate_candidates": [DUPLICATE],
            "rule_definitions": RULE_DEFINITIONS,
            "calculated_at": FIXED_TIME,
        }
        first = RiskScoringService.build_score(WORK, **inputs)
        second = RiskScoringService.build_score(WORK, **inputs)

        # score_id is deliberately unique per persisted alert; all score logic
        # and snapshots are deterministic for the exact same inputs.
        assert first.model_dump(exclude={"score_id"}) == second.model_dump(exclude={"score_id"})
        assert first.composite_score == 77.5
        assert first.risk_tier.value == "red"
        assert {item.dimension: item.raw_score for item in first.sub_scores} == {
            "time_risk": 50.0,
            "financial_risk": 100.0,
            "duplicate_risk": 50.0,
            "evidence_risk": 100.0,
            "compliance_risk": 100.0,
        }
        assert {item.dimension: item.weight for item in first.sub_scores} == DEFAULT_WEIGHTS
        assert len(first.top_factors) == 5
        assert first.ai_disclaimer == "AI signal — requires human review."


@pytest.mark.asyncio
async def test_score_is_persisted_to_risk_scores_collection_and_denormalised_on_work():
    db = MemoryDatabase(
        {
            "works": [WORK, DUPLICATE],
            "compliance_results": TRIGGERED_RESULTS,
            "compliance_rules": [
                {"rule_code": code, "version": 1, **definition}
                for code, definition in RULE_DEFINITIONS.items()
            ],
            "evidence_metadata": [],
        }
    )
    service = RiskScoringService(db)

    score = await service.score_work("work-001", calculated_at=FIXED_TIME)

    assert score is not None
    risk_scores = db.get_collection("risk_scores").documents
    assert len(risk_scores) == 1
    stored = risk_scores[0]
    assert stored["score_id"] == score.score_id
    assert stored["composite_score"] == 77.5
    assert stored["risk_tier"] == "red"
    assert stored["score_version"] == 1
    assert stored["model_version"] == "deterministic-rules-v1.0.0"
    assert len(stored["sub_scores"]) == 5
    assert len(stored["triggered_rules"]) == 3
    assert len(stored["explanation_snapshot"]["top_factors"]) == 5
    assert stored["supporting_data"]["work"]["collection"] == "works"

    persisted_work = db.get_collection("works").documents[0]
    assert persisted_work["composite_risk_score"] == 77.5
    assert persisted_work["risk_tier"] == "red"


@pytest.mark.asyncio
async def test_tier_filter_only_returns_a_work_when_its_latest_snapshot_matches():
    """Historical alerts must never make a current alert list look stale."""
    db = MemoryDatabase(
        {
            "risk_scores": [
                {
                    "score_id": "old-red", "work_id": "work-001", "risk_tier": "red",
                    "composite_score": 80, "calculated_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
                },
                {
                    "score_id": "new-green", "work_id": "work-001", "risk_tier": "green",
                    "composite_score": 20, "calculated_at": datetime(2026, 2, 1, tzinfo=timezone.utc),
                },
            ],
        }
    )
    service = RiskScoringService(db)

    red_scores, red_total, _ = await service.list_latest_scores(tier="red")
    green_scores, green_total, _ = await service.list_latest_scores(tier="green")

    assert red_scores == []
    assert red_total == 0
    assert green_total == 1
    assert green_scores[0]["score_id"] == "new-green"


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("RUN_MONGODB_INTEGRATION_TESTS") != "1",
    reason="Set RUN_MONGODB_INTEGRATION_TESTS=1 to run against an isolated MongoDB test database.",
)
async def test_score_snapshot_is_persisted_in_real_mongodb():
    """Exercise the actual Motor/MongoDB path only against a *_test database.

    This test is opt-in because it writes a score snapshot. The second guard
    prevents accidental writes to a development or production database.
    """
    from app.core.config import get_settings
    from app.core.database import Database

    settings = get_settings()
    if not settings.MONGODB_DB_NAME.endswith("_test"):
        pytest.skip("MongoDB integration tests require a database name ending in '_test'.")

    db = Database(settings)
    run_id = str(uuid4())
    work_id = f"risk-integration-{run_id}"
    score_id = None
    try:
        await db.connect()
        await db.get_collection("works").insert_one({
            **WORK,
            "work_id": work_id,
            "title": f"Integration risk work {run_id}",
        })
        await db.get_collection("compliance_results").insert_one({
            **TRIGGERED_RESULTS[0],
            "result_id": f"result-{run_id}",
            "work_id": work_id,
        })

        score = await RiskScoringService(db).score_work(work_id, calculated_at=FIXED_TIME)
        assert score is not None
        score_id = score.score_id

        stored = await db.get_collection("risk_scores").find_one(
            {"score_id": score_id}, {"_id": 0}
        )
        assert stored is not None
        assert stored["work_id"] == work_id
        assert stored["composite_score"] == score.composite_score
        assert stored["feature_snapshot"]["work"]["work_id"] == work_id
        assert stored["explanation_snapshot"]["top_factors"]
    finally:
        # The target is explicitly the one-off run id created above, not a
        # broad collection delete. This keeps the integration test recoverable.
        if getattr(db, "_client", None):
            await db.get_collection("risk_scores").delete_many({"work_id": work_id})
            await db.get_collection("compliance_results").delete_many({"work_id": work_id})
            await db.get_collection("works").delete_many({"work_id": work_id})
            if score_id:
                await db.get_collection("audit_logs").delete_many({"resource_id": score_id})
            await db.disconnect()
