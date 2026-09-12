"""Private image evidence verification, provenance checks, and reuse detection."""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import math
import re
import urllib.request
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import numpy as np
from PIL import ExifTags, Image, UnidentifiedImageError

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.evidence import (
    CloudinaryUploadCompleteRequest,
    CrossProjectDuplicateScanResponse,
    EvidenceMetadataOverride,
    EvidenceRecord,
    EvidenceStorageMode,
    EvidenceUploadSignatureResponse,
    EvidenceVerificationLabel,
    EvidenceVerificationResponse,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.evidence")

WORKS_COLLECTION = "works"
EVIDENCE_COLLECTION = "evidence_metadata"
DUPLICATE_IMAGE_COLLECTION = "evidence_duplicate_image_matches"
LOCAL_EVIDENCE_ROOT = Path(__file__).resolve().parents[2] / "data" / "evidence"
ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".ppm"}


class EvidenceVerificationService:
    """Persist private evidence facts without serving evidence files or raw location data."""

    def __init__(
        self,
        db: Database,
        *,
        gps_tolerance_meters: float = 500.0,
        timestamp_tolerance_days: int = 30,
        phash_distance_threshold: int = 8,
        allow_local_demo: bool = True,
    ):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)
        self._evidence = db.get_collection(EVIDENCE_COLLECTION)
        self._duplicate_images = db.get_collection(DUPLICATE_IMAGE_COLLECTION)
        self._audit = AuditService(db)
        self._gps_tolerance_meters = gps_tolerance_meters
        self._timestamp_tolerance_days = timestamp_tolerance_days
        self._phash_distance_threshold = phash_distance_threshold
        self._allow_local_demo = allow_local_demo

    async def ensure_indexes(self) -> None:
        """Create lookup indexes. No storage path or raw image is indexed publicly."""
        # A partial unique index leaves pre-Phase-12 count/hash records intact.
        await self._evidence.create_index(
            "evidence_id",
            unique=True,
            partialFilterExpression={"verification_schema_version": 1},
        )
        await self._evidence.create_index([("verification_schema_version", 1), ("work_id", 1), ("verified_at", -1)])
        await self._evidence.create_index([("work_id", 1), ("verified_at", -1)])
        await self._evidence.create_index([("file_hash", 1), ("work_id", 1)])
        await self._evidence.create_index("perceptual_hash")
        await self._evidence.create_index("demo_seed")
        await self._duplicate_images.create_index("pair_key", unique=True)
        await self._duplicate_images.create_index([("left_work_id", 1), ("right_work_id", 1)])

    async def work_in_scope(self, work_id: str, jurisdiction_filter: dict[str, Any]) -> Optional[dict[str, Any]]:
        query: dict[str, Any] = {"work_id": work_id}
        query.update(jurisdiction_filter or {})
        return await self._works.find_one(query, {"_id": 0})

    def build_upload_signature(
        self,
        *,
        work_id: str,
        evidence_id: str,
        cloud_name: str,
        api_key: str,
        api_secret: str,
    ) -> EvidenceUploadSignatureResponse:
        """Build a short-lived authenticated Cloudinary upload signature, or demo fallback."""
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=10)
        completion_endpoint = "/api/v1/evidence/cloudinary-complete"
        if not (cloud_name and api_key and api_secret):
            if not self._allow_local_demo:
                raise ValueError("A production evidence storage provider is not configured")
            return EvidenceUploadSignatureResponse(
                evidence_id=evidence_id,
                storage_mode=EvidenceStorageMode.LOCAL_DEMO,
                local_upload_endpoint="/api/v1/evidence/local-upload",
                completion_endpoint=completion_endpoint,
                expires_at=expires_at,
            )

        timestamp = int(now.timestamp())
        folder = f"samarth-ai/private-evidence/{_safe_identifier(work_id)}"
        public_id = f"{folder}/{evidence_id}"
        # Cloudinary signs its canonical parameter string with its SDK helper.
        # Do not substitute a generic HMAC; Cloudinary's upload API validates
        # its own signature algorithm and parameter encoding rules.
        from cloudinary.utils import api_sign_request

        params = {"public_id": public_id, "timestamp": timestamp, "type": "authenticated"}
        signature = api_sign_request(params, api_secret)
        return EvidenceUploadSignatureResponse(
            evidence_id=evidence_id,
            storage_mode=EvidenceStorageMode.CLOUDINARY,
            upload_url=f"https://api.cloudinary.com/v1_1/{cloud_name}/image/upload",
            api_key=api_key,
            timestamp=timestamp,
            signature=signature,
            folder=folder,
            public_id=public_id,
            upload_type="authenticated",
            completion_endpoint=completion_endpoint,
            expires_at=expires_at,
        )

    async def ingest_local_upload(
        self,
        *,
        work: dict[str, Any],
        filename: str,
        content_type: str,
        content: bytes,
        uploaded_by: str,
        client_latitude: Optional[float] = None,
        client_longitude: Optional[float] = None,
        client_captured_at: Optional[datetime] = None,
        ip_address: str = "",
        user_agent: str = "",
    ) -> EvidenceVerificationResponse:
        """Persist a locally uploaded image in demo mode and verify server-side bytes."""
        if not self._allow_local_demo:
            raise ValueError("Local evidence storage is disabled in this environment")
        _validate_image_upload(filename, content_type, content)
        evidence_id = str(uuid4())
        suffix = _safe_suffix(filename)
        storage_path = LOCAL_EVIDENCE_ROOT / "uploads" / f"{evidence_id}{suffix}"
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(content)
        record = await self._ingest_bytes(
            evidence_id=evidence_id,
            work=work,
            filename=filename,
            content_type=content_type,
            content=content,
            storage_mode=EvidenceStorageMode.LOCAL_DEMO,
            storage_reference=str(storage_path.relative_to(LOCAL_EVIDENCE_ROOT.parent)),
            uploaded_by=uploaded_by,
            client_latitude=client_latitude,
            client_longitude=client_longitude,
            client_captured_at=client_captured_at,
        )
        await self._audit_upload(record, uploaded_by, ip_address, user_agent)
        return _safe_response(record)

    async def ingest_seeded_demo(
        self,
        *,
        work: dict[str, Any],
        filename: str,
        content: bytes,
        metadata_override: Optional[EvidenceMetadataOverride],
        demo_scenario: str,
    ) -> EvidenceRecord:
        """Create deterministic demo fixtures. This helper is intentionally not exposed by the API."""
        if not self._allow_local_demo:
            raise ValueError("Seeded local evidence is disabled in this environment")
        _validate_image_upload(filename, "image/x-portable-pixmap", content, allow_ppm=True)
        evidence_id = f"demo-{_safe_identifier(demo_scenario)}-{_safe_identifier(str(work.get('work_id', 'work')))[:8]}"
        storage_path = LOCAL_EVIDENCE_ROOT / "seeded" / filename
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        storage_path.write_bytes(content)
        return await self._ingest_bytes(
            evidence_id=evidence_id,
            work=work,
            filename=filename,
            content_type="image/x-portable-pixmap",
            content=content,
            storage_mode=EvidenceStorageMode.LOCAL_DEMO,
            storage_reference=str(storage_path.relative_to(LOCAL_EVIDENCE_ROOT.parent)),
            uploaded_by="seed_evidence_script",
            metadata_override=metadata_override,
            demo_seed=True,
            demo_scenario=demo_scenario,
        )

    async def complete_cloudinary_upload(
        self,
        *,
        work: dict[str, Any],
        request: CloudinaryUploadCompleteRequest,
        uploaded_by: str,
        cloud_name: str,
        api_key: str,
        api_secret: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> EvidenceVerificationResponse:
        """Fetch the authenticated asset server-side, then derive verification facts from its bytes."""
        expected_prefix = f"samarth-ai/private-evidence/{_safe_identifier(str(work.get('work_id', '')))}"
        if not request.public_id.startswith(f"{expected_prefix}/") or not _safe_cloudinary_id(request.public_id):
            raise ValueError("Cloudinary public ID is outside the authorized work folder")
        if not (cloud_name and api_key and api_secret):
            raise ValueError("Cloudinary is not configured")

        existing = await self._evidence.find_one({"evidence_id": request.evidence_id}, {"_id": 0})
        if existing:
            if existing.get("work_id") != str(work.get("work_id", "")):
                raise ValueError("Evidence upload ticket belongs to a different work")
            return _safe_response(EvidenceRecord(**existing))

        try:
            content = await asyncio.to_thread(
                _download_authenticated_cloudinary_asset,
                request.public_id,
                cloud_name,
                api_key,
                api_secret,
            )
            _validate_image_upload(request.filename, request.content_type, content)
            record = await self._ingest_bytes(
                evidence_id=request.evidence_id,
                work=work,
                filename=request.filename,
                content_type=request.content_type,
                content=content,
                storage_mode=EvidenceStorageMode.CLOUDINARY,
                storage_reference=request.public_id,
                uploaded_by=uploaded_by,
                client_latitude=request.gps_latitude,
                client_longitude=request.gps_longitude,
                client_captured_at=request.captured_at,
            )
        except Exception as exc:
            # The authenticated asset is never returned to the caller. A failed fetch is
            # honestly represented as unavailable metadata rather than inferred results.
            logger.warning("Cloudinary evidence verification unavailable for %s: %s", request.evidence_id, exc)
            record = await self._persist_unavailable_cloudinary_record(
                work=work,
                request=request,
                uploaded_by=uploaded_by,
            )

        await self._audit_upload(record, uploaded_by, ip_address, user_agent)
        return _safe_response(record)

    async def list_evidence(
        self,
        *,
        jurisdiction_filter: dict[str, Any],
        work_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 25,
    ) -> tuple[list[EvidenceVerificationResponse], int, int]:
        """List only evidence whose parent work is in the caller's scope."""
        allowed_work_ids = await self._scoped_work_ids(jurisdiction_filter)
        if work_id:
            if work_id not in allowed_work_ids:
                return [], 0, 1
            query: dict[str, Any] = {"work_id": work_id, "verification_schema_version": 1}
        elif not allowed_work_ids:
            return [], 0, 1
        else:
            query = {"work_id": {"$in": sorted(allowed_work_ids)}, "verification_schema_version": 1}
        total = await self._evidence.count_documents(query)
        total_pages = max(1, math.ceil(total / page_size))
        cursor = self._evidence.find(query, {"_id": 0}).sort([("verified_at", -1)]).skip((page - 1) * page_size).limit(page_size)
        documents = await cursor.to_list(length=page_size)
        return [_safe_response(EvidenceRecord(**doc)) for doc in documents], total, total_pages

    async def get_evidence(
        self,
        evidence_id: str,
        *,
        jurisdiction_filter: dict[str, Any],
    ) -> Optional[EvidenceVerificationResponse]:
        document = await self._evidence.find_one({"evidence_id": evidence_id}, {"_id": 0})
        if not document:
            return None
        if not await self.work_in_scope(str(document.get("work_id", "")), jurisdiction_filter):
            return None
        return _safe_response(EvidenceRecord(**document))

    async def get_evidence_file(
        self,
        evidence_id: str,
        *,
        jurisdiction_filter: dict[str, Any],
    ) -> tuple[Optional[Path], str]:
        document = await self._evidence.find_one({"evidence_id": evidence_id}, {"_id": 0})
        if not document:
            return None, ""
        if not await self.work_in_scope(str(document.get("work_id", "")), jurisdiction_filter):
            return None, ""
        storage_ref = str(document.get("storage_reference", "")).strip()
        if not storage_ref:
            return None, ""
        candidate = (LOCAL_EVIDENCE_ROOT.parent / storage_ref).resolve()
        if not candidate.is_file():
            candidate = (LOCAL_EVIDENCE_ROOT / storage_ref).resolve()
        if not candidate.is_file():
            return None, ""
        return candidate, str(document.get("media_type") or "image/jpeg")

    async def refresh_local_metadata(self, evidence_id: str) -> dict[str, Any]:
        """Re-extract SHA-256, pHash, EXIF, GPS, and capture time for a local asset.

        This is used by a retryable worker for records created before a
        metadata extraction completed. Cloudinary assets are deliberately not
        fetched here: authenticated storage access remains on the explicit
        completion flow, avoiding broad worker credentials and accidental
        asset disclosure.
        """
        document = await self._evidence.find_one(
            {"evidence_id": evidence_id, "verification_schema_version": 1}, {"_id": 0}
        )
        if not document:
            return {"evidence_id": evidence_id, "status": "not_found"}
        if document.get("storage_mode") != EvidenceStorageMode.LOCAL_DEMO.value:
            return {"evidence_id": evidence_id, "status": "skipped_non_local"}
        reference = Path(str(document.get("storage_reference", "")))
        candidate = (LOCAL_EVIDENCE_ROOT.parent / reference).resolve()
        root = LOCAL_EVIDENCE_ROOT.parent.resolve()
        if root not in candidate.parents or not candidate.is_file():
            raise ValueError("Local evidence file is unavailable for metadata refresh")
        content = await asyncio.to_thread(candidate.read_bytes)
        analysis = _analyse_image(content)
        work = await self._works.find_one({"work_id": document.get("work_id")}, {"_id": 0}) or {}
        updates: dict[str, Any] = {
            "sha256_hash": hashlib.sha256(content).hexdigest(),
            "file_hash": hashlib.sha256(content).hexdigest(),
            "perceptual_hash": analysis["perceptual_hash"],
            "exif_fields": analysis["exif_fields"],
            "verified_at": datetime.now(timezone.utc),
        }
        if document.get("metadata_source") != "seeded_demo_fixture":
            gps_latitude, gps_longitude = analysis["gps_latitude"], analysis["gps_longitude"]
            captured_at = analysis["captured_at"]
            distance = _distance_from_work(work, gps_latitude, gps_longitude)
            timestamp_consistent = _timestamp_is_consistent(captured_at, work, tolerance_days=self._timestamp_tolerance_days)
            updates.update({
                "gps_latitude": gps_latitude,
                "gps_longitude": gps_longitude,
                "captured_at": captured_at,
                "distance_from_project_meters": round(distance, 2) if distance is not None else None,
                "timestamp_consistent": timestamp_consistent,
                "metadata_available": bool(analysis["exif_fields"] or (gps_latitude is not None and captured_at is not None)),
                "metadata_source": "embedded_exif" if analysis["metadata_available"] else "unavailable",
                "verification_labels": _verification_labels(
                    metadata_available=bool(analysis["exif_fields"] or gps_latitude is not None or captured_at is not None),
                    distance_meters=distance, gps_tolerance_meters=self._gps_tolerance_meters,
                    timestamp_consistent=timestamp_consistent,
                ),
            })
        await self._evidence.update_one({"evidence_id": evidence_id}, {"$set": updates})
        return {"evidence_id": evidence_id, "status": "refreshed", "perceptual_hash_available": bool(analysis["perceptual_hash"])}

    async def run_cross_project_duplicate_scan(
        self,
        *,
        performed_by: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> CrossProjectDuplicateScanResponse:
        """Compare stored pHashes across all projects without exposing image files."""
        documents = await self._evidence.find(
            {"verification_schema_version": 1, "perceptual_hash": {"$ne": None}}, {"_id": 0}
        ).to_list(length=None)
        documents = [doc for doc in documents if doc.get("perceptual_hash")]
        matches_found = 0
        for index, left in enumerate(documents):
            for right in documents[index + 1:]:
                if left.get("work_id") == right.get("work_id"):
                    continue
                distance = _hamming_distance(str(left["perceptual_hash"]), str(right["perceptual_hash"]))
                if distance <= self._phash_distance_threshold:
                    matches_found += 1
                    await self._link_duplicate_pair(left, right, distance)
        response = CrossProjectDuplicateScanResponse(
            records_scanned=len(documents),
            cross_project_matches=matches_found,
            perceptual_hash_distance_threshold=self._phash_distance_threshold,
            completed_at=datetime.now(timezone.utc),
        )
        await self._audit.log_event(
            AuditEventType.EVIDENCE_DUPLICATE_SCAN,
            user_id=performed_by,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="evidence_duplicate_image_scan",
            resource_id=response.completed_at.isoformat(),
            details={
                "records_scanned": response.records_scanned,
                "matches_found": response.cross_project_matches,
                "threshold": self._phash_distance_threshold,
            },
        )
        return response

    async def _ingest_bytes(
        self,
        *,
        evidence_id: str,
        work: dict[str, Any],
        filename: str,
        content_type: str,
        content: bytes,
        storage_mode: EvidenceStorageMode,
        storage_reference: str,
        uploaded_by: str,
        client_latitude: Optional[float] = None,
        client_longitude: Optional[float] = None,
        client_captured_at: Optional[datetime] = None,
        metadata_override: Optional[EvidenceMetadataOverride] = None,
        demo_seed: bool = False,
        demo_scenario: str = "",
    ) -> EvidenceRecord:
        analysis = _analyse_image(content)
        now = datetime.now(timezone.utc)
        gps_latitude = analysis["gps_latitude"]
        gps_longitude = analysis["gps_longitude"]
        captured_at = analysis["captured_at"]
        exif_fields = list(analysis["exif_fields"])
        metadata_source = "embedded_exif" if analysis["metadata_available"] else "unavailable"

        # If image bytes lacked EXIF GPS (e.g., canvas-watermarked live photo or mobile web capture),
        # use verified device GPS coordinates captured by the field inspector's device.
        if gps_latitude is None and client_latitude is not None and client_longitude is not None:
            gps_latitude = float(client_latitude)
            gps_longitude = float(client_longitude)
            metadata_source = "device_geotag"
            if "GPS (device geotag)" not in exif_fields:
                exif_fields = sorted(set(exif_fields + ["GPS (device geotag)"]))

        if captured_at is None and client_captured_at is not None:
            captured_at = _as_utc(client_captured_at)
            metadata_source = "device_geotag" if metadata_source == "device_geotag" else "device_timestamp"
            if "DateTimeOriginal (device)" not in exif_fields:
                exif_fields = sorted(set(exif_fields + ["DateTimeOriginal (device)"]))

        if metadata_override:
            if metadata_override.gps_latitude is not None and metadata_override.gps_longitude is not None:
                gps_latitude, gps_longitude = metadata_override.gps_latitude, metadata_override.gps_longitude
                exif_fields = sorted(set(exif_fields + ["GPS (seeded demo)"]))
            if metadata_override.captured_at:
                captured_at = _as_utc(metadata_override.captured_at)
                exif_fields = sorted(set(exif_fields + ["DateTimeOriginal (seeded demo)"]))
            metadata_source = "seeded_demo_fixture"

        distance = _distance_from_work(work, gps_latitude, gps_longitude)
        timestamp_consistent = _timestamp_is_consistent(
            captured_at,
            work,
            tolerance_days=self._timestamp_tolerance_days,
        )
        labels = _verification_labels(
            metadata_available=bool(exif_fields or gps_latitude is not None or captured_at is not None),
            distance_meters=distance,
            gps_tolerance_meters=self._gps_tolerance_meters,
            timestamp_consistent=timestamp_consistent,
        )
        record = EvidenceRecord(
            evidence_id=evidence_id,
            work_id=str(work.get("work_id", "")),
            storage_mode=storage_mode,
            storage_reference=storage_reference,
            original_filename=_safe_filename(filename),
            media_type=content_type or "application/octet-stream",
            file_size_bytes=len(content),
            sha256_hash=hashlib.sha256(content).hexdigest(),
            file_hash=hashlib.sha256(content).hexdigest(),
            perceptual_hash=analysis["perceptual_hash"],
            exif_fields=exif_fields,
            gps_latitude=gps_latitude,
            gps_longitude=gps_longitude,
            captured_at=captured_at,
            distance_from_project_meters=round(distance, 2) if distance is not None else None,
            timestamp_consistent=timestamp_consistent,
            metadata_available=bool(exif_fields or (gps_latitude is not None and captured_at is not None)),
            metadata_source=metadata_source,
            verification_labels=labels,
            demo_seed=demo_seed,
            demo_scenario=demo_scenario,
            uploaded_by=uploaded_by,
            created_at=now,
            verified_at=now,
        )
        await self._evidence.insert_one(record.model_dump())
        await self._detect_reused_evidence(record)
        stored = await self._evidence.find_one({"evidence_id": evidence_id}, {"_id": 0})
        return EvidenceRecord(**(stored or record.model_dump()))

    async def _persist_unavailable_cloudinary_record(
        self,
        *,
        work: dict[str, Any],
        request: CloudinaryUploadCompleteRequest,
        uploaded_by: str,
    ) -> EvidenceRecord:
        now = datetime.now(timezone.utc)
        record = EvidenceRecord(
            evidence_id=request.evidence_id,
            work_id=str(work.get("work_id", "")),
            storage_mode=EvidenceStorageMode.CLOUDINARY,
            storage_reference=request.public_id,
            original_filename=_safe_filename(request.filename),
            media_type=request.content_type,
            file_size_bytes=0,
            metadata_available=False,
            metadata_source="unavailable",
            verification_labels=[EvidenceVerificationLabel.METADATA_UNAVAILABLE],
            uploaded_by=uploaded_by,
            created_at=now,
            verified_at=now,
        )
        await self._evidence.insert_one(record.model_dump())
        return record

    async def _detect_reused_evidence(self, record: EvidenceRecord) -> None:
        if not record.perceptual_hash:
            return
        candidates = await self._evidence.find(
            {
                "verification_schema_version": 1,
                "work_id": {"$ne": record.work_id},
                "perceptual_hash": {"$ne": None},
            },
            {"_id": 0},
        ).to_list(length=None)
        for candidate in candidates:
            if candidate.get("evidence_id") == record.evidence_id or not candidate.get("perceptual_hash"):
                continue
            distance = _hamming_distance(record.perceptual_hash, str(candidate["perceptual_hash"]))
            if distance <= self._phash_distance_threshold:
                await self._link_duplicate_pair(record.model_dump(), candidate, distance)

    async def _link_duplicate_pair(self, left: dict[str, Any], right: dict[str, Any], distance: int) -> bool:
        left_id, right_id = sorted((str(left["evidence_id"]), str(right["evidence_id"])))
        pair_key = f"{left_id}:{right_id}"
        if await self._duplicate_images.find_one({"pair_key": pair_key}, {"_id": 0}):
            return False
        match_id = str(uuid4())
        document = {
            "match_id": match_id,
            "pair_key": pair_key,
            "left_evidence_id": left_id,
            "right_evidence_id": right_id,
            "left_work_id": str(left["work_id"]),
            "right_work_id": str(right["work_id"]),
            "perceptual_hash_distance": distance,
            "created_at": datetime.now(timezone.utc),
        }
        await self._duplicate_images.insert_one(document)
        await self._append_reuse_signal(left_id, match_id)
        await self._append_reuse_signal(right_id, match_id)
        return True

    async def _append_reuse_signal(self, evidence_id: str, match_id: str) -> None:
        document = await self._evidence.find_one({"evidence_id": evidence_id}, {"_id": 0})
        if not document:
            return
        labels = _label_values(document.get("verification_labels", []))
        if EvidenceVerificationLabel.POSSIBLE_REUSED_EVIDENCE.value not in labels:
            labels.append(EvidenceVerificationLabel.POSSIBLE_REUSED_EVIDENCE.value)
        match_ids = list(document.get("duplicate_match_ids", []))
        if match_id not in match_ids:
            match_ids.append(match_id)
        await self._evidence.update_one(
            {"evidence_id": evidence_id},
            {"$set": {
                "verification_labels": labels,
                "duplicate_match_ids": match_ids,
                "possible_reused_evidence_count": len(match_ids),
                "verified_at": datetime.now(timezone.utc),
            }},
        )

    async def _scoped_work_ids(self, jurisdiction_filter: dict[str, Any]) -> set[str]:
        works = await self._works.find(
            jurisdiction_filter or {}, {"_id": 0, "work_id": 1}
        ).to_list(length=None)
        return {str(work["work_id"]) for work in works if work.get("work_id")}

    async def _audit_upload(
        self,
        record: EvidenceRecord,
        user_id: str,
        ip_address: str,
        user_agent: str,
    ) -> None:
        safe_details = {
            "work_id": record.work_id,
            "storage_mode": record.storage_mode.value,
            "metadata_available": record.metadata_available,
            "verification_labels": [label.value for label in record.verification_labels],
        }
        await self._audit.log_event(
            AuditEventType.EVIDENCE_UPLOADED,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="private_evidence",
            resource_id=record.evidence_id,
            details=safe_details,
        )
        await self._audit.log_event(
            AuditEventType.EVIDENCE_VERIFIED,
            user_id=user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="private_evidence",
            resource_id=record.evidence_id,
            details=safe_details,
        )


def _safe_response(record: EvidenceRecord) -> EvidenceVerificationResponse:
    """Strip storage references, original filenames, raw GPS, and match internals."""
    return EvidenceVerificationResponse(
        evidence_id=record.evidence_id,
        work_id=record.work_id,
        evidence_type=record.evidence_type,
        storage_mode=record.storage_mode,
        media_type=record.media_type,
        file_size_bytes=record.file_size_bytes,
        sha256_hash=record.sha256_hash,
        perceptual_hash=record.perceptual_hash,
        exif_fields=record.exif_fields,
        metadata_available=record.metadata_available,
        metadata_source=record.metadata_source,
        gps_available=record.gps_latitude is not None and record.gps_longitude is not None,
        distance_from_project_meters=record.distance_from_project_meters,
        captured_at=record.captured_at,
        timestamp_consistent=record.timestamp_consistent,
        verification_labels=[EvidenceVerificationLabel(label) for label in _label_values(record.verification_labels)],
        possible_reused_evidence_count=record.possible_reused_evidence_count,
        created_at=record.created_at,
        verified_at=record.verified_at,
    )


def _analyse_image(content: bytes) -> dict[str, Any]:
    """Extract a SHA-independent pHash and selected EXIF facts from an image byte stream."""
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.load()
            exif = image.getexif()
            exif_fields = sorted(
                ExifTags.TAGS.get(tag, f"Tag-{tag}")
                for tag in exif.keys()
            )
            gps_latitude, gps_longitude = _extract_gps(exif)
            captured_at = _extract_timestamp(exif)
            return {
                "perceptual_hash": _perceptual_hash(image),
                "exif_fields": exif_fields,
                "gps_latitude": gps_latitude,
                "gps_longitude": gps_longitude,
                "captured_at": captured_at,
                "metadata_available": bool(exif_fields or gps_latitude is not None or captured_at is not None),
            }
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("Evidence file is not a supported readable image") from exc


def _perceptual_hash(image: Image.Image) -> str:
    """Compute a deterministic 64-bit DCT pHash without a separate imagehash package."""
    pixels = np.asarray(image.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float64)
    n = 32
    indices = np.arange(n)
    # Rows are DCT frequencies; columns are image samples.
    transform = np.cos(np.pi * indices[:, None] * (2 * indices[None, :] + 1) / (2 * n))
    transform[0, :] *= math.sqrt(1 / n)
    transform[1:, :] *= math.sqrt(2 / n)
    dct = transform @ pixels @ transform.T
    low_frequency = dct[:8, :8]
    median = float(np.median(low_frequency.flatten()[1:]))
    bits = "".join("1" if value > median else "0" for value in low_frequency.flatten())
    return f"{int(bits, 2):016x}"


def _extract_gps(exif: Any) -> tuple[Optional[float], Optional[float]]:
    try:
        gps = exif.get_ifd(34853)
    except (AttributeError, KeyError, TypeError, ValueError):
        gps = exif.get(34853) if hasattr(exif, "get") else None
    if not isinstance(gps, dict):
        return None, None
    latitude = _gps_coordinate(gps.get(2), gps.get(1))
    longitude = _gps_coordinate(gps.get(4), gps.get(3))
    return latitude, longitude


def _gps_coordinate(value: Any, hemisphere: Any) -> Optional[float]:
    if not value or not hemisphere:
        return None
    try:
        degrees, minutes, seconds = value
        decimal = _rational(degrees) + _rational(minutes) / 60 + _rational(seconds) / 3600
        direction = str(hemisphere).upper()
        if direction in {"S", "W", "B'S'", "B'W'"}:
            decimal = -decimal
        return float(decimal)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _rational(value: Any) -> float:
    if hasattr(value, "numerator") and hasattr(value, "denominator"):
        return float(value.numerator) / float(value.denominator)
    if isinstance(value, tuple) and len(value) == 2:
        return float(value[0]) / float(value[1])
    return float(value)


def _extract_timestamp(exif: Any) -> Optional[datetime]:
    for tag in (36867, 36868, 306):  # DateTimeOriginal, DateTimeDigitized, DateTime
        raw = exif.get(tag) if hasattr(exif, "get") else None
        if not raw:
            continue
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="ignore")
        try:
            return datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _distance_from_work(work: dict[str, Any], latitude: Optional[float], longitude: Optional[float]) -> Optional[float]:
    if latitude is None or longitude is None:
        return None
    location = work.get("location") if isinstance(work.get("location"), dict) else {}
    try:
        work_latitude = float(location.get("latitude"))
        work_longitude = float(location.get("longitude"))
    except (TypeError, ValueError):
        return None
    return _haversine_distance(latitude, longitude, work_latitude, work_longitude)


def _haversine_distance(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius_m = 6_371_000.0
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    delta_phi, delta_lambda = math.radians(lat_b - lat_a), math.radians(lon_b - lon_a)
    component = math.sin(delta_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(component), math.sqrt(1 - component))


def _timestamp_is_consistent(captured_at: Optional[datetime], work: dict[str, Any], *, tolerance_days: int) -> Optional[bool]:
    if not captured_at:
        return None
    baseline = _parse_datetime(work.get("recommended_date")) or _parse_datetime(work.get("start_date"))
    if baseline and captured_at < baseline - timedelta(days=tolerance_days):
        return False
    if captured_at > datetime.now(timezone.utc) + timedelta(days=1):
        return False
    return True


def _verification_labels(
    *,
    metadata_available: bool,
    distance_meters: Optional[float],
    gps_tolerance_meters: float,
    timestamp_consistent: Optional[bool],
) -> list[EvidenceVerificationLabel]:
    labels: list[EvidenceVerificationLabel] = []
    if not metadata_available:
        labels.append(EvidenceVerificationLabel.METADATA_UNAVAILABLE)
        return labels
    if distance_meters is not None and distance_meters > gps_tolerance_meters:
        labels.append(EvidenceVerificationLabel.GPS_MISMATCH)
    if timestamp_consistent is False:
        labels.append(EvidenceVerificationLabel.TIMESTAMP_INCONSISTENCY)
    if not labels:
        labels.append(EvidenceVerificationLabel.VERIFIED_METADATA_AVAILABLE)
    return labels


def _hamming_distance(left: str, right: str) -> int:
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        return 64


def _label_values(labels: list[Any]) -> list[str]:
    values = []
    for label in labels:
        value = label.value if isinstance(label, EvidenceVerificationLabel) else str(label)
        if value not in values:
            values.append(value)
    return values


def _validate_image_upload(filename: str, content_type: str, content: bytes, *, allow_ppm: bool = False) -> None:
    suffix = _safe_suffix(filename)
    permitted = ALLOWED_IMAGE_SUFFIXES if allow_ppm else ALLOWED_IMAGE_SUFFIXES - {".ppm"}
    if suffix not in permitted or not content_type.lower().startswith("image/"):
        raise ValueError("Only supported image evidence files may be uploaded")
    if not content:
        raise ValueError("Evidence file is empty")
    if len(content) > 10 * 1024 * 1024:
        raise ValueError("Evidence file exceeds the 10 MB limit")
    _analyse_image(content)


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return suffix if suffix in ALLOWED_IMAGE_SUFFIXES else ""


def _safe_filename(filename: str) -> str:
    return Path(filename).name[:255] or "evidence-image"


def _safe_identifier(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return normalized[:120] or "work"


def _safe_cloudinary_id(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_./-]{1,300}", value))


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return _as_utc(value)
    if isinstance(value, str) and value:
        try:
            return _as_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _download_authenticated_cloudinary_asset(public_id: str, cloud_name: str, api_key: str, api_secret: str) -> bytes:
    """Download through a signed authenticated URL; the URL is never exposed in API responses."""
    import cloudinary
    import cloudinary.utils

    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret, secure=True)
    url, _ = cloudinary.utils.cloudinary_url(
        public_id,
        resource_type="image",
        type="authenticated",
        sign_url=True,
        secure=True,
    )
    with urllib.request.urlopen(url, timeout=15) as response:  # nosec B310: fixed provider URL built by SDK
        return response.read(10 * 1024 * 1024 + 1)
