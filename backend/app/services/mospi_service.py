"""MoSPI Executive Command Center Service.

Provides macro telemetry, inter-state benchmarking, statutory quota tracking,
central treasury tranche authorization, and national portal sync.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.mospi import (
    InterStateBenchmarkingResponse,
    MacroTelemetryResponse,
    PortalSyncResponse,
    SectorDistributionItem,
    ShortfallAlert,
    StateBenchmarkItem,
    StatutoryQuotaItem,
    StatutoryQuotaResponse,
    TreasuryAuthorizeResponse,
    TreasuryReleaseItem,
    TreasuryReleasesResponse,
)

logger = logging.getLogger("samarth.mospi")

WORKS_COLLECTION = "works"
TREASURY_RELEASES_COLLECTION = "treasury_releases"
AUDIT_COLLECTION = "audit_logs"


INITIAL_TREASURY_RELEASES = [
    {
        "release_id": "REL-2026-001",
        "constituency": "Lucknow",
        "mp_name": "Rajnath Singh",
        "district_name": "Lucknow",
        "state_name": "Uttar Pradesh",
        "installment_tranche": "Tranche 2 (₹2.50 Cr)",
        "requested_amount": 25000000.0,
        "financial_year": "2025-26",
        "utilization_certificate_status": "verified",
        "uc_submission_date": "2026-02-18",
        "physical_progress_avg": 78.5,
        "status": "pending",
        "authorized_by": None,
        "authorized_at": None,
        "pfms_transaction_ref": None,
        "remarks": "Tranche 1 (₹2.5 Cr) fully accounted with 82% financial drawdown. Digital UC verified by State Nodal Officer.",
    },
    {
        "release_id": "REL-2026-002",
        "constituency": "Varanasi",
        "mp_name": "Narendra Modi",
        "district_name": "Varanasi",
        "state_name": "Uttar Pradesh",
        "installment_tranche": "Tranche 2 (₹2.50 Cr)",
        "requested_amount": 25000000.0,
        "financial_year": "2025-26",
        "utilization_certificate_status": "verified",
        "uc_submission_date": "2026-02-25",
        "physical_progress_avg": 84.2,
        "status": "authorized",
        "authorized_by": "MoSPI Central Desk",
        "authorized_at": "2026-03-01T10:30:00Z",
        "pfms_transaction_ref": "PFMS-2026-TR-VAR-8819",
        "remarks": "Subsequent installment authorized. Progress on heritage corridor and rural water assets verified.",
    },
    {
        "release_id": "REL-2026-003",
        "constituency": "Mumbai South",
        "mp_name": "Arvind Sawant",
        "district_name": "Mumbai",
        "state_name": "Maharashtra",
        "installment_tranche": "Tranche 2 (₹2.50 Cr)",
        "requested_amount": 25000000.0,
        "financial_year": "2025-26",
        "utilization_certificate_status": "verified",
        "uc_submission_date": "2026-02-28",
        "physical_progress_avg": 71.0,
        "status": "pending",
        "authorized_by": None,
        "authorized_at": None,
        "pfms_transaction_ref": None,
        "remarks": "Tranche 1 expenditure certificate uploaded with geotagged asset completions. Meets MoSPI 70% threshold.",
    },
    {
        "release_id": "REL-2026-004",
        "constituency": "Bangalore South",
        "mp_name": "Tejasvi Surya",
        "district_name": "Bengaluru Urban",
        "state_name": "Karnataka",
        "installment_tranche": "Tranche 2 (₹2.50 Cr)",
        "requested_amount": 25000000.0,
        "financial_year": "2025-26",
        "utilization_certificate_status": "verified",
        "uc_submission_date": "2026-03-02",
        "physical_progress_avg": 76.8,
        "status": "pending",
        "authorized_by": None,
        "authorized_at": None,
        "pfms_transaction_ref": None,
        "remarks": "Solar and educational infrastructure tranches completed. Awaiting central release authorization.",
    },
    {
        "release_id": "REL-2026-005",
        "constituency": "Patna Sahib",
        "mp_name": "Ravi Shankar Prasad",
        "district_name": "Patna",
        "state_name": "Bihar",
        "installment_tranche": "Tranche 2 (₹2.50 Cr)",
        "requested_amount": 25000000.0,
        "financial_year": "2025-26",
        "utilization_certificate_status": "pending_audit",
        "uc_submission_date": "2026-03-05",
        "physical_progress_avg": 42.1,
        "status": "on_hold",
        "authorized_by": None,
        "authorized_at": None,
        "pfms_transaction_ref": None,
        "remarks": "Held pending physical progress verification. Tranche 1 drawdown is below mandatory 60% threshold.",
    },
    {
        "release_id": "REL-2026-006",
        "constituency": "Jaipur",
        "mp_name": "Manju Sharma",
        "district_name": "Jaipur",
        "state_name": "Rajasthan",
        "installment_tranche": "Tranche 2 (₹2.50 Cr)",
        "requested_amount": 25000000.0,
        "financial_year": "2025-26",
        "utilization_certificate_status": "discrepancy",
        "uc_submission_date": "2026-03-08",
        "physical_progress_avg": 55.4,
        "status": "on_hold",
        "authorized_by": None,
        "authorized_at": None,
        "pfms_transaction_ref": None,
        "remarks": "Flagged for reconciliation: UC claimed ₹2.1 Cr expenditure while PFMS records confirm ₹1.7 Cr voucher generation.",
    },
]


class MoSPIService:
    """Provides high-level national governance and treasury intelligence."""

    def __init__(self, db: Database):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)
        self._releases = db.get_collection(TREASURY_RELEASES_COLLECTION)
        self._audit = db.get_collection(AUDIT_COLLECTION)

    async def ensure_defaults(self) -> None:
        """Seed initial treasury release requests if collection is empty."""
        count = await self._releases.count_documents({})
        if count == 0:
            await self._releases.insert_many(INITIAL_TREASURY_RELEASES)
            logger.info("Seeded %d initial MoSPI treasury release requests", len(INITIAL_TREASURY_RELEASES))

    async def get_macro_telemetry(self) -> MacroTelemetryResponse:
        """Calculate national-level fund telemetry across all works."""
        pipeline = [
            {
                "$group": {
                    "_id": None,
                    "total_works": {"$sum": 1},
                    "total_sanctioned": {"$sum": {"$ifNull": ["$sanctioned_amount", 0]}},
                    "total_expenditure": {
                        "$sum": {
                            "$ifNull": [
                                "$actual_expenditure",
                                {"$ifNull": ["$funds_released", 0]},
                            ]
                        }
                    },
                    "completed_works": {
                        "$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}
                    },
                    "in_progress_works": {
                        "$sum": {"$cond": [{"$eq": ["$status", "in_progress"]}, 1, 0]}
                    },
                    "stalled_works": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["delayed", "stalled", "stopped"]]},
                                1,
                                0,
                            ]
                        }
                    },
                    "at_risk_works": {
                        "$sum": {"$cond": [{"$eq": ["$risk_tier", "red"]}, 1, 0]}
                    },
                    "stagnant_funds": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$and": [
                                        {"$in": ["$status", ["delayed", "stalled", "stopped"]]},
                                        {"$gt": ["$sanctioned_amount", 0]},
                                    ]
                                },
                                "$sanctioned_amount",
                                0,
                            ]
                        }
                    },
                }
            }
        ]

        cursor = self._works.aggregate(pipeline)
        result = await cursor.to_list(length=1)
        data = result[0] if result else {}

        total_works = int(data.get("total_works", 0))
        total_sanctioned = float(data.get("total_sanctioned", 0.0))
        total_expenditure = float(data.get("total_expenditure", 0.0))
        completed_works = int(data.get("completed_works", 0))
        in_progress_works = int(data.get("in_progress_works", 0))
        stalled_works = int(data.get("stalled_works", 0))
        at_risk_works = int(data.get("at_risk_works", 0))
        stagnant_funds = float(data.get("stagnant_funds", 0.0))

        unspent_treasury = max(0.0, total_sanctioned - total_expenditure)
        utilization_rate = round((total_expenditure / total_sanctioned * 100), 2) if total_sanctioned > 0 else 0.0

        # Sector distribution
        sector_pipeline = [
            {
                "$group": {
                    "_id": {"$ifNull": ["$category", "other"]},
                    "amount": {"$sum": {"$ifNull": ["$sanctioned_amount", 0]}},
                    "count": {"$sum": 1},
                }
            },
            {"$sort": {"amount": -1}},
        ]
        sector_cursor = self._works.aggregate(sector_pipeline)
        sector_results = await sector_cursor.to_list(length=20)

        sectors: list[SectorDistributionItem] = []
        for s in sector_results:
            amt = float(s.get("amount", 0.0))
            pct = round((amt / total_sanctioned * 100), 2) if total_sanctioned > 0 else 0.0
            sectors.append(
                SectorDistributionItem(
                    sector=str(s["_id"]).replace("_", " ").title(),
                    amount=amt,
                    works_count=int(s.get("count", 0)),
                    pct_of_total=pct,
                )
            )

        return MacroTelemetryResponse(
            total_national_outlay=40000000000.0,  # ₹4,000 Cr
            total_sanctioned_amount=total_sanctioned,
            total_expenditure_amount=total_expenditure,
            unspent_treasury_balance=unspent_treasury,
            utilization_rate_pct=utilization_rate,
            stagnant_funds_amount=stagnant_funds,
            total_works_count=total_works,
            completed_works_count=completed_works,
            in_progress_works_count=in_progress_works,
            stalled_works_count=stalled_works,
            at_risk_works_count=at_risk_works,
            sector_distribution=sectors,
            fiscal_year="2025-26",
        )

    async def get_inter_state_benchmarking(self) -> InterStateBenchmarkingResponse:
        """Benchmark all states by expenditure velocity, delay index, and efficiency."""
        pipeline = [
            {
                "$group": {
                    "_id": {
                        "code": {"$ifNull": ["$state_code", "IN"]},
                        "name": {"$ifNull": ["$state_name", "Unknown State"]},
                    },
                    "total_works": {"$sum": 1},
                    "sanctioned_amount": {"$sum": {"$ifNull": ["$sanctioned_amount", 0]}},
                    "expenditure_amount": {
                        "$sum": {
                            "$ifNull": [
                                "$actual_expenditure",
                                {"$ifNull": ["$funds_released", 0]},
                            ]
                        }
                    },
                    "delayed_works": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["delayed", "stalled", "stopped"]]},
                                1,
                                0,
                            ]
                        }
                    },
                    "stagnant_works": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$and": [
                                        {"$in": ["$status", ["delayed", "stalled", "stopped"]]},
                                        {"$gt": ["$sanctioned_amount", 0]},
                                    ]
                                },
                                1,
                                0,
                            ]
                        }
                    },
                }
            },
            {"$sort": {"sanctioned_amount": -1}},
        ]

        cursor = self._works.aggregate(pipeline)
        results = await cursor.to_list(length=100)

        states: list[dict[str, Any]] = []
        total_util_pct = 0.0
        total_delay_pct = 0.0

        for item in results:
            code = item["_id"]["code"]
            name = item["_id"]["name"]
            tw = int(item.get("total_works", 0))
            sa = float(item.get("sanctioned_amount", 0.0))
            ea = float(item.get("expenditure_amount", 0.0))
            dw = int(item.get("delayed_works", 0))
            sw = int(item.get("stagnant_works", 0))

            util_pct = round((ea / sa * 100), 2) if sa > 0 else 0.0
            delay_pct = round((dw / tw * 100), 2) if tw > 0 else 0.0

            # Composite Efficiency Score: 60% weight on utilization, 40% on timeliness
            eff_score = max(0.0, min(100.0, round(0.6 * util_pct + 0.4 * (100.0 - delay_pct), 1)))

            total_util_pct += util_pct
            total_delay_pct += delay_pct

            states.append({
                "state_code": code,
                "state_name": name,
                "total_works": tw,
                "sanctioned_amount": sa,
                "expenditure_amount": ea,
                "utilization_rate_pct": util_pct,
                "stagnant_works_count": sw,
                "delay_rate_pct": delay_pct,
                "efficiency_score": eff_score,
            })

        # Sort states by efficiency score descending to assign rank
        states.sort(key=lambda x: x["efficiency_score"], reverse=True)

        benchmark_items: list[StateBenchmarkItem] = []
        for idx, s in enumerate(states, start=1):
            eff = s["efficiency_score"]
            tier = "leading" if eff >= 68.0 else "satisfactory" if eff >= 48.0 else "lagging"
            benchmark_items.append(
                StateBenchmarkItem(
                    state_code=s["state_code"],
                    state_name=s["state_name"],
                    total_works=s["total_works"],
                    sanctioned_amount=s["sanctioned_amount"],
                    expenditure_amount=s["expenditure_amount"],
                    utilization_rate_pct=s["utilization_rate_pct"],
                    stagnant_works_count=s["stagnant_works_count"],
                    delay_rate_pct=s["delay_rate_pct"],
                    efficiency_score=eff,
                    rank=idx,
                    status_tier=tier,
                )
            )

        n = len(states) or 1
        return InterStateBenchmarkingResponse(
            states=benchmark_items,
            national_avg_utilization=round(total_util_pct / n, 2),
            national_avg_delay_rate=round(total_delay_pct / n, 2),
            total_states_benchmarked=len(states),
        )

    async def get_statutory_quota_oversight(self) -> StatutoryQuotaResponse:
        """Enforce nationwide compliance of mandatory 15% SC / 7.5% ST capital quotas."""
        # Derive SC/ST allocation based on category and demographic distribution across states
        pipeline = [
            {
                "$group": {
                    "_id": {
                        "code": {"$ifNull": ["$state_code", "IN"]},
                        "name": {"$ifNull": ["$state_name", "Unknown State"]},
                    },
                    "total_sanctioned": {"$sum": {"$ifNull": ["$sanctioned_amount", 0]}},
                    # Tagged SC allocations
                    "sc_amount": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$or": [
                                        {"$in": ["$category", ["drinking_water", "sanitation", "education"]]},
                                        {"$regexMatch": {"input": {"$ifNull": ["$title", ""]}, "regex": "SC|Scheduled|Ambedkar|Basti|Colony", "options": "i"}},
                                    ]
                                },
                                {"$multiply": [{"$ifNull": ["$sanctioned_amount", 0]}, 0.35]},
                                0,
                            ]
                        }
                    },
                    # Tagged ST allocations
                    "st_amount": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$or": [
                                        {"$in": ["$category", ["roads_and_bridges", "irrigation"]]},
                                        {"$regexMatch": {"input": {"$ifNull": ["$title", ""]}, "regex": "ST|Tribal|Adivasi|Forest|Van", "options": "i"}},
                                    ]
                                },
                                {"$multiply": [{"$ifNull": ["$sanctioned_amount", 0]}, 0.20]},
                                0,
                            ]
                        }
                    },
                }
            },
            {"$sort": {"total_sanctioned": -1}},
        ]

        cursor = self._works.aggregate(pipeline)
        results = await cursor.to_list(length=100)

        quota_items: list[StatutoryQuotaItem] = []
        alerts: list[ShortfallAlert] = []

        total_national_sanctioned = 0.0
        total_national_sc = 0.0
        total_national_st = 0.0
        compliant_states = 0
        non_compliant_states = 0
        total_sc_shortfall = 0.0
        total_st_shortfall = 0.0

        for r in results:
            code = r["_id"]["code"]
            name = r["_id"]["name"]
            tot = float(r.get("total_sanctioned", 0.0))
            sc_amt = float(r.get("sc_amount", 0.0))
            st_amt = float(r.get("st_amount", 0.0))

            total_national_sanctioned += tot
            total_national_sc += sc_amt
            total_national_st += st_amt

            sc_pct = round((sc_amt / tot * 100), 2) if tot > 0 else 0.0
            st_pct = round((st_amt / tot * 100), 2) if tot > 0 else 0.0

            sc_req = tot * 0.15
            st_req = tot * 0.075

            sc_short = max(0.0, round(sc_req - sc_amt, 2))
            st_short = max(0.0, round(st_req - st_amt, 2))

            sc_ok = sc_pct >= 15.0
            st_ok = st_pct >= 7.5

            if sc_ok and st_ok:
                compliant_states += 1
            else:
                non_compliant_states += 1
                total_sc_shortfall += sc_short
                total_st_shortfall += st_short

                actions: list[str] = []
                if not sc_ok:
                    actions.append(f"Requires ₹{sc_short/100000:.1f} Lakh additional SC capital allocation")
                if not st_ok:
                    actions.append(f"Requires ₹{st_short/100000:.1f} Lakh additional ST capital allocation")

                alerts.append(
                    ShortfallAlert(
                        entity_id=code,
                        entity_name=name,
                        entity_type="state",
                        sc_shortfall=sc_short,
                        st_shortfall=st_short,
                        recommended_action="; ".join(actions),
                    )
                )

            quota_items.append(
                StatutoryQuotaItem(
                    state_code=code,
                    state_name=name,
                    total_sanctioned=tot,
                    sc_allocated_amount=sc_amt,
                    sc_allocated_pct=sc_pct,
                    st_allocated_amount=st_amt,
                    st_allocated_pct=st_pct,
                    sc_compliant=sc_ok,
                    st_compliant=st_ok,
                    sc_shortfall_amount=sc_short,
                    st_shortfall_amount=st_short,
                )
            )

        nat_sc_pct = round((total_national_sc / total_national_sanctioned * 100), 2) if total_national_sanctioned > 0 else 0.0
        nat_st_pct = round((total_national_st / total_national_sanctioned * 100), 2) if total_national_sanctioned > 0 else 0.0

        return StatutoryQuotaResponse(
            target_sc_pct=15.0,
            target_st_pct=7.5,
            national_sc_allocated_pct=nat_sc_pct,
            national_st_allocated_pct=nat_st_pct,
            total_sc_allocated_amount=total_national_sc,
            total_st_allocated_amount=total_national_st,
            total_sc_shortfall_amount=total_sc_shortfall,
            total_st_shortfall_amount=total_st_shortfall,
            compliant_states_count=compliant_states,
            non_compliant_states_count=non_compliant_states,
            state_quotas=quota_items,
            shortfall_alerts=alerts,
        )

    async def get_treasury_releases(self) -> TreasuryReleasesResponse:
        """List all ₹2.5 Cr installment release requests and authorizations."""
        await self.ensure_defaults()
        cursor = self._releases.find({}, {"_id": 0}).sort("release_id", 1)
        items = await cursor.to_list(length=100)

        total_pending = 0.0
        total_authorized = 0.0
        pending_count = 0
        authorized_count = 0

        releases: list[TreasuryReleaseItem] = []
        for it in items:
            amt = float(it.get("requested_amount", 25000000.0))
            status = it.get("status", "pending")
            if status == "pending":
                total_pending += amt
                pending_count += 1
            elif status == "authorized":
                total_authorized += amt
                authorized_count += 1

            releases.append(TreasuryReleaseItem(**it))

        return TreasuryReleasesResponse(
            releases=releases,
            total_pending_amount=total_pending,
            total_authorized_amount=total_authorized,
            pending_count=pending_count,
            authorized_count=authorized_count,
        )

    async def authorize_treasury_release(
        self,
        release_id: str,
        *,
        authorized_by_name: str,
        remarks: Optional[str] = None,
    ) -> TreasuryAuthorizeResponse:
        """Authorize a ₹2.5 Cr central installment release, generating PFMS reference."""
        await self.ensure_defaults()
        release = await self._releases.find_one({"release_id": release_id})
        if not release:
            raise ValueError(f"Treasury release request '{release_id}' not found")

        if release.get("status") == "authorized":
            return TreasuryAuthorizeResponse(
                release_id=release_id,
                status="authorized",
                pfms_transaction_ref=release.get("pfms_transaction_ref", "PFMS-EXISTING"),
                authorized_at=release.get("authorized_at", datetime.now(timezone.utc).isoformat()),
                message="Installment already authorized.",
            )

        now_iso = datetime.now(timezone.utc).isoformat()
        pfms_ref = f"PFMS-2026-TR-{uuid4().hex[:8].upper()}"

        await self._releases.update_one(
            {"release_id": release_id},
            {
                "$set": {
                    "status": "authorized",
                    "authorized_by": authorized_by_name,
                    "authorized_at": now_iso,
                    "pfms_transaction_ref": pfms_ref,
                    "remarks": remarks or release.get("remarks"),
                }
            },
        )

        # Log immutable security audit record
        await self._audit.insert_one({
            "event_id": str(uuid4()),
            "event_type": "CENTRAL_TREASURY_INSTALLMENT_AUTHORIZED",
            "release_id": release_id,
            "constituency": release.get("constituency"),
            "amount": release.get("requested_amount", 25000000.0),
            "pfms_transaction_ref": pfms_ref,
            "authorized_by": authorized_by_name,
            "timestamp": now_iso,
        })

        return TreasuryAuthorizeResponse(
            release_id=release_id,
            status="authorized",
            pfms_transaction_ref=pfms_ref,
            authorized_at=now_iso,
            message=f"Successfully authorized ₹2.5 Cr installment release for {release.get('constituency')} (PFMS Ref: {pfms_ref}).",
        )

    async def sync_national_portal(self, target_portal: str) -> PortalSyncResponse:
        """Simulate secure, authenticated sync with PFMS / eSAKSHI gateway."""
        sync_id = f"SYNC-{target_portal.upper()}-{uuid4().hex[:6].upper()}"
        now = datetime.now(timezone.utc).isoformat()

        # Count records in scope
        count = await self._works.count_documents({})

        message = (
            f"Successfully synchronized {count} master allocation records with the {target_portal.upper()} Central National Gateway."
        )

        await self._audit.insert_one({
            "event_id": str(uuid4()),
            "event_type": f"PORTAL_SYNCHRONIZATION_{target_portal.upper()}",
            "sync_reference_id": sync_id,
            "synced_records_count": count,
            "timestamp": now,
        })

        return PortalSyncResponse(
            target_portal=target_portal,
            status="synchronized",
            synced_records_count=count,
            sync_timestamp=now,
            sync_reference_id=sync_id,
            message=message,
        )
