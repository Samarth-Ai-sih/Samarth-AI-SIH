"""Phase 10 financial intelligence calculations against a Mongo-compatible collection."""

from datetime import datetime, timezone

import pytest

from app.services.financial_intelligence_service import FinancialIntelligenceService
from tests.test_risk_scoring import MemoryDatabase


NOW = datetime(2026, 9, 8, tzinfo=timezone.utc)


def _work(
    number: int,
    *,
    category: str = "healthcare",
    sanctioned: float = 1_000_000,
    released: float = 600_000,
    expenditure: float = 400_000,
    physical: float = 50,
    agency: str = "Agency Alpha",
) -> dict:
    return {
        "work_id": f"financial-work-{number}",
        "title": f"Financial work {number}",
        "status": "in_progress",
        "category": category,
        "state_code": "UP",
        "state_name": "Uttar Pradesh",
        "district_code": "LKO",
        "district_name": "Lucknow",
        "implementing_agency": agency,
        "sanctioned_amount": sanctioned,
        "funds_released": released,
        "actual_expenditure": expenditure,
        "physical_progress_pct": physical,
        "updated_at": NOW,
        "payment_tranches": [],
    }


@pytest.mark.asyncio
async def test_dashboard_calculates_financial_progress_and_safe_review_tables_from_mongodb_data():
    works = [
        _work(
            1,
            released=900_000,
            expenditure=800_000,
            physical=20,
            agency="Agency Alpha",
        ),
        _work(2),
        _work(3),
        _work(4),
        _work(5, sanctioned=1_700_000, released=500_000, expenditure=200_000, physical=60, agency="Agency Beta"),
        _work(6, category="education", expenditure=200_000, physical=60, agency="Agency Gamma"),
    ]
    works[0]["payment_tranches"] = [
        {"amount": 400_000, "released_date": "2026-01-15T00:00:00+00:00"},
        {"amount": 500_000, "released_date": "2026-02-15T00:00:00+00:00"},
    ]
    db = MemoryDatabase({"works": works})

    dashboard = await FinancialIntelligenceService(db).dashboard(jurisdiction_filter={"state_code": "UP"})

    assert dashboard.summary.work_count == 6
    assert dashboard.summary.total_sanctioned_amount == 6_700_000
    assert dashboard.summary.total_funds_released == 3_800_000
    assert dashboard.summary.total_actual_expenditure == 2_400_000
    assert dashboard.summary.amount_at_risk == 480_000
    assert dashboard.summary.works_requiring_verification == 2
    assert [point.period for point in dashboard.payment_timeline] == ["2026-01", "2026-02"]
    assert dashboard.payment_timeline[0].released_amount == 400_000

    assert len(dashboard.cost_outliers) == 1
    assert dashboard.cost_outliers[0].work_id == "financial-work-5"
    assert dashboard.cost_outliers[0].label == "Possible financial irregularity"
    assert dashboard.cost_outliers[0].verification_status == "Requires verification"

    assert len(dashboard.high_spend_low_progress) == 1
    assert dashboard.high_spend_low_progress[0].work_id == "financial-work-1"
    assert dashboard.high_spend_low_progress[0].label == "Possible financial irregularity"
    assert dashboard.agency_anomaly_ranking[0].implementing_agency == "Agency Alpha"
    assert dashboard.amount_at_risk_trend[0].amount_at_risk == 480_000
    assert "not findings of fraud" in dashboard.review_notice


@pytest.mark.asyncio
async def test_dashboard_filters_and_filter_options_remain_jurisdiction_scoped():
    db = MemoryDatabase({
        "works": [
            _work(1, category="healthcare"),
            _work(2, category="education", agency="Agency Beta"),
            {**_work(3), "state_code": "BR", "state_name": "Bihar"},
        ],
    })
    service = FinancialIntelligenceService(db)

    dashboard = await service.dashboard(
        jurisdiction_filter={"state_code": "UP"}, category="education",
    )
    filters = await service.get_filter_options(jurisdiction_filter={"state_code": "UP"})

    assert dashboard.summary.work_count == 1
    assert dashboard.financial_physical_scatter[0].category == "education"
    assert [option.value for option in filters.states] == ["UP"]
    assert {option.value for option in filters.categories} == {"education", "healthcare"}
