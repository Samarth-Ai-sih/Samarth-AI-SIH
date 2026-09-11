"""MongoDB-backed, explainable financial intelligence calculations for Phase 10."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from statistics import median
from typing import Any, Optional

from app.core.database import Database
from app.models.financial import (
    AgencyAnomalyRanking,
    AmountAtRiskTrendPoint,
    CostBenchmark,
    CostOutlier,
    FinancialDashboardResponse,
    FinancialFilterOption,
    FinancialFilterOptions,
    FinancialScatterPoint,
    FinancialSummary,
    HighSpendLowProgress,
    PaymentTimelinePoint,
)

logger = logging.getLogger("samarth.financial_intelligence")

WORKS_COLLECTION = "works"
MINIMUM_PEER_COUNT = 5
COST_OUTLIER_RATIO = 1.5
HIGH_SPEND_PCT = 70.0
LOW_PROGRESS_PCT = 35.0
REVIEW_GAP_PCT = 30.0


class FinancialIntelligenceService:
    """Builds financial analytics strictly from the scoped MongoDB ``works`` data."""

    def __init__(self, db: Database):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)

    async def ensure_indexes(self) -> None:
        """Indexes supporting jurisdiction-scoped filters and peer comparisons."""
        await self._works.create_index([("state_code", 1), ("district_code", 1)])
        await self._works.create_index([("category", 1), ("sanctioned_amount", 1)])
        await self._works.create_index([("implementing_agency", 1), ("updated_at", -1)])
        logger.info("Financial-intelligence indexes ensured")

    async def get_filter_options(self, *, jurisdiction_filter: Optional[dict[str, Any]] = None) -> FinancialFilterOptions:
        """Return selectable values derived from MongoDB data in the caller's scope."""
        works = await self._load_works(jurisdiction_filter or {})
        return _filter_options(works)

    async def dashboard(
        self,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        state_code: Optional[str] = None,
        district_code: Optional[str] = None,
        implementing_agency: Optional[str] = None,
    ) -> FinancialDashboardResponse:
        """Build a complete financial dashboard from MongoDB work documents."""
        # Preserve the dependency-provided jurisdiction predicate. A caller's
        # selected state or district can narrow an unrestricted portfolio but
        # can never replace a restricted predicate with another jurisdiction.
        query = dict(jurisdiction_filter or {})
        requested_filters = {
            "status": status,
            "category": category,
            "state_code": state_code,
            "district_code": district_code,
            "implementing_agency": implementing_agency,
        }
        for field, value in requested_filters.items():
            if value and field not in query:
                query[field] = value

        works = await self._load_works(query)
        analytics = [_normalise_work(work) for work in works]
        peer_stats = _peer_stats(analytics)
        outlier_ids = _cost_outlier_ids(analytics, peer_stats)
        high_spend_ids = {
            item["work_id"] for item in analytics if _is_high_spend_low_progress(item)
        }
        review_ids = outlier_ids | high_spend_ids | {
            item["work_id"] for item in analytics if item["gap_pct"] >= REVIEW_GAP_PCT
        }

        return FinancialDashboardResponse(
            summary=_summary(analytics, review_ids),
            financial_physical_scatter=_scatter_points(analytics, review_ids),
            payment_timeline=_payment_timeline(analytics),
            cost_benchmarks=_cost_benchmarks(peer_stats),
            cost_outliers=_cost_outliers(analytics, peer_stats, outlier_ids),
            high_spend_low_progress=_high_spend_low_progress(analytics, high_spend_ids),
            agency_anomaly_ranking=_agency_rankings(analytics, review_ids),
            amount_at_risk_trend=_amount_at_risk_trend(analytics),
        )

    async def _load_works(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        projection = {
            "_id": 0,
            "work_id": 1,
            "title": 1,
            "status": 1,
            "category": 1,
            "state_code": 1,
            "state_name": 1,
            "district_code": 1,
            "district_name": 1,
            "implementing_agency": 1,
            "sanctioned_amount": 1,
            "funds_released": 1,
            "actual_expenditure": 1,
            "physical_progress_pct": 1,
            "payment_tranches": 1,
            "created_at": 1,
            "updated_at": 1,
        }
        cursor = self._works.find(query, projection).sort([("updated_at", -1), ("work_id", 1)])
        return await cursor.to_list(length=None)


def _normalise_work(work: dict[str, Any]) -> dict[str, Any]:
    sanctioned = _non_negative(work.get("sanctioned_amount"))
    released = _non_negative(work.get("funds_released"))
    expenditure = _non_negative(work.get("actual_expenditure"))
    physical = _clamp(_number(work.get("physical_progress_pct")))
    financial = _percentage(expenditure, sanctioned)
    gap = financial - physical
    # This is an explainable review-priority figure, not an estimate of loss:
    # expenditure weighted by the share by which financial progress leads physical progress.
    amount_at_risk = expenditure * max(gap, 0.0) / 100.0
    return {
        "work_id": str(work.get("work_id", "")),
        "title": str(work.get("title", "Untitled work")),
        "status": str(work.get("status", "")),
        "category": str(work.get("category", "other")),
        "state_code": str(work.get("state_code", "")),
        "state_name": str(work.get("state_name", "")),
        "district_code": str(work.get("district_code", "")),
        "district_name": str(work.get("district_name", "")),
        "implementing_agency": str(work.get("implementing_agency") or "Not recorded"),
        "sanctioned": sanctioned,
        "released": released,
        "expenditure": expenditure,
        "financial_pct": financial,
        "physical_pct": physical,
        "gap_pct": gap,
        "amount_at_risk": amount_at_risk,
        "payment_tranches": list(work.get("payment_tranches") or []),
        "updated_at": _as_datetime(work.get("updated_at")) or _as_datetime(work.get("created_at")),
    }


def _summary(works: list[dict[str, Any]], review_ids: set[str]) -> FinancialSummary:
    sanctioned = sum(item["sanctioned"] for item in works)
    released = sum(item["released"] for item in works)
    expenditure = sum(item["expenditure"] for item in works)
    financial = _percentage(expenditure, sanctioned)
    physical = (
        sum(item["sanctioned"] * item["physical_pct"] for item in works) / sanctioned
        if sanctioned else 0.0
    )
    return FinancialSummary(
        work_count=len(works),
        total_sanctioned_amount=_round(sanctioned),
        total_funds_released=_round(released),
        total_actual_expenditure=_round(expenditure),
        funds_released_vs_sanctioned_pct=_round(_percentage(released, sanctioned)),
        actual_expenditure_vs_sanctioned_pct=_round(financial),
        financial_progress_pct=_round(financial),
        physical_progress_pct=_round(physical),
        financial_physical_gap_pct=_round(financial - physical),
        amount_at_risk=_round(sum(item["amount_at_risk"] for item in works)),
        works_requiring_verification=len(review_ids),
        calculation_note=(
            "Financial progress is actual expenditure ÷ sanctioned amount. Physical progress is "
            "sanction-weighted. Amount at risk is a review-priority amount based on the excess "
            "financial-progress gap; it is not an estimate of loss."
        ),
    )


def _scatter_points(works: list[dict[str, Any]], review_ids: set[str]) -> list[FinancialScatterPoint]:
    ordered = sorted(works, key=lambda item: (-item["amount_at_risk"], item["work_id"]))[:500]
    return [
        FinancialScatterPoint(
            work_id=item["work_id"],
            title=item["title"],
            category=item["category"],
            implementing_agency=item["implementing_agency"],
            sanctioned_amount=_round(item["sanctioned"]),
            funds_released=_round(item["released"]),
            actual_expenditure=_round(item["expenditure"]),
            financial_progress_pct=_round(item["financial_pct"]),
            physical_progress_pct=_round(item["physical_pct"]),
            financial_physical_gap_pct=_round(item["gap_pct"]),
            review_label="Requires verification" if item["work_id"] in review_ids else None,
        )
        for item in ordered
    ]


def _payment_timeline(works: list[dict[str, Any]]) -> list[PaymentTimelinePoint]:
    timeline: dict[str, dict[str, float]] = defaultdict(lambda: {"released": 0.0, "count": 0.0})
    for item in works:
        for tranche in item["payment_tranches"]:
            released_date = _as_datetime(tranche.get("released_date"))
            if not released_date:
                continue
            period = released_date.strftime("%Y-%m")
            timeline[period]["released"] += _non_negative(tranche.get("amount"))
            timeline[period]["count"] += 1
    return [
        PaymentTimelinePoint(
            period=period,
            released_amount=_round(values["released"]),
            tranche_count=int(values["count"]),
        )
        for period, values in sorted(timeline.items())
    ]


def _peer_stats(works: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    groups: dict[str, list[float]] = defaultdict(list)
    for item in works:
        if item["sanctioned"] > 0:
            groups[item["category"]].append(item["sanctioned"])
    return {
        category: {
            "count": float(len(amounts)),
            "average": sum(amounts) / len(amounts),
            "median": float(median(amounts)),
        }
        for category, amounts in groups.items()
    }


def _cost_outlier_ids(works: list[dict[str, Any]], stats: dict[str, dict[str, float]]) -> set[str]:
    return {
        item["work_id"]
        for item in works
        if (
            stats.get(item["category"], {}).get("count", 0) >= MINIMUM_PEER_COUNT
            and stats[item["category"]]["median"] > 0
            and item["sanctioned"] / stats[item["category"]]["median"] >= COST_OUTLIER_RATIO
        )
    }


def _cost_benchmarks(stats: dict[str, dict[str, float]]) -> list[CostBenchmark]:
    return [
        CostBenchmark(
            category=category,
            peer_count=int(values["count"]),
            average_sanctioned_amount=_round(values["average"]),
            median_sanctioned_amount=_round(values["median"]),
        )
        for category, values in sorted(stats.items())
    ]


def _cost_outliers(
    works: list[dict[str, Any]], stats: dict[str, dict[str, float]], outlier_ids: set[str],
) -> list[CostOutlier]:
    outliers = []
    for item in works:
        if item["work_id"] not in outlier_ids:
            continue
        peer = stats[item["category"]]
        outliers.append(CostOutlier(
            work_id=item["work_id"],
            title=item["title"],
            category=item["category"],
            implementing_agency=item["implementing_agency"],
            sanctioned_amount=_round(item["sanctioned"]),
            peer_count=int(peer["count"]),
            peer_median_sanctioned_amount=_round(peer["median"]),
            cost_ratio_to_peer_median=_round(item["sanctioned"] / peer["median"]),
        ))
    return sorted(outliers, key=lambda item: (-item.cost_ratio_to_peer_median, item.work_id))[:50]


def _is_high_spend_low_progress(item: dict[str, Any]) -> bool:
    return item["financial_pct"] >= HIGH_SPEND_PCT and item["physical_pct"] <= LOW_PROGRESS_PCT


def _high_spend_low_progress(works: list[dict[str, Any]], flagged_ids: set[str]) -> list[HighSpendLowProgress]:
    records = [
        HighSpendLowProgress(
            work_id=item["work_id"],
            title=item["title"],
            category=item["category"],
            implementing_agency=item["implementing_agency"],
            sanctioned_amount=_round(item["sanctioned"]),
            actual_expenditure=_round(item["expenditure"]),
            financial_progress_pct=_round(item["financial_pct"]),
            physical_progress_pct=_round(item["physical_pct"]),
            financial_physical_gap_pct=_round(item["gap_pct"]),
            amount_at_risk=_round(item["amount_at_risk"]),
        )
        for item in works if item["work_id"] in flagged_ids
    ]
    return sorted(records, key=lambda item: (-item.amount_at_risk, item.work_id))[:50]


def _agency_rankings(works: list[dict[str, Any]], review_ids: set[str]) -> list[AgencyAnomalyRanking]:
    agencies: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in works:
        agencies[item["implementing_agency"]].append(item)

    rankings = []
    for agency, records in agencies.items():
        flagged = [item for item in records if item["work_id"] in review_ids]
        if not flagged:
            continue
        rankings.append({
            "implementing_agency": agency,
            "work_count": len(records),
            "works_requiring_verification": len(flagged),
            "average_gap": sum(item["gap_pct"] for item in records) / len(records),
            "amount_at_risk": sum(item["amount_at_risk"] for item in records),
        })
    ordered = sorted(
        rankings,
        key=lambda item: (-item["amount_at_risk"], -item["works_requiring_verification"], item["implementing_agency"]),
    )[:30]
    return [
        AgencyAnomalyRanking(
            rank=index,
            implementing_agency=item["implementing_agency"],
            work_count=item["work_count"],
            works_requiring_verification=item["works_requiring_verification"],
            average_financial_physical_gap_pct=_round(item["average_gap"]),
            amount_at_risk=_round(item["amount_at_risk"]),
        )
        for index, item in enumerate(ordered, start=1)
    ]


def _amount_at_risk_trend(works: list[dict[str, Any]]) -> list[AmountAtRiskTrendPoint]:
    trend: dict[str, dict[str, float]] = defaultdict(lambda: {"amount": 0.0, "work_count": 0.0})
    for item in works:
        if item["amount_at_risk"] <= 0:
            continue
        timestamp = item["updated_at"] or datetime.now(timezone.utc)
        period = timestamp.strftime("%Y-%m")
        trend[period]["amount"] += item["amount_at_risk"]
        trend[period]["work_count"] += 1
    return [
        AmountAtRiskTrendPoint(
            period=period,
            amount_at_risk=_round(values["amount"]),
            work_count=int(values["work_count"]),
        )
        for period, values in sorted(trend.items())
    ]


def _filter_options(works: list[dict[str, Any]]) -> FinancialFilterOptions:
    return FinancialFilterOptions(
        states=_options(works, "state_code", "state_name"),
        districts=_options(works, "district_code", "district_name"),
        categories=_options(works, "category", "category"),
        statuses=_options(works, "status", "status"),
        agencies=_options(works, "implementing_agency", "implementing_agency"),
    )


def _options(works: list[dict[str, Any]], value_field: str, label_field: str) -> list[FinancialFilterOption]:
    values: dict[str, str] = {}
    for work in works:
        value = str(work.get(value_field) or "").strip()
        if value:
            values[value] = str(work.get(label_field) or value).strip() or value
    return [FinancialFilterOption(value=value, label=values[value]) for value in sorted(values, key=str.lower)]


def _number(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _non_negative(value: Any) -> float:
    return max(0.0, _number(value))


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _percentage(numerator: float, denominator: float) -> float:
    # Financial ratios intentionally are not capped at 100: amounts above the
    # sanctioned value are meaningful review signals and must remain visible.
    return max(0.0, (numerator / denominator) * 100.0) if denominator else 0.0


def _round(value: float) -> float:
    return round(float(value), 2)


def _as_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
        except ValueError:
            return None
    return None
