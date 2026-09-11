"""
SAMARTH AI — Master Platform Data Seeder & Synchronizer

Populates and links all platform collections:
1. Seeds compliance rules (11 default rules)
2. Runs batch compliance evaluation on all works -> populates `compliance_results`
3. Runs batch risk scoring on all works -> populates `risk_scores`
4. Creates investigation cases in `cases` (from high-risk works and escalations)
5. Assigns inspection tasks in UP-LKO to the demo Inspector user and records matching tasks
6. Seeds `citizen_issues` from `citizen_reports` so social audit moderation has live data
7. Aligns demo user jurisdictions in `users` collection to match existing works
8. Submits a sample inspection report for one of the assigned tasks to demonstrate full workflow

Usage:
    cd backend
    python -m scripts.populate_platform_data
"""

import asyncio
import logging
import random
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.config import get_settings
from app.core.database import Database
from app.models.case_management import (
    CaseEvent,
    CaseRecord,
    CaseSeverity,
    CaseSourceType,
    CaseStatus,
    InspectionChecklist,
    InspectionReport,
)
from app.models.citizen_portal import (
    CitizenIssueStatus,
    CitizenIssueType,
)
from app.services.citizen_portal_service import STATUS_MESSAGES
from app.services.compliance_service import ComplianceService
from app.services.risk_service import RiskScoringService

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("samarth.populate")


async def main():
    settings = get_settings()
    db = Database(settings)
    await db.connect()

    logger.info("=" * 65)
    logger.info("  SAMARTH AI — Master Platform Data Synchronization")
    logger.info("=" * 65)

    works_col = db.get_collection("works")
    users_col = db.get_collection("users")
    cases_col = db.get_collection("cases")
    reports_col = db.get_collection("inspection_reports")
    issues_col = db.get_collection("citizen_issues")
    evidence_col = db.get_collection("evidence_metadata")

    total_works = await works_col.count_documents({})
    logger.info(f"Existing works in database: {total_works}")
    if total_works == 0:
        logger.error("No works found. Run generate_training_dataset first.")
        await db.disconnect()
        return

    # ─────────────────────────────────────────────────────────────
    # STEP 1: Seed Compliance Rules & Run Batch Compliance
    # ─────────────────────────────────────────────────────────────
    logger.info("\n[STEP 1] Seeding Compliance Rules and Running Evaluation...")
    comp_svc = ComplianceService(db)
    await comp_svc.ensure_indexes()
    rules_seeded = await comp_svc.seed_default_rules(created_by="system_seeder")
    logger.info(f"  Compliance rules seeded: {rules_seeded} new")

    # Clear existing compliance results to avoid duplicates on re-run
    await db.get_collection("compliance_results").delete_many({})
    batch_comp = await comp_svc.run_batch_check({}, run_by="system_seeder")
    logger.info(
        f"  Compliance batch completed: {batch_comp.works_evaluated} works evaluated, "
        f"{batch_comp.deviations_found} deviations found, "
        f"{batch_comp.compliant} compliant in {batch_comp.run_duration_ms}ms"
    )

    # ─────────────────────────────────────────────────────────────
    # STEP 2: Run Concurrent Risk Scoring for Remaining Works
    # ─────────────────────────────────────────────────────────────
    logger.info("\n[STEP 2] Running Concurrent Risk Scoring for Remaining Works...")
    risk_svc = RiskScoringService(db)
    
    # Check already scored works to avoid repeating completed work
    existing_scored_ids = set(await db.get_collection("risk_scores").distinct("work_id"))
    logger.info(f"  Already scored works: {len(existing_scored_ids)}")
    
    all_works = await works_col.find({}, {"_id": 0, "work_id": 1}).to_list(length=None)
    unscored_work_ids = [str(w["work_id"]) for w in all_works if str(w["work_id"]) not in existing_scored_ids]
    logger.info(f"  Unscored works remaining: {len(unscored_work_ids)}")
    
    # Process in batches of 25 with asyncio.gather
    batch_size = 25
    for i in range(0, len(unscored_work_ids), batch_size):
        chunk = unscored_work_ids[i:i + batch_size]
        tasks = [
            risk_svc.score_work(
                wid, calculated_by="system_seeder", ip_address="127.0.0.1", user_agent="populate_script"
            )
            for wid in chunk
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info(f"  Scored {min(i + batch_size, len(unscored_work_ids))}/{len(unscored_work_ids)} remaining works...")

    total_scored = await db.get_collection("risk_scores").count_documents({})
    logger.info(f"  Total risk scores in database: {total_scored}")

    # ─────────────────────────────────────────────────────────────
    # STEP 3: Find Demo Users
    # ─────────────────────────────────────────────────────────────
    logger.info("\n[STEP 3] Resolving Demo Users for Assignments...")
    admin_user = await users_col.find_one({"role": "admin"}, {"_id": 0})
    inspector_user = await users_col.find_one({"role": "inspector"}, {"_id": 0})
    da_user = await users_col.find_one({"role": "district_authority"}, {"_id": 0})
    mp_user = await users_col.find_one({"role": "mp"}, {"_id": 0})

    admin_id = admin_user["user_id"] if admin_user else "admin-user"
    inspector_id = inspector_user["user_id"] if inspector_user else "inspector-user"
    da_id = da_user["user_id"] if da_user else "da-user"

    # ─────────────────────────────────────────────────────────────
    # STEP 4: Populate Cases from High-Risk Works & Escalations
    # ─────────────────────────────────────────────────────────────
    logger.info("\n[STEP 4] Populating Investigation Cases...")
    await cases_col.delete_many({})
    await reports_col.delete_many({})

    # Find Red risk works to generate cases for
    red_scores = await db.get_collection("risk_scores").find(
        {"risk_tier": "red"}, {"_id": 0, "work_id": 1, "composite_score": 1, "explanations": 1}
    ).to_list(length=40)

    assigned_task_ids = []
    cases_to_insert = []
    now = datetime.now(timezone.utc)

    # Also find UP-LKO works so we specifically create assigned cases for the Lucknow Inspector
    lko_works = await works_col.find(
        {"state_code": "UP", "district_code": "UP-LKO"}, {"_id": 0}
    ).to_list(length=10)

    # 4a. Create 3 cases in Lucknow specifically assigned to inspector.lucknow
    for idx, work in enumerate(lko_works[:3]):
        case_id = f"CASE-LKO-{idx+1:03d}"
        assigned_task_ids.append(case_id)
        status = CaseStatus.INSPECTION_ASSIGNED if idx < 2 else CaseStatus.EVIDENCE_SUBMITTED
        c = CaseRecord(
            case_id=case_id,
            work_id=work["work_id"],
            source_type=CaseSourceType.RISK_ALERT,
            title=f"Field Inspection: {work['title'][:60]}",
            description=f"Automated risk trigger: physical progress ({work.get('physical_progress_pct', 0)}%) diverges from expenditure. Field inspection required.",
            status=status,
            severity=CaseSeverity.HIGH if idx == 0 else CaseSeverity.CRITICAL,
            owner_user_id=da_id,
            assigned_inspector_id=inspector_id,
            due_date=now + timedelta(days=14),
            state_code="UP",
            district_code="UP-LKO",
            created_by=da_id,
            created_at=now - timedelta(days=idx * 3 + 2),
            updated_at=now,
            events=[
                CaseEvent(
                    event_id=str(uuid4()),
                    event_type="case_created",
                    actor_user_id=da_id,
                    reason="Risk signal triggered case creation",
                    created_at=now - timedelta(days=idx * 3 + 2),
                ),
                CaseEvent(
                    event_id=str(uuid4()),
                    event_type="inspector_assigned",
                    actor_user_id=da_id,
                    reason="Assigned to field inspector for site verification",
                    created_at=now - timedelta(days=idx * 3 + 1),
                ),
            ],
        )
        cases_to_insert.append(c.model_dump())

        # If idx == 2 (EVIDENCE_SUBMITTED), also insert an inspection report!
        if idx == 2:
            loc = work.get("location") or {}
            rep = InspectionReport(
                report_id=str(uuid4()),
                case_id=case_id,
                work_id=work["work_id"],
                inspector_user_id=inspector_id,
                checklist=InspectionChecklist(
                    asset_found=True,
                    work_active=True,
                    verified_physical_progress_pct=float(work.get("physical_progress_pct", 50)),
                    quality_concern=False,
                    work_delayed=True,
                    cause_of_delay="Monsoon weather and seasonal labor migration slowed civil work.",
                    additional_remarks="Site inspected with local JE. Foundation complete, superstructure in progress.",
                ),
                gps_latitude=float(loc.get("latitude") or 26.8467),
                gps_longitude=float(loc.get("longitude") or 80.9462),
                gps_timestamp=now - timedelta(days=1),
                gps_distance_from_project_meters=18.5,
                evidence_ids=[],
                remarks="Verification complete. No structural defects observed at plinth level.",
                submitted_at=now - timedelta(days=1),
            )
            await reports_col.insert_one(rep.model_dump())

    # 4b. Create other cases across different states/districts for general case management
    for idx, score_item in enumerate(red_scores[:25]):
        w = await works_col.find_one({"work_id": score_item["work_id"]}, {"_id": 0})
        if not w or w.get("district_code") == "UP-LKO":
            continue
        case_id = f"CASE-{w.get('state_code', 'IN')}-{idx+10:03d}"
        severity_val = CaseSeverity.CRITICAL if score_item.get("composite_score", 0) > 80 else CaseSeverity.HIGH
        c = CaseRecord(
            case_id=case_id,
            work_id=w["work_id"],
            source_type=CaseSourceType.RISK_ALERT,
            title=f"Review Case: {w.get('title', 'Work')} [{w.get('district_name', '')}]",
            description=f"High risk score ({score_item.get('composite_score', 0):.1f}). Review required by District Authority.",
            status=random.choice([CaseStatus.NEW, CaseStatus.UNDER_REVIEW, CaseStatus.ACKNOWLEDGED]),
            severity=severity_val,
            owner_user_id=None,
            state_code=w.get("state_code", ""),
            district_code=w.get("district_code", ""),
            created_by=admin_id,
            created_at=now - timedelta(days=random.randint(2, 20)),
            updated_at=now,
            events=[
                CaseEvent(
                    event_id=str(uuid4()),
                    event_type="case_created",
                    actor_user_id=admin_id,
                    reason="Composite risk score threshold exceeded",
                )
            ],
        )
        cases_to_insert.append(c.model_dump())

    if cases_to_insert:
        await cases_col.insert_many(cases_to_insert)
        logger.info(f"  Inserted {len(cases_to_insert)} cases into 'cases' collection.")
        logger.info(f"  Inspector assigned tasks: {assigned_task_ids}")

    # ─────────────────────────────────────────────────────────────
    # STEP 5: Populate Citizen Issues from citizen_reports
    # ─────────────────────────────────────────────────────────────
    logger.info("\n[STEP 5] Populating Citizen Issues for Social Audit Moderation...")
    await issues_col.delete_many({})

    raw_reports = await db.get_collection("citizen_reports").find({}, {"_id": 0}).to_list(length=100)
    issue_docs = []
    for r in raw_reports:
        now_r = datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))
        ref_id = f"SA-{now_r:%Y%m%d}-{secrets.token_hex(4).upper()}"
        status_val = random.choice([
            CitizenIssueStatus.RECEIVED,
            CitizenIssueStatus.UNDER_REVIEW,
            CitizenIssueStatus.INSPECTION_ASSIGNED,
            CitizenIssueStatus.RESOLVED,
        ])
        doc = {
            "reference_id": ref_id,
            "work_id": r.get("work_id", ""),
            "work_title": r.get("work_title", "Public Work"),
            "issue_type": random.choice([t.value for t in CitizenIssueType]),
            "description": r.get("description", "Citizen reported issue."),
            "status": status_val.value,
            "public_status_message": STATUS_MESSAGES.get(status_val, "Under review."),
            "location_consent": True,
            "latitude": r.get("location", {}).get("latitude"),
            "longitude": r.get("location", {}).get("longitude"),
            "evidence": [],
            "assigned_inspector_id": inspector_id if status_val == CitizenIssueStatus.INSPECTION_ASSIGNED else None,
            "moderation_reason": "Moderated by District Authority" if status_val != CitizenIssueStatus.RECEIVED else "",
            "photo_upload_token_hash": "",
            "photo_upload_expires_at": None,
            "photo_upload_used_at": None,
            "submitted_at": now_r,
            "updated_at": now_r + timedelta(hours=random.randint(1, 48)),
        }
        issue_docs.append(doc)

    if issue_docs:
        await issues_col.insert_many(issue_docs)
        logger.info(f"  Inserted {len(issue_docs)} records into 'citizen_issues' collection.")

    # ─────────────────────────────────────────────────────────────
    # STEP 6: Align Demo Users' Jurisdictions
    # ─────────────────────────────────────────────────────────────
    logger.info("\n[STEP 6] Updating and Aligning Demo User Jurisdictions...")

    # 1. State Nodal Officer (UP) -> state_code = "UP"
    await users_col.update_many(
        {"role": "state_nodal_officer"},
        {"$set": {"jurisdiction.state_code": "UP", "updated_at": datetime.now(timezone.utc)}}
    )

    # 2. District Authority (Lucknow) -> state_code = "UP", district_code = "UP-LKO"
    await users_col.update_many(
        {"role": "district_authority"},
        {"$set": {"jurisdiction.state_code": "UP", "jurisdiction.district_code": "UP-LKO", "updated_at": datetime.now(timezone.utc)}}
    )

    # 3. Inspector (Lucknow) -> state_code = "UP", district_code = "UP-LKO", assigned_task_ids = assigned_task_ids
    await users_col.update_many(
        {"role": "inspector"},
        {"$set": {
            "jurisdiction.state_code": "UP",
            "jurisdiction.district_code": "UP-LKO",
            "jurisdiction.assigned_task_ids": assigned_task_ids,
            "updated_at": datetime.now(timezone.utc),
        }}
    )

    # 4. MP (Varanasi) -> state_code = "UP", constituency = "Varanasi Urban"
    await users_col.update_many(
        {"role": "mp"},
        {"$set": {
            "jurisdiction.state_code": "UP",
            "jurisdiction.constituency": "Varanasi Urban",
            "updated_at": datetime.now(timezone.utc),
        }}
    )

    # 5. Agency (Delhi) -> state_code = "DL", district_code = "DL-NDL"
    await users_col.update_many(
        {"role": "agency"},
        {"$set": {
            "jurisdiction.state_code": "DL",
            "jurisdiction.district_code": "DL-NDL",
            "updated_at": datetime.now(timezone.utc),
        }}
    )

    logger.info("  Demo users updated with valid, matching jurisdictions.")

    # Print summary of updated users
    users = await users_col.find({}, {"_id": 0, "email": 1, "role": 1, "jurisdiction": 1}).to_list(length=10)
    for u in users:
        j = u.get("jurisdiction") or {}
        tasks = len(j.get("assigned_task_ids") or [])
        task_str = f"({tasks} tasks)" if tasks else ""
        s_code = str(j.get('state_code') or '')
        d_code = str(j.get('district_code') or '')
        c_name = str(j.get('constituency') or '')
        logger.info(f"    {str(u.get('email','')):36s} | {str(u.get('role','')):20s} | state={s_code:4s} | dist={d_code:10s} | const={c_name:16s} {task_str}")

    await db.disconnect()
    logger.info("\n" + "=" * 65)
    logger.info("  PLATFORM DATA SYNCHRONIZATION COMPLETE!")
    logger.info("=" * 65)


if __name__ == "__main__":
    asyncio.run(main())
