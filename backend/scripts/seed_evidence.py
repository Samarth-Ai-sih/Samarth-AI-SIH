"""Seed controlled Phase 12 evidence-verification fixtures.

Usage:
    cd backend
    python -m scripts.seed_evidence

The generated PPM files are local demo assets only. The API never serves them,
and their verification records remain behind the READ_EVIDENCE permission.
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings
from app.core.database import Database
from app.models.evidence import EvidenceMetadataOverride
from app.services.evidence_verification_service import EvidenceVerificationService


def _ppm_bytes(*, variant: str) -> bytes:
    """Generate a small work-site-like image; near variants differ in only nine pixels."""
    width, height = 64, 48
    rows = [f"P3\n{width} {height}\n255\n"]
    for y in range(height):
        values: list[str] = []
        for x in range(width):
            if y < 18:
                red, green, blue = 132 + y, 190 + y // 2, 222
            elif 12 < x < 53 and 17 < y < 40:
                red, green, blue = 210, 190, 148
            elif 25 < x < 40 and 25 < y < 40:
                red, green, blue = 68, 91, 104
            else:
                red, green, blue = 113, 136, 88
            if variant == "near" and 3 < x < 7 and 3 < y < 7:
                red, green, blue = 134, 194, 226
            if variant == "far" and 45 < x < 57 and 27 < y < 39:
                red, green, blue = 178, 91, 62
            values.extend((str(red), str(green), str(blue)))
        rows.append(" ".join(values) + "\n")
    return "".join(rows).encode("ascii")


def _location(work: dict) -> tuple[float, float]:
    location = work.get("location") or {}
    return float(location.get("latitude", 0.0)), float(location.get("longitude", 0.0))


def _valid_timestamp(work: dict) -> datetime:
    for key in ("start_date", "sanctioned_date", "recommended_date"):
        value = work.get(key)
        if isinstance(value, datetime):
            return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)) + timedelta(days=7)
        if isinstance(value, str) and value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")) + timedelta(days=7)
            except ValueError:
                pass
    return datetime.now(timezone.utc) - timedelta(days=7)


async def main() -> None:
    settings = get_settings()
    db = Database(settings)
    await db.connect()
    service = EvidenceVerificationService(
        db,
        gps_tolerance_meters=settings.EVIDENCE_GPS_TOLERANCE_METERS,
        timestamp_tolerance_days=settings.EVIDENCE_TIMESTAMP_TOLERANCE_DAYS,
        phash_distance_threshold=settings.EVIDENCE_PHASH_DISTANCE_THRESHOLD,
        allow_local_demo=not settings.is_production,
    )
    works = await db.get_collection("works").find({}, {"_id": 0}).sort([("work_id", 1)]).to_list(length=6)
    if len(works) < 6:
        print("Need at least six seeded works before seeding evidence. Run scripts.seed_works first.")
        await db.disconnect()
        return

    evidence_collection = db.get_collection("evidence_metadata")
    existing = await evidence_collection.find({"demo_seed": True}, {"_id": 0, "evidence_id": 1}).to_list(length=1)
    if existing:
        print(
            "No records changed: controlled demo evidence already exists. "
            "Use a new empty synthetic demo database to seed again."
        )
        await db.disconnect()
        return

    scenarios = []
    lat, lng = _location(works[0])
    scenarios.append((
        works[0], "normal-valid-site.ppm", _ppm_bytes(variant="base"),
        EvidenceMetadataOverride(gps_latitude=lat, gps_longitude=lng, captured_at=_valid_timestamp(works[0])),
        "normal_valid_work_site",
    ))
    lat, lng = _location(works[1])
    scenarios.append((
        works[1], "near-duplicate-a.ppm", _ppm_bytes(variant="base"),
        EvidenceMetadataOverride(gps_latitude=lat, gps_longitude=lng, captured_at=_valid_timestamp(works[1])),
        "near_duplicate_across_work_a",
    ))
    lat, lng = _location(works[2])
    scenarios.append((
        works[2], "near-duplicate-b.ppm", _ppm_bytes(variant="near"),
        EvidenceMetadataOverride(gps_latitude=lat, gps_longitude=lng, captured_at=_valid_timestamp(works[2])),
        "near_duplicate_across_work_b",
    ))
    lat, lng = _location(works[3])
    scenarios.append((
        works[3], "gps-far-from-project.ppm", _ppm_bytes(variant="far"),
        EvidenceMetadataOverride(gps_latitude=lat + 2.0, gps_longitude=lng + 2.0, captured_at=_valid_timestamp(works[3])),
        "gps_far_from_project",
    ))
    lat, lng = _location(works[4])
    scenarios.append((
        works[4], "inconsistent-timestamp.ppm", _ppm_bytes(variant="far"),
        EvidenceMetadataOverride(gps_latitude=lat, gps_longitude=lng, captured_at=datetime(2005, 1, 1, tzinfo=timezone.utc)),
        "timestamp_inconsistency",
    ))
    scenarios.append((
        works[5], "no-metadata.ppm", _ppm_bytes(variant="far"), None, "no_metadata"))

    for work, filename, content, metadata, scenario in scenarios:
        record = await service.ingest_seeded_demo(
            work=work,
            filename=filename,
            content=content,
            metadata_override=metadata,
            demo_scenario=scenario,
        )
        print(f"Seeded {scenario}: {', '.join(label.value for label in record.verification_labels)}")

    result = await service.run_cross_project_duplicate_scan(performed_by="seed_evidence_script")
    print(f"Scanned {result.records_scanned} records; created {result.cross_project_matches} cross-project image match(es).")
    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
