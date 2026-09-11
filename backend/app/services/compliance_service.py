"""
SAMARTH AI -- Compliance Engine Service

Configurable, versioned compliance rule engine that evaluates MPLADS works
against configurable thresholds and produces structured deviation results.

All language uses "compliance deviation" and "requires verification" --
nothing is labelled as confirmed fraud.

Responsibilities:
  - Rule CRUD with versioning (updates create new versions)
  - 11 built-in rule evaluators
  - Single-work and batch execution
  - Result storage with frozen threshold snapshots
  - Result review workflow
  - Default rule seeding
  - MongoDB index management
"""

import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.compliance import (
    BatchRunResponse,
    ComplianceResult,
    ComplianceRule,
    ResultStatus,
    ReviewStatus,
    RuleCategory,
    RuleCreateRequest,
    RuleSeverity,
    RuleUpdateRequest,
    ResultReviewRequest,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.compliance")

RULES_COLLECTION = "compliance_rules"
RESULTS_COLLECTION = "compliance_results"
WORKS_COLLECTION = "works"
EVIDENCE_COLLECTION = "evidence_metadata"
INSPECTIONS_COLLECTION = "inspections"


# =========================================================================
# DEFAULT RULE DEFINITIONS
# =========================================================================

DEFAULT_RULES: list[dict[str, Any]] = [
    {
        "rule_code": "REC_SANC_DELAY",
        "name": "Recommendation-to-Sanction Delay",
        "description": "Flags works where the time between recommendation and sanction exceeds the configured threshold. Requires verification of administrative delay.",
        "severity": "warning",
        "category": "timeline",
        "thresholds": {"max_days": 90},
    },
    {
        "rule_code": "COMPLETION_OVERDUE",
        "name": "Planned Completion Exceeded While Incomplete",
        "description": "Flags works that have passed their expected completion date but are not yet marked as completed. Requires verification of delay reasons.",
        "severity": "warning",
        "category": "timeline",
        "thresholds": {"grace_days": 30},
    },
    {
        "rule_code": "MISSING_PROGRESS_UPDATE",
        "name": "Missing Progress Update",
        "description": "Flags in-progress works with no progress update within the configured window. Requires verification of reporting compliance.",
        "severity": "advisory",
        "category": "documentation",
        "thresholds": {"max_days_gap": 90},
    },
    {
        "rule_code": "MISSING_INSPECTION",
        "name": "Missing Inspection Report",
        "description": "Flags in-progress works that have not had an inspection within the configured period. Requires verification of inspection scheduling.",
        "severity": "warning",
        "category": "documentation",
        "thresholds": {"required_after_days": 180},
    },
    {
        "rule_code": "MISSING_EVIDENCE",
        "name": "Missing Documents or Photos",
        "description": "Flags works that have reached a physical progress threshold but have no uploaded evidence. Requires verification of documentation compliance.",
        "severity": "advisory",
        "category": "documentation",
        "thresholds": {"required_after_pct": 30},
    },
    {
        "rule_code": "INVALID_DATE_SEQUENCE",
        "name": "Invalid Date Sequence",
        "description": "Flags works where dates are out of logical order (e.g. start date before sanction date). Requires verification of data entry accuracy.",
        "severity": "critical",
        "category": "timeline",
        "thresholds": {},
    },
    {
        "rule_code": "COMPLETION_NO_EVIDENCE",
        "name": "Completion Without Evidence",
        "description": "Flags works marked as completed or under verification that have zero evidence records. Requires verification before final acceptance.",
        "severity": "critical",
        "category": "documentation",
        "thresholds": {},
    },
    {
        "rule_code": "FUNDS_EXCEED_SANCTIONED",
        "name": "Funds Above Sanctioned Amount",
        "description": "Flags works where released funds exceed the sanctioned amount beyond a configured tolerance. Requires verification of financial records.",
        "severity": "critical",
        "category": "financial",
        "thresholds": {"tolerance_pct": 5},
    },
    {
        "rule_code": "PAYMENT_PROGRESS_MISMATCH",
        "name": "Payment and Progress Inconsistency",
        "description": "Flags works where the percentage of funds released and physical progress diverge significantly. Compliance deviation requires verification.",
        "severity": "warning",
        "category": "financial",
        "thresholds": {"max_divergence_pct": 30},
    },
    {
        "rule_code": "LOCATION_JURISDICTION_ISSUE",
        "name": "Location or Jurisdiction Issue",
        "description": "Flags works whose geographic coordinates fall outside the expected district boundaries. Requires verification of location data.",
        "severity": "advisory",
        "category": "location",
        "thresholds": {"max_distance_km": 50},
    },
    {
        "rule_code": "ALLOCATION_THRESHOLD",
        "name": "Work Eligibility and Allocation Threshold",
        "description": "Flags works whose sanctioned cost exceeds per-work or annual allocation limits. Requires verification of allocation compliance.",
        "severity": "warning",
        "category": "eligibility",
        "thresholds": {"max_per_work": 25000000, "max_annual_per_mp": 50000000},
    },
]


# =========================================================================
# RULE EVALUATOR FUNCTIONS
# =========================================================================
# Each evaluator takes (work_doc, thresholds, context) and returns
# (status, message, supporting_data).

def _eval_rec_sanc_delay(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 1: Recommendation-to-sanction delay."""
    rec = work.get("recommended_date")
    sanc = work.get("sanctioned_date")
    if not rec or not sanc:
        return ResultStatus.NOT_APPLICABLE, "Dates not available for evaluation.", {}

    rec_dt = _parse_dt(rec)
    sanc_dt = _parse_dt(sanc)
    if not rec_dt or not sanc_dt:
        return ResultStatus.NOT_APPLICABLE, "Could not parse dates.", {}

    delta_days = (sanc_dt - rec_dt).days
    max_days = thresholds.get("max_days", 90)

    if delta_days > max_days:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: {delta_days} days between recommendation and sanction (threshold: {max_days} days). Requires verification.",
            {"actual_days": delta_days, "threshold_days": max_days, "recommended_date": str(rec), "sanctioned_date": str(sanc)},
        )
    return ResultStatus.COMPLIANT, f"Sanction within {delta_days} days of recommendation.", {"actual_days": delta_days}


def _eval_completion_overdue(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 2: Expected completion exceeded while incomplete."""
    status = work.get("status", "")
    if status in ("completed", "under_verification", "cancelled", "recommended", "under_review"):
        return ResultStatus.NOT_APPLICABLE, "Work status not subject to this rule.", {}

    exp = work.get("expected_completion_date")
    if not exp:
        return ResultStatus.NOT_APPLICABLE, "No expected completion date set.", {}

    exp_dt = _parse_dt(exp)
    if not exp_dt:
        return ResultStatus.NOT_APPLICABLE, "Could not parse expected completion date.", {}

    grace = thresholds.get("grace_days", 30)
    deadline = exp_dt + timedelta(days=grace)
    now = datetime.now(timezone.utc)

    if now > deadline:
        overdue_days = (now - exp_dt).days
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: work is {overdue_days} days past expected completion (grace: {grace} days). Requires verification.",
            {"overdue_days": overdue_days, "expected_completion": str(exp), "grace_days": grace},
        )
    return ResultStatus.COMPLIANT, "Work is within expected timeline.", {}


def _eval_missing_progress_update(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 3: Missing progress update."""
    status = work.get("status", "")
    if status not in ("in_progress", "sanctioned"):
        return ResultStatus.NOT_APPLICABLE, "Work is not in an active phase.", {}

    updates = work.get("progress_updates", [])
    max_gap = thresholds.get("max_days_gap", 90)
    now = datetime.now(timezone.utc)

    if not updates:
        start = work.get("start_date") or work.get("sanctioned_date")
        if start:
            start_dt = _parse_dt(start)
            if start_dt and (now - start_dt).days > max_gap:
                return (
                    ResultStatus.DEVIATION_DETECTED,
                    f"Compliance deviation: no progress updates recorded since work started ({(now - start_dt).days} days). Requires verification.",
                    {"days_since_start": (now - start_dt).days, "max_gap_days": max_gap},
                )
        return ResultStatus.COMPLIANT, "No progress updates expected yet.", {}

    # Find the latest update date
    latest = max((_parse_dt(u.get("date", "")) for u in updates if _parse_dt(u.get("date", ""))), default=None)
    if latest:
        gap = (now - latest).days
        if gap > max_gap:
            return (
                ResultStatus.DEVIATION_DETECTED,
                f"Compliance deviation: last progress update was {gap} days ago (threshold: {max_gap} days). Requires verification.",
                {"days_since_last_update": gap, "max_gap_days": max_gap, "last_update_date": str(latest)},
            )
    return ResultStatus.COMPLIANT, "Progress updates are within the reporting window.", {}


def _eval_missing_inspection(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 4: Missing inspection report."""
    status = work.get("status", "")
    if status not in ("in_progress", "on_hold"):
        return ResultStatus.NOT_APPLICABLE, "Inspection check applies only to active works.", {}

    start = work.get("start_date")
    if not start:
        return ResultStatus.NOT_APPLICABLE, "No start date available.", {}

    start_dt = _parse_dt(start)
    if not start_dt:
        return ResultStatus.NOT_APPLICABLE, "Could not parse start date.", {}

    required_after = thresholds.get("required_after_days", 180)
    now = datetime.now(timezone.utc)
    days_active = (now - start_dt).days

    if days_active < required_after:
        return ResultStatus.COMPLIANT, f"Work has been active for {days_active} days; inspection not yet required.", {}

    # Check inspections collection via context
    inspections = ctx.get("inspections", [])
    if not inspections:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: work has been active for {days_active} days with no inspection recorded (required after {required_after} days). Requires verification.",
            {"days_active": days_active, "required_after_days": required_after, "inspections_found": 0},
        )
    return ResultStatus.COMPLIANT, f"Inspection record found ({len(inspections)} inspection(s)).", {"inspections_found": len(inspections)}


def _eval_missing_evidence(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 5: Missing documents/photos."""
    status = work.get("status", "")
    if status in ("recommended", "under_review", "cancelled"):
        return ResultStatus.NOT_APPLICABLE, "Evidence check not applicable at this stage.", {}

    pct = work.get("physical_progress_pct", 0)
    required_after_pct = thresholds.get("required_after_pct", 30)

    if pct < required_after_pct:
        return ResultStatus.COMPLIANT, f"Physical progress ({pct}%) below evidence threshold ({required_after_pct}%).", {}

    evidence_count = ctx.get("evidence_count", 0)
    if evidence_count == 0:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: physical progress at {pct}% but no evidence documents/photos uploaded. Requires verification.",
            {"physical_progress_pct": pct, "required_after_pct": required_after_pct, "evidence_count": 0},
        )
    return ResultStatus.COMPLIANT, f"{evidence_count} evidence record(s) found.", {"evidence_count": evidence_count}


def _eval_invalid_date_sequence(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 6: Invalid date sequence."""
    dates = {}
    for key in ("recommended_date", "sanctioned_date", "start_date", "expected_completion_date", "actual_completion_date"):
        val = work.get(key)
        if val:
            dt = _parse_dt(val)
            if dt:
                dates[key] = dt

    violations = []
    # Check logical ordering
    pairs = [
        ("recommended_date", "sanctioned_date"),
        ("sanctioned_date", "start_date"),
        ("start_date", "expected_completion_date"),
        ("start_date", "actual_completion_date"),
    ]
    for earlier, later in pairs:
        if earlier in dates and later in dates:
            if dates[later] < dates[earlier]:
                violations.append(f"{later} ({dates[later].date()}) is before {earlier} ({dates[earlier].date()})")

    if violations:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: date sequence anomaly detected. Requires verification. Issues: {'; '.join(violations)}",
            {"violations": violations, "dates": {k: str(v) for k, v in dates.items()}},
        )
    return ResultStatus.COMPLIANT, "Date sequence is valid.", {}


def _eval_completion_no_evidence(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 7: Completion without evidence."""
    status = work.get("status", "")
    if status not in ("completed", "under_verification"):
        return ResultStatus.NOT_APPLICABLE, "Work is not in completed/verification phase.", {}

    evidence_count = ctx.get("evidence_count", 0)
    if evidence_count == 0:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: work is marked as '{status}' but has zero evidence records. Requires verification before acceptance.",
            {"status": status, "evidence_count": 0},
        )
    return ResultStatus.COMPLIANT, f"Completed work has {evidence_count} evidence record(s).", {"evidence_count": evidence_count}


def _eval_funds_exceed_sanctioned(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 8: Funds above sanctioned amount."""
    sanctioned = work.get("sanctioned_amount", 0)
    released = work.get("funds_released", 0)

    if sanctioned <= 0:
        return ResultStatus.NOT_APPLICABLE, "No sanctioned amount recorded.", {}

    tolerance_pct = thresholds.get("tolerance_pct", 5)
    limit = sanctioned * (1 + tolerance_pct / 100)

    if released > limit:
        excess_pct = round(((released - sanctioned) / sanctioned) * 100, 1)
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: funds released ({released:,.2f}) exceed sanctioned amount ({sanctioned:,.2f}) by {excess_pct}% (tolerance: {tolerance_pct}%). Requires verification.",
            {"sanctioned": sanctioned, "released": released, "excess_pct": excess_pct, "tolerance_pct": tolerance_pct},
        )
    return ResultStatus.COMPLIANT, "Funds within sanctioned limits.", {"sanctioned": sanctioned, "released": released}


def _eval_payment_progress_mismatch(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 9: Payment/progress inconsistency."""
    status = work.get("status", "")
    if status in ("recommended", "under_review", "cancelled"):
        return ResultStatus.NOT_APPLICABLE, "Payment-progress check not applicable at this stage.", {}

    sanctioned = work.get("sanctioned_amount", 0)
    released = work.get("funds_released", 0)
    pct = work.get("physical_progress_pct", 0)

    if sanctioned <= 0:
        return ResultStatus.NOT_APPLICABLE, "No sanctioned amount for comparison.", {}

    payment_pct = (released / sanctioned) * 100
    divergence = abs(payment_pct - pct)
    max_div = thresholds.get("max_divergence_pct", 30)

    if divergence > max_div:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: payment progress ({payment_pct:.0f}%) and physical progress ({pct:.0f}%) diverge by {divergence:.0f}% (threshold: {max_div}%). Requires verification.",
            {"payment_pct": round(payment_pct, 1), "physical_progress_pct": pct, "divergence_pct": round(divergence, 1), "max_divergence_pct": max_div},
        )
    return ResultStatus.COMPLIANT, f"Payment and progress are consistent (divergence: {divergence:.0f}%).", {"divergence_pct": round(divergence, 1)}


def _eval_location_jurisdiction(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 10: Location/jurisdiction issue."""
    loc = work.get("location", {})
    lat = loc.get("latitude")
    lng = loc.get("longitude")

    if lat is None or lng is None:
        return ResultStatus.NOT_APPLICABLE, "No location coordinates available.", {}

    # Get district center from context
    dist_lat = ctx.get("district_lat")
    dist_lng = ctx.get("district_lng")

    if dist_lat is None or dist_lng is None:
        return ResultStatus.NOT_APPLICABLE, "District reference coordinates not available.", {}

    max_km = thresholds.get("max_distance_km", 50)
    distance = _haversine_km(lat, lng, dist_lat, dist_lng)

    if distance > max_km:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: work location is {distance:.1f}km from district center (threshold: {max_km}km). Requires verification of location data.",
            {"distance_km": round(distance, 1), "max_distance_km": max_km, "work_lat": lat, "work_lng": lng, "district_lat": dist_lat, "district_lng": dist_lng},
        )
    return ResultStatus.COMPLIANT, f"Location within {distance:.1f}km of district center.", {"distance_km": round(distance, 1)}


def _eval_allocation_threshold(
    work: dict, thresholds: dict, ctx: dict
) -> tuple[ResultStatus, str, dict]:
    """Rule 11: Work eligibility and allocation thresholds."""
    sanctioned = work.get("sanctioned_amount", 0)
    max_per_work = thresholds.get("max_per_work", 25000000)

    if sanctioned > max_per_work:
        return (
            ResultStatus.DEVIATION_DETECTED,
            f"Compliance deviation: sanctioned amount ({sanctioned:,.2f}) exceeds per-work limit ({max_per_work:,.2f}). Requires verification of allocation eligibility.",
            {"sanctioned_amount": sanctioned, "max_per_work": max_per_work},
        )
    return ResultStatus.COMPLIANT, "Sanctioned amount within allocation limits.", {"sanctioned_amount": sanctioned, "max_per_work": max_per_work}


# =========================================================================
# RULE REGISTRY
# =========================================================================

RULE_EVALUATORS: dict[str, Any] = {
    "REC_SANC_DELAY": _eval_rec_sanc_delay,
    "COMPLETION_OVERDUE": _eval_completion_overdue,
    "MISSING_PROGRESS_UPDATE": _eval_missing_progress_update,
    "MISSING_INSPECTION": _eval_missing_inspection,
    "MISSING_EVIDENCE": _eval_missing_evidence,
    "INVALID_DATE_SEQUENCE": _eval_invalid_date_sequence,
    "COMPLETION_NO_EVIDENCE": _eval_completion_no_evidence,
    "FUNDS_EXCEED_SANCTIONED": _eval_funds_exceed_sanctioned,
    "PAYMENT_PROGRESS_MISMATCH": _eval_payment_progress_mismatch,
    "LOCATION_JURISDICTION_ISSUE": _eval_location_jurisdiction,
    "ALLOCATION_THRESHOLD": _eval_allocation_threshold,
}


# =========================================================================
# HELPERS
# =========================================================================

def _parse_dt(val: Any) -> Optional[datetime]:
    """Parse a datetime from string or return as-is if already datetime."""
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
    return None


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance between two points in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# =========================================================================
# COMPLIANCE SERVICE
# =========================================================================


class ComplianceService:
    """Compliance rule engine service."""

    def __init__(self, db: Database):
        self._db = db
        self._rules = db.get_collection(RULES_COLLECTION)
        self._results = db.get_collection(RESULTS_COLLECTION)
        self._works = db.get_collection(WORKS_COLLECTION)
        self._evidence = db.get_collection(EVIDENCE_COLLECTION)
        self._inspections = db.get_collection(INSPECTIONS_COLLECTION)
        self._audit = AuditService(db)

    # -- Indexes -----------------------------------------------------------

    async def ensure_indexes(self) -> None:
        """Create MongoDB indexes for compliance collections."""
        await self._rules.create_index("rule_code")
        await self._rules.create_index([("rule_code", 1), ("version", -1)], unique=True)
        await self._results.create_index("work_id")
        await self._results.create_index("rule_code")
        await self._results.create_index("status")
        await self._results.create_index("review_status")
        await self._results.create_index("triggered_at")
        logger.info("Compliance indexes ensured")

    # -- Rule CRUD ---------------------------------------------------------

    async def seed_default_rules(self, created_by: str = "system") -> int:
        """Insert default rules if they don't already exist. Returns count of new rules."""
        seeded = 0
        for rule_def in DEFAULT_RULES:
            existing = await self._rules.find_one({"rule_code": rule_def["rule_code"], "version": 1})
            if existing:
                continue
            doc = ComplianceRule(
                rule_id=str(uuid4()),
                rule_code=rule_def["rule_code"],
                version=1,
                name=rule_def["name"],
                description=rule_def["description"],
                severity=RuleSeverity(rule_def["severity"]),
                category=RuleCategory(rule_def["category"]),
                enabled=True,
                thresholds=rule_def["thresholds"],
                created_by=created_by,
            )
            await self._rules.insert_one(doc.model_dump())
            seeded += 1
        return seeded

    async def list_rules(self) -> list[dict]:
        """Return the latest version of each enabled rule."""
        pipeline = [
            {"$sort": {"version": -1}},
            {"$group": {"_id": "$rule_code", "doc": {"$first": "$$ROOT"}}},
            {"$replaceRoot": {"newRoot": "$doc"}},
            {"$sort": {"rule_code": 1}},
        ]
        return [doc async for doc in self._rules.aggregate(pipeline)]

    async def get_rule(self, rule_id: str) -> Optional[dict]:
        return await self._rules.find_one({"rule_id": rule_id})

    async def get_rule_by_code(self, rule_code: str) -> Optional[dict]:
        """Get the latest version of a rule by code."""
        cursor = self._rules.find({"rule_code": rule_code}).sort("version", -1).limit(1)
        async for doc in cursor:
            return doc
        return None

    async def create_rule(
        self, data: RuleCreateRequest, *, created_by: str,
        ip_address: str = "", user_agent: str = "",
    ) -> dict:
        """Create a new compliance rule."""
        doc = ComplianceRule(
            rule_id=str(uuid4()),
            rule_code=data.rule_code,
            version=1,
            name=data.name,
            description=data.description,
            severity=data.severity,
            category=data.category,
            enabled=data.enabled,
            thresholds=data.thresholds,
            created_by=created_by,
        )
        d = doc.model_dump()
        await self._rules.insert_one(d)

        await self._audit.log(
            event_type=AuditEventType.COMPLIANCE_RULE_CREATED,
            user_id=created_by,
            resource_type="compliance_rule",
            resource_id=doc.rule_id,
            details={"rule_code": data.rule_code},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        return d

    async def update_rule(
        self, rule_id: str, data: RuleUpdateRequest, *, updated_by: str,
        ip_address: str = "", user_agent: str = "",
    ) -> Optional[dict]:
        """Update a rule by creating a new version (old version preserved)."""
        existing = await self._rules.find_one({"rule_id": rule_id})
        if not existing:
            return None

        # Build new version
        new_version = existing.get("version", 1) + 1
        new_doc = {**existing}
        new_doc.pop("_id", None)
        new_doc["rule_id"] = str(uuid4())
        new_doc["version"] = new_version
        new_doc["updated_at"] = datetime.now(timezone.utc)

        if data.name is not None:
            new_doc["name"] = data.name
        if data.description is not None:
            new_doc["description"] = data.description
        if data.severity is not None:
            new_doc["severity"] = data.severity.value
        if data.enabled is not None:
            new_doc["enabled"] = data.enabled
        if data.thresholds is not None:
            new_doc["thresholds"] = data.thresholds

        await self._rules.insert_one(new_doc)

        await self._audit.log(
            event_type=AuditEventType.COMPLIANCE_RULE_UPDATED,
            user_id=updated_by,
            resource_type="compliance_rule",
            resource_id=new_doc["rule_id"],
            details={"rule_code": existing["rule_code"], "old_version": existing["version"], "new_version": new_version},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        return new_doc

    # -- Rule Execution ----------------------------------------------------

    async def run_compliance_check(
        self, work_id: str, *, run_by: str = "system",
        ip_address: str = "", user_agent: str = "",
    ) -> list[dict]:
        """Run all enabled rules against a single work. Returns list of results."""
        work = await self._works.find_one({"work_id": work_id})
        if not work:
            return []

        rules = await self.list_rules()
        enabled_rules = [r for r in rules if r.get("enabled", True)]

        # Build context (external data for rules that need it)
        ctx = await self._build_context(work)

        results = []
        for rule in enabled_rules:
            result = self._evaluate_rule(rule, work, ctx)
            if result:
                results.append(result)

        # Store results
        if results:
            await self._results.insert_many(results)

        # Audit log
        deviations = sum(1 for r in results if r["status"] == ResultStatus.DEVIATION_DETECTED.value)
        await self._audit.log(
            event_type=AuditEventType.COMPLIANCE_RUN,
            user_id=run_by,
            resource_type="work",
            resource_id=work_id,
            details={"rules_evaluated": len(enabled_rules), "deviations_found": deviations, "total_results": len(results)},
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return results

    async def run_batch_check(
        self, jurisdiction_filter: dict, *, run_by: str = "system",
        ip_address: str = "", user_agent: str = "",
    ) -> BatchRunResponse:
        """Run all enabled rules against all works matching jurisdiction filter."""
        start_time = time.monotonic()

        rules = await self.list_rules()
        enabled_rules = [r for r in rules if r.get("enabled", True)]

        cursor = self._works.find(jurisdiction_filter)
        all_results: list[dict] = []
        works_count = 0

        async for work in cursor:
            works_count += 1
            ctx = await self._build_context(work)

            for rule in enabled_rules:
                result = self._evaluate_rule(rule, work, ctx)
                if result:
                    all_results.append(result)

        # Bulk insert
        if all_results:
            await self._results.insert_many(all_results)

        elapsed_ms = int((time.monotonic() - start_time) * 1000)

        deviations = sum(1 for r in all_results if r["status"] == ResultStatus.DEVIATION_DETECTED.value)
        compliant = sum(1 for r in all_results if r["status"] == ResultStatus.COMPLIANT.value)
        na = sum(1 for r in all_results if r["status"] == ResultStatus.NOT_APPLICABLE.value)

        # Audit
        await self._audit.log(
            event_type=AuditEventType.COMPLIANCE_RUN,
            user_id=run_by,
            resource_type="batch",
            resource_id="all",
            details={"works_evaluated": works_count, "rules_per_work": len(enabled_rules), "deviations": deviations, "duration_ms": elapsed_ms},
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return BatchRunResponse(
            works_evaluated=works_count,
            total_results=len(all_results),
            deviations_found=deviations,
            compliant=compliant,
            not_applicable=na,
            run_duration_ms=elapsed_ms,
        )

    def _evaluate_rule(self, rule: dict, work: dict, ctx: dict) -> Optional[dict]:
        """Evaluate a single rule against a work document."""
        rule_code = rule.get("rule_code", "")
        evaluator = RULE_EVALUATORS.get(rule_code)
        if not evaluator:
            logger.warning(f"No evaluator found for rule_code={rule_code}")
            return None

        thresholds = rule.get("thresholds", {})
        try:
            status, message, supporting_data = evaluator(work, thresholds, ctx)
        except Exception as e:
            logger.error(f"Rule {rule_code} failed on work {work.get('work_id')}: {e}")
            return None

        result = ComplianceResult(
            result_id=str(uuid4()),
            rule_id=rule.get("rule_id", ""),
            rule_code=rule_code,
            work_id=work.get("work_id", ""),
            severity=RuleSeverity(rule.get("severity", "warning")),
            status=status,
            message=message,
            threshold_snapshot=dict(thresholds),
            supporting_data=supporting_data,
            review_status=ReviewStatus.PENDING_REVIEW if status == ResultStatus.DEVIATION_DETECTED else ReviewStatus.DISMISSED,
        )
        return result.model_dump()

    async def _build_context(self, work: dict) -> dict:
        """Build evaluation context with external data (inspections, evidence, district coords)."""
        work_id = work.get("work_id", "")
        ctx: dict[str, Any] = {}

        # Evidence count
        ctx["evidence_count"] = await self._evidence.count_documents({"work_id": work_id})

        # Inspections
        insp_cursor = self._inspections.find({"work_id": work_id})
        ctx["inspections"] = [doc async for doc in insp_cursor]

        # District reference coordinates
        district_code = work.get("district_code", "")
        if district_code:
            ref_dist = await self._db.get_collection("ref_districts").find_one({"district_code": district_code})
            if ref_dist:
                ctx["district_lat"] = ref_dist.get("latitude")
                ctx["district_lng"] = ref_dist.get("longitude")

        return ctx

    # -- Result Management -------------------------------------------------

    async def list_results(
        self,
        *,
        work_id: Optional[str] = None,
        rule_code: Optional[str] = None,
        status: Optional[str] = None,
        review_status: Optional[str] = None,
        severity: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict], int, int]:
        """List compliance results with filters. Returns (results, total, total_pages)."""
        query: dict[str, Any] = {}
        if work_id:
            query["work_id"] = work_id
        if rule_code:
            query["rule_code"] = rule_code
        if status:
            query["status"] = status
        if review_status:
            query["review_status"] = review_status
        if severity:
            query["severity"] = severity

        total = await self._results.count_documents(query)
        total_pages = max(1, math.ceil(total / page_size))
        skip = (page - 1) * page_size

        cursor = self._results.find(query).sort("triggered_at", -1).skip(skip).limit(page_size)
        results = [doc async for doc in cursor]

        return results, total, total_pages

    async def get_result(self, result_id: str) -> Optional[dict]:
        return await self._results.find_one({"result_id": result_id})

    async def review_result(
        self, result_id: str, data: ResultReviewRequest, *, reviewed_by: str,
        ip_address: str = "", user_agent: str = "",
    ) -> Optional[dict]:
        """Update the review status of a compliance result."""
        existing = await self._results.find_one({"result_id": result_id})
        if not existing:
            return None

        update = {
            "review_status": data.review_status.value,
            "reviewed_by": reviewed_by,
            "reviewed_at": datetime.now(timezone.utc),
            "review_notes": data.review_notes,
        }
        await self._results.update_one({"result_id": result_id}, {"$set": update})

        await self._audit.log(
            event_type=AuditEventType.COMPLIANCE_RESULT_REVIEWED,
            user_id=reviewed_by,
            resource_type="compliance_result",
            resource_id=result_id,
            details={"new_status": data.review_status.value, "work_id": existing.get("work_id"), "rule_code": existing.get("rule_code")},
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return await self._results.find_one({"result_id": result_id})
