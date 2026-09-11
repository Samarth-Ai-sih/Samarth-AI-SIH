"""
SAMARTH AI — Deterministic Composite Risk Scoring Service

Phase 8 uses explainable, versioned rules only.  The score is deliberately
not an automated decision: it is a bounded 0–100 prioritisation signal for a
human reviewer.  The frozen feature and explanation snapshots make every
stored score reproducible from the data that was available when it was run.
"""

import logging
import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterable, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.risk import (
    BatchScoreResponse,
    ExplanationEntry,
    ExplanationSnapshot,
    RiskDistribution,
    RiskScore,
    RiskTier,
    SubScore,
    TriggeredRule,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.risk")

SCORES_COLLECTION = "risk_scores"
WORKS_COLLECTION = "works"
RESULTS_COLLECTION = "compliance_results"
RULES_COLLECTION = "compliance_rules"
EVIDENCE_COLLECTION = "evidence_metadata"

MODEL_VERSION = "deterministic-rules-v1.0.0"
SCORE_VERSION = 1
AI_DISCLAIMER = "AI signal — requires human review."

# The weights are a versioned part of the policy snapshot stored with every
# result.  They intentionally sum to exactly 1.00.
DEFAULT_WEIGHTS: dict[str, float] = {
    "time_risk": 0.25,
    "financial_risk": 0.25,
    "duplicate_risk": 0.20,
    "evidence_risk": 0.15,
    "compliance_risk": 0.15,
}

DIMENSION_LABELS = {
    "time_risk": "Time Risk",
    "financial_risk": "Financial Risk",
    "duplicate_risk": "Duplicate Risk",
    "evidence_risk": "Evidence Risk",
    "compliance_risk": "Compliance Risk",
}

SEVERITY_POINTS = {
    "critical": 75.0,
    "warning": 50.0,
    "advisory": 30.0,
    "info": 10.0,
}

RULE_CATEGORIES = {
    "REC_SANC_DELAY": "timeline",
    "COMPLETION_OVERDUE": "timeline",
    "MISSING_PROGRESS_UPDATE": "documentation",
    "MISSING_INSPECTION": "documentation",
    "MISSING_EVIDENCE": "documentation",
    "INVALID_DATE_SEQUENCE": "timeline",
    "COMPLETION_NO_EVIDENCE": "documentation",
    "FUNDS_EXCEED_SANCTIONED": "financial",
    "PAYMENT_PROGRESS_MISMATCH": "financial",
    "LOCATION_JURISDICTION_ISSUE": "location",
    "ALLOCATION_THRESHOLD": "eligibility",
}

RULE_NAMES = {
    "REC_SANC_DELAY": "Recommendation-to-Sanction Delay",
    "COMPLETION_OVERDUE": "Planned Completion Exceeded While Incomplete",
    "MISSING_PROGRESS_UPDATE": "Missing Progress Update",
    "MISSING_INSPECTION": "Missing Inspection Report",
    "MISSING_EVIDENCE": "Missing Documents or Photos",
    "INVALID_DATE_SEQUENCE": "Invalid Date Sequence",
    "COMPLETION_NO_EVIDENCE": "Completion Without Evidence",
    "FUNDS_EXCEED_SANCTIONED": "Funds Above Sanctioned Amount",
    "PAYMENT_PROGRESS_MISMATCH": "Payment and Progress Inconsistency",
    "LOCATION_JURISDICTION_ISSUE": "Location or Jurisdiction Issue",
    "ALLOCATION_THRESHOLD": "Work Eligibility and Allocation Threshold",
}


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def _round(value: float) -> float:
    """Use a single rounding policy for stable API and persisted values."""
    return round(_clamp(float(value)), 2)


def _normalise_title(value: Any) -> str:
    """Stable exact-title key used for conservative duplicate candidates."""
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _severity_points(severity: Any) -> float:
    return SEVERITY_POINTS.get(str(severity or "").lower(), 30.0)


def _impact(score: float) -> str:
    if score >= 65:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def _rule_score(rules: Iterable[dict[str, Any]]) -> float:
    """Sum severity contributions and cap each dimension at 100."""
    return _round(sum(_severity_points(rule.get("severity")) for rule in rules))


class RiskScoringService:
    """Stores deterministic, explainable risk-score snapshots in MongoDB."""

    def __init__(self, db: Database):
        self._db = db
        self._scores = db.get_collection(SCORES_COLLECTION)
        self._works = db.get_collection(WORKS_COLLECTION)
        self._results = db.get_collection(RESULTS_COLLECTION)
        self._rules = db.get_collection(RULES_COLLECTION)
        self._evidence = db.get_collection(EVIDENCE_COLLECTION)
        self._audit = AuditService(db)

    async def ensure_indexes(self) -> None:
        """Create indexes used for latest-score lookups and alert lists."""
        await self._scores.create_index("score_id", unique=True)
        await self._scores.create_index("operation_key", unique=True, sparse=True)
        await self._scores.create_index([("work_id", 1), ("calculated_at", -1)])
        await self._scores.create_index([("risk_tier", 1), ("calculated_at", -1)])
        await self._scores.create_index("composite_score")
        logger.info("Risk-score indexes ensured")

    async def score_work(
        self,
        work_id: str,
        *,
        calculated_by: str = "system",
        ip_address: str = "",
        user_agent: str = "",
        calculated_at: Optional[datetime] = None,
        operation_key: Optional[str] = None,
    ) -> Optional[RiskScore]:
        """Calculate and persist one immutable risk-score snapshot."""
        if operation_key:
            existing = await self._scores.find_one({"operation_key": operation_key}, {"_id": 0})
            if existing:
                return RiskScore(**existing)
        work = await self._works.find_one({"work_id": work_id}, {"_id": 0})
        if not work:
            return None

        triggered_results = await self._get_latest_triggered_results(work_id)
        evidence_count = await self._evidence.count_documents({"work_id": work_id})
        duplicate_candidates = await self._find_duplicate_candidates(work)
        rule_definitions = await self._get_rule_definitions(triggered_results)

        score = self.build_score(
            work,
            triggered_results=triggered_results,
            evidence_count=evidence_count,
            duplicate_candidates=duplicate_candidates,
            rule_definitions=rule_definitions,
            calculated_at=calculated_at or datetime.now(timezone.utc),
        )

        # Phase 9 persists its own immutable prediction record.  The values
        # are copied onto this risk snapshot for alert display, while the
        # deterministic composite-score model version remains unchanged.
        try:
            from app.ml.inference import ModelInferenceService

            prediction = await ModelInferenceService(self._db).predict_work(
                work_id, prediction_timestamp=score.calculated_at
            )
            if prediction:
                supporting_data = dict(score.supporting_data)
                supporting_data["model_prediction"] = {
                    "collection": "model_predictions",
                    "prediction_id": prediction.prediction_id,
                    "model_version": prediction.model_version,
                    "inference_source": prediction.inference_source,
                }
                score = score.model_copy(
                    update={
                        "delay_probability": prediction.delay_probability,
                        "anomaly_score": prediction.anomaly_score,
                        "supporting_data": supporting_data,
                    }
                )
        except Exception as exc:
            # Risk scoring must remain available if the optional numerical ML
            # runtime is not installed or a model registry is temporarily down.
            logger.warning("ML prediction could not be attached to risk score %s: %s", work_id, type(exc).__name__)

        # The score document is append-only.  Work holds a denormalised latest
        # value only for list views; historical score snapshots remain intact.
        score_document = score.model_dump(mode="python")
        if operation_key:
            score_document["operation_key"] = operation_key
        await self._scores.insert_one(score_document)
        await self._works.update_one(
            {"work_id": work_id},
            {
                "$set": {
                    "composite_risk_score": score.composite_score,
                    "risk_tier": score.risk_tier.value,
                    "updated_at": score.calculated_at,
                }
            },
        )

        await self._audit.log_event(
            AuditEventType.RISK_SCORE_CALCULATED,
            user_id=calculated_by,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="risk_score",
            resource_id=score.score_id,
            details={
                "work_id": work_id,
                "composite_score": score.composite_score,
                "risk_tier": score.risk_tier.value,
                "score_version": score.score_version,
                "model_version": score.model_version,
            },
        )
        return score

    @classmethod
    def build_score(
        cls,
        work: dict[str, Any],
        *,
        triggered_results: Iterable[dict[str, Any]],
        evidence_count: int,
        duplicate_candidates: Iterable[dict[str, Any]],
        rule_definitions: Optional[dict[str, dict[str, Any]]] = None,
        calculated_at: Optional[datetime] = None,
    ) -> RiskScore:
        """
        Produce the deterministic scoring result from already-fetched inputs.

        No database state, random value, or current clock is read in this
        method.  Passing the same inputs and ``calculated_at`` always produces
        the same score, sub-scores, confidence, factors, and snapshots.
        """
        rule_definitions = rule_definitions or {}
        now = calculated_at or datetime.now(timezone.utc)
        results = cls._dedupe_results(triggered_results)
        duplicates = sorted(
            [dict(candidate) for candidate in duplicate_candidates],
            key=lambda candidate: str(candidate.get("work_id", "")),
        )

        def category_for(result: dict[str, Any]) -> str:
            code = str(result.get("rule_code", ""))
            return str(
                rule_definitions.get(code, {}).get(
                    "category", RULE_CATEGORIES.get(code, "documentation")
                )
            )

        timeline_results = [r for r in results if category_for(r) == "timeline"]
        financial_results = [r for r in results if category_for(r) == "financial"]
        evidence_results = [r for r in results if category_for(r) == "documentation"]

        sanctioned = _number(work.get("sanctioned_amount"))
        released = _number(work.get("funds_released"))
        progress = _clamp(_number(work.get("physical_progress_pct")))
        over_release_pct = (
            max(0.0, ((released - sanctioned) / sanctioned) * 100)
            if sanctioned > 0
            else 0.0
        )

        time_raw = _rule_score(timeline_results)
        financial_raw = max(_rule_score(financial_results), _round(over_release_pct * 5))
        duplicate_raw = _round(len(duplicates) * 50)
        evidence_missing_score = 100.0 if evidence_count == 0 and progress >= 30 else 0.0
        evidence_raw = max(_rule_score(evidence_results), evidence_missing_score)
        compliance_raw = _rule_score(results)

        raw_scores = {
            "time_risk": time_raw,
            "financial_risk": financial_raw,
            "duplicate_risk": duplicate_raw,
            "evidence_risk": evidence_raw,
            "compliance_risk": compliance_raw,
        }
        factor_text = {
            "time_risk": _time_factor(timeline_results),
            "financial_risk": _financial_factor(financial_results, over_release_pct),
            "duplicate_risk": _duplicate_factor(duplicates),
            "evidence_risk": _evidence_factor(evidence_results, evidence_count, progress),
            "compliance_risk": _compliance_factor(results),
        }

        sub_scores = [
            SubScore(
                dimension=dimension,
                label=DIMENSION_LABELS[dimension],
                raw_score=raw_scores[dimension],
                weight=DEFAULT_WEIGHTS[dimension],
                weighted_score=_round(raw_scores[dimension] * DEFAULT_WEIGHTS[dimension]),
                factors=[factor_text[dimension]],
            )
            for dimension in DEFAULT_WEIGHTS
        ]
        composite_score = round(sum(score.weighted_score for score in sub_scores), 2)
        tier = cls._tier_for(composite_score)

        triggered_rules = [
            TriggeredRule(
                rule_code=str(result.get("rule_code", "")),
                rule_name=str(
                    rule_definitions.get(str(result.get("rule_code", "")), {}).get(
                        "name", RULE_NAMES.get(str(result.get("rule_code", "")), result.get("rule_code", "Unknown rule"))
                    )
                ),
                severity=str(result.get("severity", "advisory")),
                contribution=_severity_points(result.get("severity")),
            )
            for result in results
        ]

        ranked_dimensions = sorted(
            DEFAULT_WEIGHTS,
            key=lambda dimension: (-raw_scores[dimension], dimension),
        )
        top_factors = [
            ExplanationEntry(
                rank=index,
                factor=factor_text[dimension],
                dimension=dimension,
                impact=_impact(raw_scores[dimension]),
            )
            for index, dimension in enumerate(ranked_dimensions[:5], start=1)
        ]

        feature_snapshot = {
            "schema_version": "risk-features-v1",
            "work": {
                "work_id": str(work.get("work_id", "")),
                "status": _primitive(work.get("status")),
                "sanctioned_amount": sanctioned,
                "funds_released": released,
                "actual_expenditure": _number(work.get("actual_expenditure")),
                "physical_progress_pct": progress,
                "has_recommended_date": bool(work.get("recommended_date")),
                "has_sanctioned_date": bool(work.get("sanctioned_date")),
                "has_expected_completion_date": bool(work.get("expected_completion_date")),
            },
            "compliance": {
                "triggered_rule_codes": [rule.rule_code for rule in triggered_rules],
                "triggered_rule_count": len(triggered_rules),
            },
            "evidence": {"evidence_count": int(max(0, evidence_count))},
            "duplicate": {
                "matching_work_ids": [str(candidate.get("work_id", "")) for candidate in duplicates],
                "candidate_count": len(duplicates),
                "match_method": "normalised_title_within_district",
            },
            "financial": {"over_release_pct": _round(over_release_pct)},
        }
        confidence = cls._confidence(feature_snapshot)
        explanation_snapshot = ExplanationSnapshot(
            summary=(
                f"Composite risk is {composite_score:.2f}/100 ({tier.value}) using "
                "the deterministic rules policy."
            ),
            top_factors=top_factors,
            scoring_policy={
                "weights": DEFAULT_WEIGHTS,
                "tier_thresholds": {"green": "0-34.99", "amber": "35-64.99", "red": "65-100"},
                "severity_points": SEVERITY_POINTS,
                "duplicate_rule": "50 points per exact normalised-title candidate, capped at 100",
            },
        )
        supporting_data = {
            "work": {"collection": WORKS_COLLECTION, "work_id": str(work.get("work_id", ""))},
            "compliance_results": [
                {
                    "collection": RESULTS_COLLECTION,
                    "result_id": str(result.get("result_id", "")),
                    "rule_code": str(result.get("rule_code", "")),
                }
                for result in results
            ],
            "evidence": {"collection": EVIDENCE_COLLECTION, "work_id": str(work.get("work_id", "")), "count": int(max(0, evidence_count))},
            "duplicate_candidates": [
                {"collection": WORKS_COLLECTION, "work_id": str(candidate.get("work_id", ""))}
                for candidate in duplicates
            ],
        }

        return RiskScore(
            score_id=str(uuid4()),
            work_id=str(work.get("work_id", "")),
            composite_score=composite_score,
            risk_tier=tier,
            confidence=confidence,
            sub_scores=sub_scores,
            # ML models are intentionally not available in Phase 8.  Null is
            # safer than presenting a fabricated probability as a prediction.
            delay_probability=None,
            anomaly_score=None,
            triggered_rules=triggered_rules,
            top_factors=top_factors,
            explanation_snapshot=explanation_snapshot,
            recommended_action=cls._recommended_action(tier),
            feature_snapshot=feature_snapshot,
            model_version=MODEL_VERSION,
            score_version=SCORE_VERSION,
            calculated_at=now,
            ai_disclaimer=AI_DISCLAIMER,
            supporting_data=supporting_data,
        )

    @staticmethod
    def _dedupe_results(results: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        """Use one latest result per rule code so reruns never inflate risk."""
        ordered = sorted(
            [dict(result) for result in results],
            key=lambda result: (
                str(result.get("rule_code", "")),
                str(result.get("triggered_at", "")),
                str(result.get("result_id", "")),
            ),
            reverse=True,
        )
        unique: dict[str, dict[str, Any]] = {}
        for result in ordered:
            code = str(result.get("rule_code", ""))
            if code and code not in unique:
                unique[code] = result
        return [unique[code] for code in sorted(unique)]

    @staticmethod
    def _tier_for(score: float) -> RiskTier:
        if score >= 65:
            return RiskTier.RED
        if score >= 35:
            return RiskTier.AMBER
        return RiskTier.GREEN

    @staticmethod
    def _recommended_action(tier: RiskTier) -> str:
        return {
            RiskTier.RED: "Prioritise human review within one working day and verify the supporting records before any decision.",
            RiskTier.AMBER: "Assign to the responsible officer for verification and monitor the cited factors at the next update.",
            RiskTier.GREEN: "Continue routine monitoring and re-score when work, evidence, or compliance data changes.",
        }[tier]

    @staticmethod
    def _confidence(feature_snapshot: dict[str, Any]) -> float:
        """A transparent data-coverage confidence, not model certainty."""
        work = feature_snapshot["work"]
        available = sum(
            [
                bool(work["has_recommended_date"] or work["has_sanctioned_date"] or work["has_expected_completion_date"]),
                work["sanctioned_amount"] > 0,
                "physical_progress_pct" in work,
                "evidence_count" in feature_snapshot["evidence"],
                "candidate_count" in feature_snapshot["duplicate"],
                "triggered_rule_count" in feature_snapshot["compliance"],
            ]
        )
        return round(min(0.95, 0.35 + (available / 6) * 0.60), 2)

    async def _get_latest_triggered_results(self, work_id: str) -> list[dict[str, Any]]:
        cursor = self._results.find(
            {"work_id": work_id, "status": "deviation_detected"}, {"_id": 0}
        ).sort([("triggered_at", -1), ("result_id", 1)])
        return self._dedupe_results(await cursor.to_list(length=None))

    async def _get_rule_definitions(self, results: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        definitions: dict[str, dict[str, Any]] = {}
        for code in sorted({str(result.get("rule_code", "")) for result in results if result.get("rule_code")}):
            doc = await self._rules.find_one({"rule_code": code}, sort=[("version", -1)])
            if doc:
                definitions[code] = doc
        return definitions

    async def _find_duplicate_candidates(self, work: dict[str, Any]) -> list[dict[str, Any]]:
        """Find conservative exact-title candidates in the same district."""
        title_key = _normalise_title(work.get("title"))
        if not title_key:
            return []

        query: dict[str, Any] = {"work_id": {"$ne": work.get("work_id", "")}}
        if work.get("district_code"):
            query["district_code"] = work["district_code"]
        elif work.get("state_code"):
            query["state_code"] = work["state_code"]

        cursor = self._works.find(
            query,
            {"_id": 0, "work_id": 1, "title": 1, "district_code": 1, "state_code": 1},
        ).sort("work_id", 1)
        candidates = await cursor.to_list(length=None)
        return [candidate for candidate in candidates if _normalise_title(candidate.get("title")) == title_key]

    async def get_latest_score(self, work_id: str) -> Optional[dict[str, Any]]:
        score = await self._scores.find_one(
            {"work_id": work_id}, {"_id": 0}, sort=[("calculated_at", -1), ("score_id", 1)]
        )
        if score:
            work_doc = await self._works.find_one(
                {"work_id": work_id},
                {"_id": 0, "title": 1, "district_name": 1, "state_name": 1, "mp_name": 1},
            )
            if work_doc:
                score["work_title"] = work_doc.get("title")
                score["district_name"] = work_doc.get("district_name")
                score["state_name"] = work_doc.get("state_name")
                score["mp_name"] = work_doc.get("mp_name")
        return score

    async def list_latest_scores(
        self,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
        tier: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int, int]:
        """List the newest score per work and preserve jurisdiction scoping."""
        work_ids: Optional[list[str]] = None
        if jurisdiction_filter:
            works = await self._works.find(jurisdiction_filter, {"_id": 0, "work_id": 1}).to_list(length=None)
            work_ids = [str(work["work_id"]) for work in works]
            if not work_ids:
                return [], 0, 1

        query: dict[str, Any] = {}
        if work_ids is not None:
            query["work_id"] = {"$in": work_ids}
        all_scores = await self._scores.find(query, {"_id": 0}).sort(
            [("calculated_at", -1), ("score_id", 1)]
        ).to_list(length=None)

        latest_by_work: dict[str, dict[str, Any]] = {}
        for score in all_scores:
            latest_by_work.setdefault(str(score["work_id"]), score)
        latest = list(latest_by_work.values())
        # Tier filtering must happen after reducing to the newest snapshot;
        # otherwise an old red alert could be returned for a now-green work.
        if tier:
            latest = [score for score in latest if score.get("risk_tier") == tier]
        total = len(latest)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        page_scores = latest[start : start + page_size]

        page_work_ids = [str(s.get("work_id")) for s in page_scores if s.get("work_id")]
        if page_work_ids:
            work_docs = await self._works.find(
                {"work_id": {"$in": page_work_ids}},
                {"_id": 0, "work_id": 1, "title": 1, "district_name": 1, "state_name": 1, "mp_name": 1},
            ).to_list(length=None)
            work_meta_map = {str(w.get("work_id")): w for w in work_docs if "work_id" in w}
            for s in page_scores:
                meta = work_meta_map.get(str(s.get("work_id")), {})
                s["work_title"] = meta.get("title")
                s["district_name"] = meta.get("district_name")
                s["state_name"] = meta.get("state_name")
                s["mp_name"] = meta.get("mp_name")

        return page_scores, total, total_pages

    async def distribution(self, jurisdiction_filter: Optional[dict[str, Any]] = None) -> RiskDistribution:
        scores, total, _ = await self.list_latest_scores(
            jurisdiction_filter=jurisdiction_filter,
            page=1,
            page_size=100000,
        )
        counts = {tier.value: 0 for tier in RiskTier}
        for score in scores:
            if score.get("risk_tier") in counts:
                counts[score["risk_tier"]] += 1
        average = round(sum(_number(score.get("composite_score")) for score in scores) / total, 2) if total else 0.0
        return RiskDistribution(
            green=counts["green"], amber=counts["amber"], red=counts["red"],
            total=total, avg_composite_score=average,
        )

    async def score_batch(
        self,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
        work_ids: Optional[list[str]] = None,
        calculated_by: str = "system",
        ip_address: str = "",
        user_agent: str = "",
    ) -> BatchScoreResponse:
        started = time.monotonic()
        query = dict(jurisdiction_filter or {})
        if work_ids is not None:
            query["work_id"] = {"$in": work_ids}
        work_docs = await self._works.find(query, {"_id": 0, "work_id": 1}).to_list(length=None)
        scores = []
        for work in work_docs:
            score = await self.score_work(
                str(work["work_id"]), calculated_by=calculated_by,
                ip_address=ip_address, user_agent=user_agent,
            )
            if score:
                scores.append(score)
        counts = {tier.value: 0 for tier in RiskTier}
        for score in scores:
            counts[score.risk_tier.value] += 1
        return BatchScoreResponse(
            works_scored=len(scores), green=counts["green"], amber=counts["amber"], red=counts["red"],
            avg_score=round(sum(score.composite_score for score in scores) / len(scores), 2) if scores else 0.0,
            duration_ms=int((time.monotonic() - started) * 1000),
        )


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _primitive(value: Any) -> Any:
    if hasattr(value, "value"):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _codes(results: Iterable[dict[str, Any]]) -> str:
    codes = [str(result.get("rule_code", "")) for result in results if result.get("rule_code")]
    return ", ".join(sorted(codes)) if codes else "no triggered rules"


def _time_factor(results: list[dict[str, Any]]) -> str:
    return f"{len(results)} timeline compliance deviation(s): {_codes(results)}."


def _financial_factor(results: list[dict[str, Any]], over_release_pct: float) -> str:
    if over_release_pct > 0:
        return f"Funds released exceed sanctioned amount by {_round(over_release_pct):.2f}% ({_codes(results)})."
    return f"{len(results)} financial compliance deviation(s): {_codes(results)}."


def _duplicate_factor(candidates: list[dict[str, Any]]) -> str:
    if not candidates:
        return "No exact normalised-title duplicate candidates were found within the available jurisdiction."
    return f"{len(candidates)} exact normalised-title duplicate candidate(s): {', '.join(str(c.get('work_id', '')) for c in candidates)}."


def _evidence_factor(results: list[dict[str, Any]], evidence_count: int, progress: float) -> str:
    if evidence_count == 0 and progress >= 30:
        return f"No evidence records are linked despite {progress:.2f}% physical progress ({_codes(results)})."
    return f"{len(results)} documentation compliance deviation(s); {max(0, evidence_count)} evidence record(s) linked."


def _compliance_factor(results: list[dict[str, Any]]) -> str:
    return f"{len(results)} unique compliance deviation(s) contribute to the overall compliance signal: {_codes(results)}."
