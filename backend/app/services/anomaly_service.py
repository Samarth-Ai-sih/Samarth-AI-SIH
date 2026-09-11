"""Anomaly & Fraud Detection Service: 5-Point Evaluation, Verification Routing & Project Story Dossier."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from statistics import median
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.anomaly import (
    AnomalyCategory,
    AnomalyDiagnosis,
    AnomalySeverity,
    AuthorityOption,
    AuthorityRole,
    ProjectStoryResponse,
    UnifiedTimelineItem,
    VerificationRequestCreate,
    VerificationRequestResponse,
)
from app.models.audit import AuditEventType
from app.models.case_management import CaseRecord, CaseSeverity, CaseSourceType, CaseStatus
from app.models.background import NotificationEventType
from app.models.user import UserRole
from app.services.audit_service import AuditService
from app.services.notification_service import NotificationService

logger = logging.getLogger("samarth.anomalies")

WORKS_COLLECTION = "works"
CASES_COLLECTION = "cases"
NOTIFICATIONS_COLLECTION = "case_notifications"
USERS_COLLECTION = "users"
DUPLICATES_COLLECTION = "duplicate_matches"
COMPLIANCE_COLLECTION = "compliance_results"
CITIZEN_REPORTS_COLLECTION = "citizen_reports"


class AnomalyIntelligenceService:
    """Provides comprehensive anomaly diagnosis, project narrative dossiers, and verification request routing."""

    def __init__(self, db: Database):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)
        self._cases = db.get_collection(CASES_COLLECTION)
        self._notifications = db.get_collection(NOTIFICATIONS_COLLECTION)
        self._users = db.get_collection(USERS_COLLECTION)
        self._duplicates = db.get_collection(DUPLICATES_COLLECTION)
        self._compliance = db.get_collection(COMPLIANCE_COLLECTION)
        self._citizen_reports = db.get_collection(CITIZEN_REPORTS_COLLECTION)
        self._audit = AuditService(db)
        self._workflow_notifications = NotificationService(db)

    async def get_project_story(
        self, work_id: str, *, jurisdiction_filter: Optional[dict[str, Any]] = None
    ) -> Optional[ProjectStoryResponse]:
        """Generate the complete 'What Happened in This Project' dossier."""
        query = {"work_id": work_id}
        if jurisdiction_filter:
            query = {"$and": [query, jurisdiction_filter]}

        work = await self._works.find_one(query, {"_id": 0})
        if not work:
            return None

        # 1. Fetch category peers for cost benchmarking
        category = str(work.get("category", "other"))
        peer_cursor = self._works.find(
            {"category": category, "sanctioned_amount": {"$gt": 0}},
            {"_id": 0, "sanctioned_amount": 1},
        )
        peer_sanctioned = [
            float(doc["sanctioned_amount"])
            for doc in await peer_cursor.to_list(length=100)
            if doc.get("sanctioned_amount") is not None
        ]
        peer_median = median(peer_sanctioned) if peer_sanctioned else float(work.get("sanctioned_amount") or 1.0)
        peer_avg = (
            sum(peer_sanctioned) / len(peer_sanctioned)
            if peer_sanctioned
            else float(work.get("sanctioned_amount") or 1.0)
        )

        # 2. Fetch duplicate candidates
        duplicate_matches = await self._duplicates.find(
            {
                "$or": [{"left_work_id": work_id}, {"right_work_id": work_id}],
                "similarity_score": {"$gte": 50},
            },
            {"_id": 0},
        ).to_list(length=10)

        # 3. Fetch compliance results
        compliance_docs = await self._compliance.find(
            {"work_id": work_id, "status": "triggered"},
            {"_id": 0},
        ).to_list(length=20)

        # 4. Fetch existing cases / verification requests
        case_docs = await self._cases.find(
            {"work_id": work_id},
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=50)

        # 5. Fetch citizen ground reports
        citizen_docs = await self._citizen_reports.find(
            {"work_id": work_id},
            {"_id": 0},
        ).sort("created_at", -1).to_list(length=20)

        # 6. Evaluate all 5 Anomaly Dimensions
        now = datetime.now(timezone.utc)
        sanctioned = float(work.get("sanctioned_amount") or 0.0)
        released = float(work.get("funds_released") or 0.0)
        expenditure = float(work.get("actual_expenditure") or 0.0)
        physical_pct = float(work.get("physical_progress_pct") or 0.0)
        financial_pct = (expenditure / sanctioned * 100.0) if sanctioned > 0 else 0.0
        gap_pct = financial_pct - physical_pct

        diagnoses: list[AnomalyDiagnosis] = []

        # ─────────────────────────────────────────────────────────────
        # Anomaly 1: Cost Overruns & Budget Escalation
        # ─────────────────────────────────────────────────────────────
        cost_ratio_peer = round(sanctioned / peer_median, 2) if peer_median > 0 else 1.0
        overrun_amt = max(0.0, expenditure - sanctioned)
        overrun_pct = round((overrun_amt / sanctioned) * 100.0, 1) if sanctioned > 0 else 0.0
        cost_flagged = expenditure > sanctioned or released > (sanctioned * 1.05) or cost_ratio_peer >= 1.5

        if expenditure > sanctioned * 1.25:
            cost_severity = AnomalySeverity.CRITICAL
        elif expenditure > sanctioned:
            cost_severity = AnomalySeverity.HIGH
        elif cost_ratio_peer >= 1.5 or released > sanctioned:
            cost_severity = AnomalySeverity.MEDIUM
        else:
            cost_severity = AnomalySeverity.NORMAL

        if expenditure > sanctioned:
            cost_summary = (
                f"Expenditure (₹{expenditure:,.2f}) has exceeded the sanctioned budget (₹{sanctioned:,.2f}) "
                f"by ₹{overrun_amt:,.2f} ({overrun_pct}% cost overrun)."
            )
        elif cost_ratio_peer >= 1.5:
            cost_summary = (
                f"Sanctioned budget (₹{sanctioned:,.2f}) is {cost_ratio_peer}x the category peer median "
                f"(₹{peer_median:,.2f}), representing a significant cost outlier."
            )
        else:
            cost_summary = (
                f"Expenditure is within sanctioned ceiling (₹{expenditure:,.2f} of ₹{sanctioned:,.2f}). "
                f"Peer median comparison is normal ({cost_ratio_peer}x median)."
            )

        diagnoses.append(
            AnomalyDiagnosis(
                category=AnomalyCategory.COST_OVERRUN,
                title="Cost Overruns & Budget Escalation",
                is_flagged=cost_flagged,
                severity=cost_severity,
                finding_summary=cost_summary,
                metrics={
                    "sanctioned_amount": sanctioned,
                    "actual_expenditure": expenditure,
                    "funds_released": released,
                    "cost_overrun_amount": overrun_amt,
                    "cost_overrun_pct": overrun_pct,
                    "category_peer_median": peer_median,
                    "peer_median_ratio": cost_ratio_peer,
                },
                recommended_authority_role=AuthorityRole.FINANCE_OFFICER,
                suggested_questions=[
                    "Verify if revised cost estimate was formally sanctioned by the Competent Financial Authority.",
                    "Audit Measurement Book (MB) entries against tender bill of quantities (BOQ) for unapproved rate escalations.",
                    "Inspect contractor bills for deviation from MoSPI schedule of rates (SOR).",
                ],
                verification_status="verification_requested" if any(c.get("anomaly_category") == "cost_overrun" for c in case_docs) else ("requires_verification" if cost_flagged else "cleared"),
            )
        )

        # ─────────────────────────────────────────────────────────────
        # Anomaly 2: Duplicate Works & Spatial Overlap
        # ─────────────────────────────────────────────────────────────
        duplicate_flagged = len(duplicate_matches) > 0
        max_sim = max([float(m.get("similarity_score", 0)) for m in duplicate_matches], default=0.0)
        dup_severity = AnomalySeverity.CRITICAL if max_sim >= 85 else (AnomalySeverity.HIGH if max_sim >= 70 else (AnomalySeverity.MEDIUM if duplicate_flagged else AnomalySeverity.NORMAL))

        if duplicate_flagged:
            candidate_names = [m.get("right_work_title") or m.get("left_work_title") or "Candidate project" for m in duplicate_matches[:2]]
            dup_summary = (
                f"Identified {len(duplicate_matches)} potential duplicate work candidate(s) with similarity up to {max_sim:.1f}%. "
                f"Matching works include: {', '.join(candidate_names)}."
            )
        else:
            dup_summary = "No duplicate or overlapping work candidates detected within the geographic and textual similarity radius."

        diagnoses.append(
            AnomalyDiagnosis(
                category=AnomalyCategory.DUPLICATE_WORK,
                title="Duplicate Works & Spatial Overlap",
                is_flagged=duplicate_flagged,
                severity=dup_severity,
                finding_summary=dup_summary,
                metrics={
                    "candidate_matches_count": len(duplicate_matches),
                    "highest_similarity_pct": max_sim,
                    "candidates": [
                        {
                            "match_id": m.get("match_id"),
                            "candidate_work_id": m.get("right_work_id") if m.get("left_work_id") == work_id else m.get("left_work_id"),
                            "candidate_title": m.get("right_work_title") if m.get("left_work_id") == work_id else m.get("left_work_title"),
                            "similarity_score": m.get("similarity_score"),
                            "distance_meters": m.get("distance_meters"),
                        }
                        for m in duplicate_matches[:3]
                    ],
                },
                recommended_authority_role=AuthorityRole.FIELD_INSPECTOR,
                suggested_questions=[
                    "Conduct on-site physical geotagged verification to ensure this asset is separate from candidate duplicate(s).",
                    "Verify asset registry and municipal records to confirm distinct physical boundaries and separate work orders.",
                    "Verify that contractor payments are not being claimed twice for the same physical construction.",
                ],
                verification_status="verification_requested" if any(c.get("anomaly_category") == "duplicate_work" for c in case_docs) else ("requires_verification" if duplicate_flagged else "cleared"),
            )
        )

        # ─────────────────────────────────────────────────────────────
        # Anomaly 3: Unusual Payment Timing & Tranche Disbursement
        # ─────────────────────────────────────────────────────────────
        tranches = sorted(work.get("payment_tranches", []), key=lambda t: t.get("tranche_number", 0))
        rapid_tranches = False
        min_interval_days = 999
        if len(tranches) >= 2:
            for i in range(1, len(tranches)):
                t1_date = _parse_dt(tranches[i - 1].get("released_date"))
                t2_date = _parse_dt(tranches[i].get("released_date"))
                if t1_date and t2_date:
                    diff_days = abs((t2_date - t1_date).days)
                    if diff_days < min_interval_days:
                        min_interval_days = diff_days
                    if diff_days < 21:
                        rapid_tranches = True

        high_spend_low_prog = financial_pct >= 70.0 and physical_pct <= 35.0
        timing_flagged = rapid_tranches or high_spend_low_prog or gap_pct >= 30.0
        timing_severity = AnomalySeverity.HIGH if (rapid_tranches and high_spend_low_prog) else (AnomalySeverity.MEDIUM if timing_flagged else AnomalySeverity.NORMAL)

        if rapid_tranches and high_spend_low_prog:
            timing_summary = (
                f"Consecutive payment tranches released only {min_interval_days} days apart while spend ({financial_pct:.1f}%) "
                f"heavily outpaces physical delivery ({physical_pct:.1f}%). Gap is +{gap_pct:.1f}%."
            )
        elif rapid_tranches:
            timing_summary = (
                f"Rapid tranche disbursements detected: successive payments released within {min_interval_days} days "
                f"without recorded intermediate physical milestone verification."
            )
        elif high_spend_low_prog:
            timing_summary = (
                f"High spend with low progress: {financial_pct:.1f}% of funds disbursed while only {physical_pct:.1f}% "
                f"physical completion certified on the ground."
            )
        else:
            timing_summary = f"Payment disbursements ({len(tranches)} tranches) align reasonably with recorded physical progress milestones."

        diagnoses.append(
            AnomalyDiagnosis(
                category=AnomalyCategory.UNUSUAL_PAYMENT_TIMING,
                title="Unusual Payment Timing & Tranche Disbursement",
                is_flagged=timing_flagged,
                severity=timing_severity,
                finding_summary=timing_summary,
                metrics={
                    "tranche_count": len(tranches),
                    "min_tranche_interval_days": min_interval_days if min_interval_days < 999 else None,
                    "financial_progress_pct": financial_pct,
                    "physical_progress_pct": physical_pct,
                    "financial_physical_gap_pct": gap_pct,
                    "rapid_disbursement_flag": rapid_tranches,
                },
                recommended_authority_role=AuthorityRole.FINANCE_OFFICER,
                suggested_questions=[
                    "Audit tranche disbursement dates against certified physical milestone progress reports.",
                    "Verify bank ledger vouchers and Treasury advice notes for rapid releases.",
                    "Ensure subsequent tranches were not released prior to submission of Utilization Certificates (UC).",
                ],
                verification_status="verification_requested" if any(c.get("anomaly_category") == "unusual_payment_timing" for c in case_docs) else ("requires_verification" if timing_flagged else "cleared"),
            )
        )

        # ─────────────────────────────────────────────────────────────
        # Anomaly 4: Deviation from Norms & Guidelines
        # ─────────────────────────────────────────────────────────────
        rules_triggered = [doc.get("rule_code") for doc in compliance_docs if doc.get("rule_code")]
        norm_flagged = len(rules_triggered) > 0 or cost_ratio_peer >= 2.0
        norm_severity = AnomalySeverity.HIGH if len(rules_triggered) >= 2 else (AnomalySeverity.MEDIUM if norm_flagged else AnomalySeverity.NORMAL)

        if rules_triggered:
            norm_summary = (
                f"Triggered {len(rules_triggered)} compliance rule(s): {', '.join(rules_triggered[:3])}. "
                f"Indicates potential procedural or ceiling deviation from standard MPLADS guidelines."
            )
        elif cost_ratio_peer >= 2.0:
            norm_summary = f"Sanctioned cost exceeds 2.0x of the peer median for {category} works."
        else:
            norm_summary = "All evaluated technical, statutory, and guideline parameters align with standard norms."

        diagnoses.append(
            AnomalyDiagnosis(
                category=AnomalyCategory.DEVIATION_FROM_NORMS,
                title="Deviation from Norms & Scheme Guidelines",
                is_flagged=norm_flagged,
                severity=norm_severity,
                finding_summary=norm_summary,
                metrics={
                    "triggered_rules": rules_triggered,
                    "triggered_rules_count": len(rules_triggered),
                    "cost_ratio_peer": cost_ratio_peer,
                },
                recommended_authority_role=AuthorityRole.DISTRICT_AUTHORITY,
                suggested_questions=[
                    "Verify compliance with MoSPI MPLADS guideline financial allocation thresholds.",
                    "Verify eligibility of implementing agency and whether tender process adhered to state procurement rules.",
                    "Ensure work location falls squarely within the designated constituency boundaries.",
                ],
                verification_status="verification_requested" if any(c.get("anomaly_category") == "deviation_from_norms" for c in case_docs) else ("requires_verification" if norm_flagged else "cleared"),
            )
        )

        # ─────────────────────────────────────────────────────────────
        # Anomaly 5: Stalled Projects & Operational Delays
        # ─────────────────────────────────────────────────────────────
        expected_date = _parse_dt(work.get("expected_completion_date"))
        actual_date = _parse_dt(work.get("actual_completion_date"))
        overdue_days = 0
        is_overdue = False
        if expected_date and not actual_date and physical_pct < 100.0:
            if now > expected_date:
                is_overdue = True
                overdue_days = (now - expected_date).days

        updates = sorted(work.get("progress_updates", []), key=lambda u: _parse_dt(u.get("date")) or datetime.min)
        days_since_update = 0
        if updates:
            last_up_date = _parse_dt(updates[-1].get("date"))
            if last_up_date:
                days_since_update = max(0, (now - last_up_date).days)
        else:
            created_dt = _parse_dt(work.get("created_at"))
            if created_dt:
                days_since_update = max(0, (now - created_dt).days)

        stalled_flagged = is_overdue or (days_since_update >= 90 and physical_pct < 100.0 and work.get("status") in {"in_progress", "sanctioned"})
        stalled_severity = AnomalySeverity.CRITICAL if (is_overdue and overdue_days >= 180) else (AnomalySeverity.HIGH if (is_overdue or days_since_update >= 120) else (AnomalySeverity.MEDIUM if stalled_flagged else AnomalySeverity.NORMAL))

        if is_overdue and days_since_update >= 90:
            stalled_summary = (
                f"Project is {overdue_days} days past expected completion date and has stalled with no physical progress "
                f"updates for {days_since_update} days (currently at {physical_pct:.0f}% completion)."
            )
        elif is_overdue:
            stalled_summary = f"Project is {overdue_days} days overdue past expected completion date while still incomplete ({physical_pct:.0f}%)."
        elif days_since_update >= 90 and physical_pct < 100.0:
            stalled_summary = f"Project has been inactive with zero physical progress updates for {days_since_update} days."
        else:
            stalled_summary = f"Project timeline is active. Last progress update was {days_since_update} days ago."

        diagnoses.append(
            AnomalyDiagnosis(
                category=AnomalyCategory.STALLED_PROJECT,
                title="Stalled Projects & Construction Delays",
                is_flagged=stalled_flagged,
                severity=stalled_severity,
                finding_summary=stalled_summary,
                metrics={
                    "is_overdue": is_overdue,
                    "overdue_days": overdue_days,
                    "days_since_last_update": days_since_update,
                    "physical_progress_pct": physical_pct,
                    "expected_completion_date": expected_date.isoformat() if expected_date else None,
                },
                recommended_authority_role=AuthorityRole.FIELD_INSPECTOR,
                suggested_questions=[
                    "Conduct on-site physical inspection to document ground reason for construction halt (e.g. land dispute, contractor dispute).",
                    "Ascertain current condition of exposed infrastructure and assess risk of asset degradation.",
                    "Review revised work-program and issue performance notice to implementing agency.",
                ],
                verification_status="verification_requested" if any(c.get("anomaly_category") == "stalled_project" for c in case_docs) else ("requires_verification" if stalled_flagged else "cleared"),
            )
        )

        # ─────────────────────────────────────────────────────────────
        # 7. Synthesize Executive Plain-English Story
        # ─────────────────────────────────────────────────────────────
        title = work.get("title", "Untitled Work")
        mp_name = work.get("mp_name", "Hon'ble MP")
        constituency = work.get("constituency", "Constituency")
        agency = work.get("implementing_agency", "the assigned Implementing Agency")
        rec_date = _fmt_date(work.get("recommended_date"))
        sanc_date = _fmt_date(work.get("sanctioned_date"))

        flagged_diagnoses = [d for d in diagnoses if d.is_flagged]

        story_parts = [
            f"Project '{title}' was recommended on {rec_date} by Hon'ble MP {mp_name} ({constituency}) "
            f"and administratively sanctioned on {sanc_date} with an approved budget of ₹{sanctioned:,.2f}. "
            f"Execution was assigned to {agency}."
        ]

        story_parts.append(
            f"To date, ₹{released:,.2f} has been released across {len(tranches)} tranche(s) and ₹{expenditure:,.2f} "
            f"has been expended ({financial_pct:.1f}% of sanction), while verified physical delivery stands at {physical_pct:.1f}%."
        )

        if flagged_diagnoses:
            reasons = []
            for d in flagged_diagnoses:
                if d.category == AnomalyCategory.COST_OVERRUN and expenditure > sanctioned:
                    reasons.append(f"a budget overrun of ₹{overrun_amt:,.2f} (+{overrun_pct}%)")
                elif d.category == AnomalyCategory.COST_OVERRUN and cost_ratio_peer >= 1.5:
                    reasons.append(f"sanction amount being {cost_ratio_peer}x above category peer median")
                elif d.category == AnomalyCategory.UNUSUAL_PAYMENT_TIMING and rapid_tranches:
                    reasons.append(f"rapid tranche releases within {min_interval_days} days without progress milestones")
                elif d.category == AnomalyCategory.UNUSUAL_PAYMENT_TIMING and high_spend_low_prog:
                    reasons.append(f"high financial spend ({financial_pct:.0f}%) alongside low ground delivery ({physical_pct:.0f}%)")
                elif d.category == AnomalyCategory.STALLED_PROJECT and is_overdue:
                    reasons.append(f"an overdue construction delay of {overdue_days} days")
                elif d.category == AnomalyCategory.STALLED_PROJECT:
                    reasons.append(f"inactivity for {days_since_update} days")
                elif d.category == AnomalyCategory.DUPLICATE_WORK:
                    reasons.append(f"potential duplicate overlap with {len(duplicate_matches)} nearby project(s)")
                elif d.category == AnomalyCategory.DEVIATION_FROM_NORMS:
                    reasons.append(f"triggering {len(rules_triggered)} guideline compliance rule(s)")

            story_parts.append(
                f"WHY FLAGGED FOR VERIFICATION: The automated anomaly detection engine identified "
                f"{'; '.join(reasons)}. "
                f"These signals represent potential irregularities requiring targeted verification by relevant authorities."
            )
        else:
            story_parts.append(
                "VERIFICATION STATUS: No critical anomalies or fraud patterns were detected. Project timeline, "
                "financial disbursements, and physical progress metrics currently conform to standard operational bounds."
            )

        executive_story = " ".join(story_parts)

        # ─────────────────────────────────────────────────────────────
        # 8. Build Unified Chronological Narrative Timeline
        # ─────────────────────────────────────────────────────────────
        timeline_items: list[UnifiedTimelineItem] = []

        # Sanction & Dates
        if work.get("recommended_date"):
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=_parse_dt(work["recommended_date"]) or now,
                    event_type="recommendation",
                    title="Project Recommended",
                    description=f"Formally recommended by {mp_name} for ₹{sanctioned:,.2f}.",
                    actor=mp_name,
                    badge_color="sky",
                )
            )
        if work.get("sanctioned_date"):
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=_parse_dt(work["sanctioned_date"]) or now,
                    event_type="sanction",
                    title="Administrative Sanction Accorded",
                    description=f"Administrative sanction granted for ₹{sanctioned:,.2f}. Assigned to {agency}.",
                    actor=str(work.get("district_name") or "District Authority"),
                    badge_color="emerald",
                )
            )
        if work.get("start_date"):
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=_parse_dt(work["start_date"]) or now,
                    event_type="commencement",
                    title="Construction Commenced",
                    description="Ground work commenced on site by implementing agency.",
                    actor=agency,
                    badge_color="sky",
                )
            )

        # Payment Tranches
        for t in tranches:
            t_date = _parse_dt(t.get("released_date")) or now
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=t_date,
                    event_type="payment_tranche",
                    title=f"Payment Tranche #{t.get('tranche_number')}: ₹{float(t.get('amount') or 0):,.2f}",
                    description=f"Purpose: {t.get('purpose', 'Work milestone release')}. Released by {t.get('released_by', 'Treasury')}.",
                    actor=str(t.get("released_by", "Finance")),
                    badge_color="amber",
                    metadata={"amount": t.get("amount"), "tranche_number": t.get("tranche_number")},
                )
            )

        # Progress Updates
        for u in work.get("progress_updates", []):
            u_date = _parse_dt(u.get("date")) or now
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=u_date,
                    event_type="progress_update",
                    title=f"Physical Progress Recorded: {float(u.get('physical_progress_pct') or 0):.0f}%",
                    description=str(u.get("description") or "Progress update submitted."),
                    actor=str(u.get("updated_by", "Agency")),
                    badge_color="emerald",
                    metadata={"physical_pct": u.get("physical_progress_pct")},
                )
            )

        # Work Stored Timeline
        for ev in work.get("timeline", []):
            ev_ts = _parse_dt(ev.get("timestamp")) or now
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=ev_ts,
                    event_type=str(ev.get("event_type", "work_event")),
                    title=str(ev.get("title", "Work Event")),
                    description=str(ev.get("description", "")),
                    actor=str(ev.get("actor", "System")),
                    badge_color="slate",
                )
            )

        # Citizen Reports
        for cr in citizen_docs:
            cr_date = _parse_dt(cr.get("created_at")) or now
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=cr_date,
                    event_type="citizen_report",
                    title=f"Citizen Ground Issue Raised: {cr.get('reference_id', '')}",
                    description=f"Category: {cr.get('issue_category')}. Description: {cr.get('description', '')[:120]}...",
                    actor="Citizen (Verified Camera)",
                    badge_color="purple",
                    metadata={"reference_id": cr.get("reference_id"), "images_count": len(cr.get("images", []))},
                )
            )

        # Cases and Verification Requests
        for c in case_docs:
            c_date = _parse_dt(c.get("created_at")) or now
            timeline_items.append(
                UnifiedTimelineItem(
                    item_id=str(uuid4()),
                    timestamp=c_date,
                    event_type="verification_request",
                    title=f"Verification Request: {c.get('title')}",
                    description=f"Dispatched to {c.get('target_authority_role') or c.get('owner_user_id') or 'Authority'}. Status: {c.get('status')}.",
                    actor=str(c.get("created_by", "Authority")),
                    badge_color="rose",
                    metadata={"case_id": c.get("case_id"), "status": c.get("status")},
                )
            )
            # Inspection reports inside case
            for report in c.get("inspection_reports", []):
                r_date = _parse_dt(report.get("submitted_at")) or now
                timeline_items.append(
                    UnifiedTimelineItem(
                        item_id=str(uuid4()),
                        timestamp=r_date,
                        event_type="field_inspection",
                        title=f"Field Inspection Submitted: Report {report.get('report_id', '')[:8]}",
                        description=f"Verified Progress: {report.get('checklist', {}).get('verified_physical_progress_pct') or 'N/A'}%. Remarks: {report.get('remarks', 'None')[:120]}",
                        actor=f"Inspector {report.get('inspector_user_id')}",
                        badge_color="emerald",
                    )
                )

        # Sort timeline descending
        timeline_items.sort(key=lambda x: x.timestamp, reverse=True)

        return ProjectStoryResponse(
            work_id=work_id,
            title=title,
            category=category,
            status=str(work.get("status", "unknown")),
            state_code=str(work.get("state_code", "")),
            state_name=str(work.get("state_name", "")),
            district_code=str(work.get("district_code", "")),
            district_name=str(work.get("district_name", "")),
            constituency=constituency,
            mp_name=mp_name,
            implementing_agency=agency,
            sanctioned_amount=sanctioned,
            funds_released=released,
            actual_expenditure=expenditure,
            physical_progress_pct=physical_pct,
            financial_progress_pct=financial_pct,
            financial_physical_gap_pct=gap_pct,
            sanctioned_date=_parse_dt(work.get("sanctioned_date")),
            start_date=_parse_dt(work.get("start_date")),
            expected_completion_date=expected_date,
            actual_completion_date=actual_date,
            last_updated_at=_parse_dt(work.get("updated_at")),
            executive_story=executive_story,
            anomaly_diagnoses=diagnoses,
            unified_timeline=timeline_items,
            verification_requests=case_docs,
            citizen_reports=citizen_docs,
        )

    async def get_available_authorities(
        self, work_id: str, *, jurisdiction_filter: Optional[dict[str, Any]] = None
    ) -> list[AuthorityOption]:
        """Fetch available officials for routing verification requests."""
        work = await self._works.find_one({"work_id": work_id}, {"_id": 0, "state_code": 1, "district_code": 1, "district_name": 1})
        state_code = work.get("state_code", "") if work else ""
        district_code = work.get("district_code", "") if work else ""

        users = await self._users.find(
            {"role": {"$in": [UserRole.DISTRICT_AUTHORITY.value, UserRole.INSPECTOR.value, UserRole.STATE_NODAL_OFFICER.value, UserRole.MOSPI.value]}},
            {"_id": 0, "user_id": 1, "full_name": 1, "role": 1, "jurisdiction": 1, "email": 1},
        ).to_list(length=100)

        options: list[AuthorityOption] = []
        for u in users:
            role = u.get("role", "")
            u_jur = u.get("jurisdiction") or {}
            u_state = u_jur.get("state_code")
            u_dist = u_jur.get("district_code")

            # Filter relevant users based on geography
            is_relevant = False
            auth_type = AuthorityRole.DISTRICT_AUTHORITY
            if role == UserRole.DISTRICT_AUTHORITY.value:
                auth_type = AuthorityRole.DISTRICT_AUTHORITY
                if not u_dist or u_dist.lower() == district_code.lower():
                    is_relevant = True
            elif role == UserRole.INSPECTOR.value:
                auth_type = AuthorityRole.FIELD_INSPECTOR
                if not u_dist or u_dist.lower() == district_code.lower():
                    is_relevant = True
            elif role == UserRole.STATE_NODAL_OFFICER.value:
                auth_type = AuthorityRole.STATE_NODAL_OFFICER
                if not u_state or u_state.lower() == state_code.lower():
                    is_relevant = True
            elif role in {UserRole.MOSPI.value, UserRole.ADMIN.value}:
                auth_type = AuthorityRole.FINANCE_OFFICER
                is_relevant = True

            if is_relevant:
                label = f"{u.get('full_name')} ({role.replace('_', ' ').title()})"
                if u_dist:
                    label += f" · {u_dist}"
                elif u_state:
                    label += f" · {u_state}"
                options.append(
                    AuthorityOption(
                        user_id=u["user_id"],
                        full_name=u.get("full_name", "Official"),
                        role=role,
                        authority_type=auth_type,
                        jurisdiction_label=label,
                    )
                )

        return options

    async def create_verification_request(
        self,
        data: VerificationRequestCreate,
        *,
        creator_user_id: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> VerificationRequestResponse:
        """Create and dispatch an official Verification Request."""
        work = await self._works.find_one({"work_id": data.work_id}, {"_id": 0})
        if not work:
            raise ValueError(f"Work project {data.work_id} not found")

        now = datetime.now(timezone.utc)
        case_id = str(uuid4())

        # Determine source type based on anomaly category
        source_type = CaseSourceType.FINANCIAL_SIGNAL
        if data.anomaly_category == AnomalyCategory.DUPLICATE_WORK:
            source_type = CaseSourceType.DUPLICATE_WORK
        elif data.anomaly_category in {AnomalyCategory.STALLED_PROJECT, AnomalyCategory.DEVIATION_FROM_NORMS}:
            source_type = CaseSourceType.RISK_ALERT

        # Resolve assigned authority user and name
        assigned_user_id = data.target_authority_user_id
        assigned_name = None
        if assigned_user_id:
            user_doc = await self._users.find_one({"user_id": assigned_user_id}, {"_id": 0, "full_name": 1, "role": 1})
            if user_doc:
                assigned_name = user_doc.get("full_name")

        record = CaseRecord(
            case_id=case_id,
            work_id=data.work_id,
            source_type=source_type,
            source_id=f"anomaly:{data.anomaly_category.value}:{data.work_id[:8]}",
            title=data.title,
            description=data.description,
            severity=CaseSeverity(data.priority) if data.priority in CaseSeverity._value2member_map_ else CaseSeverity.HIGH,
            due_date=data.due_date,
            state_code=str(work.get("state_code", "") or ""),
            district_code=str(work.get("district_code", "") or ""),
            created_by=creator_user_id,
            owner_user_id=assigned_user_id if data.target_authority_role != AuthorityRole.FIELD_INSPECTOR else None,
            assigned_inspector_id=assigned_user_id if data.target_authority_role == AuthorityRole.FIELD_INSPECTOR else None,
            anomaly_category=data.anomaly_category.value,
            target_authority_role=data.target_authority_role.value,
            target_authority_name=assigned_name,
            verification_scope=data.verification_scope,
            specific_questions=data.specific_questions,
            events=[
                {
                    "event_id": str(uuid4()),
                    "event_type": "verification_request_created",
                    "actor_user_id": creator_user_id,
                    "reason": f"Verification requested for {data.anomaly_category.value} -> {data.target_authority_role.value}",
                    "details": {"verification_scope": data.verification_scope, "assigned_to": assigned_name or assigned_user_id or "Unassigned"},
                    "created_at": now,
                }
            ],
            created_at=now,
            updated_at=now,
        )

        await self._cases.insert_one(record.model_dump(mode="python"))

        # Add event to work's lifecycle timeline
        work_timeline_event = {
            "event_id": str(uuid4()),
            "timestamp": now,
            "event_type": "verification_request",
            "title": f"Verification Request: {data.anomaly_category.value.replace('_', ' ').title()}",
            "description": f"Formal verification request sent to {assigned_name or data.target_authority_role.value}. Scope: {data.verification_scope}",
            "actor": creator_user_id,
        }
        await self._works.update_one(
            {"work_id": data.work_id},
            {"$push": {"timeline": work_timeline_event}, "$set": {"updated_at": now}},
        )

        # Notify assigned authority if specified
        if assigned_user_id:
            # Add to inspector assigned tasks if inspector
            if data.target_authority_role == AuthorityRole.FIELD_INSPECTOR:
                await self._users.update_one(
                    {"user_id": assigned_user_id},
                    {"$addToSet": {"jurisdiction.assigned_task_ids": case_id}},
                )

            # Insert into official in-app notifications collection so user's bell receives it
            try:
                await self._workflow_notifications.create_event(
                    recipient_user_id=assigned_user_id,
                    event_type=NotificationEventType.VERIFICATION_REQUEST_ASSIGNED,
                    resource_type="case",
                    resource_id=case_id,
                    idempotency_key=f"verification-request:{case_id}:{assigned_user_id}",
                    title=f"Verification Required: {work.get('title', 'Work')[:40]}",
                    message=f"You have been assigned to verify a {data.anomaly_category.value.replace('_', ' ')} anomaly. Scope: {data.verification_scope}",
                )
            except Exception as exc:
                logger.warning("Could not dispatch verification notification to %s: %s", assigned_user_id, exc)

            notification = {
                "notification_id": str(uuid4()),
                "case_id": case_id,
                "work_id": data.work_id,
                "recipient_user_id": assigned_user_id,
                "title": f"Action Required: Verification Request for {work.get('title', 'Work')[:40]}",
                "message": f"You have been assigned to verify a {data.anomaly_category.value.replace('_', ' ')} anomaly. Scope: {data.verification_scope}",
                "read_at": None,
                "created_at": now,
            }
            await self._notifications.insert_one(notification)

        await self._audit.log_event(
            AuditEventType.CASE_CREATED,
            user_id=creator_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="verification_request",
            resource_id=case_id,
            details={
                "work_id": data.work_id,
                "anomaly_category": data.anomaly_category.value,
                "target_authority_role": data.target_authority_role.value,
                "assigned_to": assigned_user_id,
            },
        )

        return VerificationRequestResponse(
            case_id=case_id,
            work_id=data.work_id,
            title=data.title,
            status="new",
            anomaly_category=data.anomaly_category.value,
            target_authority_role=data.target_authority_role.value,
            assigned_to=assigned_user_id,
            assigned_name=assigned_name,
            message=f"Verification request successfully registered and dispatched to {assigned_name or data.target_authority_role.value}.",
        )


def _parse_dt(val: Any) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _fmt_date(val: Any) -> str:
    dt = _parse_dt(val)
    if not dt:
        return "Not recorded"
    return dt.strftime("%d %b %Y")
