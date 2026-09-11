"""Phase 12 tests for private, explainable evidence verification."""

from datetime import datetime, timezone
from io import BytesIO

import pytest

pytest.importorskip("PIL")

from PIL import Image, ImageDraw
from cloudinary.utils import api_sign_request

from app.core.permissions import Permission, has_permission
from app.models.evidence import EvidenceMetadataOverride, EvidenceStorageMode, EvidenceVerificationLabel
from app.models.user import UserRole
from app.services.evidence_verification_service import EvidenceVerificationService, _hamming_distance
from tests.test_risk_scoring import MemoryDatabase


def _image(marker: int = 0) -> bytes:
    image = Image.new("RGB", (96, 72), (135, 191, 222))
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((15, 28, 80, 65), fill=(210, 190, 148))
    drawing.rectangle((39, 43, 56, 65), fill=(68, 91, 104))
    # A deliberately tiny difference remains a near duplicate under pHash.
    drawing.rectangle((2 + marker, 2, 5 + marker, 5), fill=(134, 194, 226))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _work(work_id: str, latitude: float, longitude: float) -> dict:
    return {
        "work_id": work_id,
        "state_code": "UP",
        "title": f"Evidence work {work_id}",
        "recommended_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "location": {"latitude": latitude, "longitude": longitude},
    }


@pytest.mark.asyncio
async def test_verification_persists_hashes_metadata_labels_and_cross_project_similarity():
    works = [_work(f"work-{index}", 26.84 + index / 100, 80.94 + index / 100) for index in range(6)]
    db = MemoryDatabase({"works": works, "evidence_metadata": []})
    service = EvidenceVerificationService(db, phash_distance_threshold=8)

    normal = await service.ingest_seeded_demo(
        work=works[0], filename="normal.ppm", content=_image(), demo_scenario="normal",
        metadata_override=EvidenceMetadataOverride(
            gps_latitude=26.84, gps_longitude=80.94,
            captured_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
    )
    reused_a = await service.ingest_seeded_demo(
        work=works[1], filename="reuse-a.ppm", content=_image(), demo_scenario="reuse_a",
        metadata_override=EvidenceMetadataOverride(
            gps_latitude=26.85, gps_longitude=80.95,
            captured_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
    )
    reused_b = await service.ingest_seeded_demo(
        work=works[2], filename="reuse-b.ppm", content=_image(marker=1), demo_scenario="reuse_b",
        metadata_override=EvidenceMetadataOverride(
            gps_latitude=26.86, gps_longitude=80.96,
            captured_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
    )
    far_gps = await service.ingest_seeded_demo(
        work=works[3], filename="far.ppm", content=_image(marker=2), demo_scenario="far_gps",
        metadata_override=EvidenceMetadataOverride(
            gps_latitude=28.0, gps_longitude=82.0,
            captured_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
    )
    inconsistent_time = await service.ingest_seeded_demo(
        work=works[4], filename="old.ppm", content=_image(marker=3), demo_scenario="old_time",
        metadata_override=EvidenceMetadataOverride(
            gps_latitude=26.88, gps_longitude=80.98,
            captured_at=datetime(2005, 1, 1, tzinfo=timezone.utc),
        ),
    )
    no_metadata = await service.ingest_seeded_demo(
        work=works[5], filename="none.ppm", content=_image(marker=4), demo_scenario="none",
        metadata_override=None,
    )

    assert len(normal.sha256_hash or "") == 64
    assert normal.file_hash == normal.sha256_hash
    assert len(normal.perceptual_hash or "") == 16
    assert EvidenceVerificationLabel.VERIFIED_METADATA_AVAILABLE in normal.verification_labels
    assert _hamming_distance(reused_a.perceptual_hash or "", reused_b.perceptual_hash or "") <= 8

    stored_reused = await service.get_evidence(reused_b.evidence_id, jurisdiction_filter={"state_code": "UP"})
    assert stored_reused is not None
    assert EvidenceVerificationLabel.POSSIBLE_REUSED_EVIDENCE in stored_reused.verification_labels
    assert stored_reused.possible_reused_evidence_count >= 1
    assert not hasattr(stored_reused, "storage_reference")

    assert EvidenceVerificationLabel.GPS_MISMATCH in far_gps.verification_labels
    assert far_gps.distance_from_project_meters and far_gps.distance_from_project_meters > 500
    assert EvidenceVerificationLabel.TIMESTAMP_INCONSISTENCY in inconsistent_time.verification_labels
    assert EvidenceVerificationLabel.METADATA_UNAVAILABLE in no_metadata.verification_labels
    assert len(db.get_collection("evidence_duplicate_image_matches").documents) >= 1

    scan = await service.run_cross_project_duplicate_scan(performed_by="reviewer")
    assert scan.records_scanned == 6
    assert scan.cross_project_matches >= 1


def test_cloudinary_signing_uses_authenticated_mode_and_local_demo_fallback():
    service = EvidenceVerificationService(MemoryDatabase({}))
    local = service.build_upload_signature(
        work_id="work-1", evidence_id="evidence-1", cloud_name="", api_key="", api_secret="",
    )
    signed = service.build_upload_signature(
        work_id="work-1", evidence_id="evidence-2", cloud_name="demo-cloud", api_key="demo-key", api_secret="demo-secret",
    )

    assert local.storage_mode == EvidenceStorageMode.LOCAL_DEMO
    assert local.local_upload_endpoint == "/api/v1/evidence/local-upload"
    assert signed.storage_mode == EvidenceStorageMode.CLOUDINARY
    assert signed.upload_type == "authenticated"
    assert signed.signature and "demo-secret" not in signed.model_dump_json()
    assert signed.signature == api_sign_request(
        {"public_id": signed.public_id, "timestamp": signed.timestamp, "type": "authenticated"},
        "demo-secret",
    )


def test_local_evidence_fallback_can_be_disabled_for_production():
    service = EvidenceVerificationService(MemoryDatabase({}), allow_local_demo=False)
    with pytest.raises(ValueError, match="production evidence storage provider"):
        service.build_upload_signature(
            work_id="work-1", evidence_id="evidence-1", cloud_name="", api_key="", api_secret="",
        )


def test_citizens_do_not_have_private_evidence_permission():
    assert not has_permission(UserRole.CITIZEN, Permission.READ_EVIDENCE)
    assert not has_permission(UserRole.CITIZEN, Permission.WRITE_EVIDENCE)
