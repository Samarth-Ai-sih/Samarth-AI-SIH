"""Explainable possible duplicate-work detection, clustering, and review workflow."""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.audit import AuditEventType
from app.models.duplicate import (
    DuplicateCaseCreateRequest,
    DuplicateCaseResponse,
    DuplicateCluster,
    DuplicateComparisonResponse,
    DuplicateDetectionRule,
    DuplicateDetectionScan,
    DuplicateMatch,
    DuplicateMatchStatus,
    DuplicateReviewRequest,
    DuplicateWorkSummary,
)
from app.services.audit_service import AuditService

logger = logging.getLogger("samarth.duplicates")

WORKS_COLLECTION = "works"
EVIDENCE_COLLECTION = "evidence_metadata"
SCANS_COLLECTION = "duplicate_detection_scans"
MATCHES_COLLECTION = "duplicate_work_matches"
CLUSTERS_COLLECTION = "duplicate_work_clusters"
CASES_COLLECTION = "duplicate_work_cases"

CATEGORY_FAMILIES = {
    "roads_and_bridges": "infrastructure",
    "community_infrastructure": "infrastructure",
    "education": "public_services",
    "healthcare": "public_services",
    "sports": "public_services",
    "drinking_water": "utilities",
    "sanitation": "utilities",
    "electricity": "utilities",
    "irrigation": "utilities",
}


class DuplicateDetectionService:
    """Creates reproducible possible duplicate-work candidate snapshots from MongoDB data."""

    def __init__(self, db: Database):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)
        self._evidence = db.get_collection(EVIDENCE_COLLECTION)
        self._scans = db.get_collection(SCANS_COLLECTION)
        self._matches = db.get_collection(MATCHES_COLLECTION)
        self._clusters = db.get_collection(CLUSTERS_COLLECTION)
        self._cases = db.get_collection(CASES_COLLECTION)
        self._audit = AuditService(db)

    async def ensure_indexes(self) -> None:
        """Create indexes for immutable scans, explorer queries, and optional GeoJSON data."""
        await self._scans.create_index("scan_id", unique=True)
        await self._scans.create_index("created_at")
        await self._matches.create_index("match_id", unique=True)
        await self._matches.create_index([("scan_id", 1), ("similarity_score", -1)])
        await self._matches.create_index([("left_work_id", 1), ("right_work_id", 1)])
        await self._matches.create_index("status")
        await self._clusters.create_index("cluster_id", unique=True)
        await self._clusters.create_index("scan_id")
        await self._cases.create_index("case_id", unique=True)
        await self._cases.create_index("match_id")
        # Optional: deployments that retain a GeoJSON ``location.geo`` field
        # may use it for proximity pre-filtering. Latitude/longitude-only work
        # records use the deterministic Haversine fallback below.
        await self._works.create_index([("location.geo", "2dsphere")])
        await self._evidence.create_index([("work_id", 1), ("file_hash", 1)])
        logger.info("Possible duplicate-work indexes ensured")

    async def scan(
        self,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
        rule: Optional[DuplicateDetectionRule] = None,
        created_by: str = "system",
        ip_address: str = "",
        user_agent: str = "",
    ) -> DuplicateDetectionScan:
        """Run a TF-IDF/cosine candidate scan and persist matches and clusters."""
        rule = rule or DuplicateDetectionRule()
        works = await self._load_works(jurisdiction_filter or {})
        evidence_by_work = await self._load_evidence_hashes([str(work.get("work_id", "")) for work in works])
        sorted_works = sorted(works, key=lambda item: str(item.get("work_id", "")))
        scan_id = str(uuid4())
        created_at = datetime.now(timezone.utc)

        text_pairs = _tfidf_pairs(sorted_works, rule.text_similarity_threshold)
        matches: list[DuplicateMatch] = []
        for left_index, right_index, text_similarity in text_pairs:
            left = sorted_works[left_index]
            right = sorted_works[right_index]
            match = _build_match(
                scan_id=scan_id,
                left=left,
                right=right,
                text_similarity=text_similarity,
                evidence_by_work=evidence_by_work,
                rule=rule,
                created_at=created_at,
            )
            if match:
                matches.append(match)

        matches.sort(key=lambda item: (-item.similarity_score, item.left_work_id, item.right_work_id))
        clusters = _build_clusters(scan_id, matches, created_at)
        scan = DuplicateDetectionScan(
            scan_id=scan_id,
            rule_snapshot=rule,
            works_evaluated=len(sorted_works),
            pairs_evaluated=(len(sorted_works) * max(len(sorted_works) - 1, 0)) // 2,
            matches_created=len(matches),
            clusters_created=len(clusters),
            created_at=created_at,
            created_by=created_by,
        )

        await self._scans.insert_one(scan.model_dump(mode="python"))
        for match in matches:
            await self._matches.insert_one(match.model_dump(mode="python"))
        for cluster in clusters:
            await self._clusters.insert_one(cluster.model_dump(mode="python"))
        await self._audit.log_event(
            AuditEventType.DUPLICATE_DETECTION_RUN,
            user_id=created_by,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="duplicate_detection_scan",
            resource_id=scan_id,
            details={
                "works_evaluated": scan.works_evaluated,
                "matches_created": scan.matches_created,
                "clusters_created": scan.clusters_created,
                "rule_version": rule.rule_version,
            },
        )
        return scan

    async def get_latest_scan(self) -> Optional[dict[str, Any]]:
        return await self._scans.find_one({}, {"_id": 0}, sort=[("created_at", -1), ("scan_id", 1)])

    async def list_matches(
        self,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
        status: Optional[DuplicateMatchStatus] = None,
        min_similarity_score: float = 0.0,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int, int, Optional[dict[str, Any]]]:
        """List latest-scan matches whose two works are inside the caller's scope."""
        scan = await self.get_latest_scan()
        if not scan:
            return [], 0, 1, None
        allowed_ids = await self._scoped_work_ids(jurisdiction_filter or {})
        if not allowed_ids:
            return [], 0, 1, scan
        query: dict[str, Any] = {"scan_id": scan["scan_id"]}
        if status:
            query["status"] = status.value
        matches = await self._matches.find(query, {"_id": 0}).sort(
            [("similarity_score", -1), ("match_id", 1)]
        ).to_list(length=None)
        visible = [
            match for match in matches
            if float(match.get("similarity_score", 0.0)) >= min_similarity_score
            and {str(match.get("left_work_id")), str(match.get("right_work_id"))}.issubset(allowed_ids)
        ]
        total = len(visible)
        total_pages = max(1, math.ceil(total / page_size))
        start = (page - 1) * page_size
        return visible[start:start + page_size], total, total_pages, scan

    async def list_clusters(
        self,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
    ) -> tuple[list[dict[str, Any]], Optional[dict[str, Any]]]:
        """List latest-scan clusters only when every clustered work is in scope."""
        scan = await self.get_latest_scan()
        if not scan:
            return [], None
        allowed_ids = await self._scoped_work_ids(jurisdiction_filter or {})
        clusters = await self._clusters.find(
            {"scan_id": scan["scan_id"]}, {"_id": 0}
        ).sort([("cluster_similarity_score", -1), ("cluster_id", 1)]).to_list(length=None)
        return [cluster for cluster in clusters if set(cluster.get("work_ids", [])).issubset(allowed_ids)], scan

    async def get_comparison(
        self,
        match_id: str,
        *,
        jurisdiction_filter: Optional[dict[str, Any]] = None,
    ) -> Optional[DuplicateComparisonResponse]:
        """Return a match plus both complete comparison summaries when scoped access allows it."""
        match = await self._matches.find_one({"match_id": match_id}, {"_id": 0})
        if not match:
            return None
        work_ids = [str(match["left_work_id"]), str(match["right_work_id"])]
        query = {**(jurisdiction_filter or {}), "work_id": {"$in": work_ids}}
        documents = await self._works.find(query, _work_projection()).to_list(length=None)
        by_id = {str(document.get("work_id")): document for document in documents}
        if set(work_ids) != set(by_id):
            return None
        existing_case = await self._cases.find_one({"match_id": match_id}, {"_id": 0}, sort=[("created_at", -1)])
        return DuplicateComparisonResponse(
            match=DuplicateMatch(**match),
            left_work=_work_summary(by_id[work_ids[0]]),
            right_work=_work_summary(by_id[work_ids[1]]),
            case_id=existing_case.get("case_id") if existing_case else None,
        )

    async def create_case(
        self,
        match_id: str,
        request: DuplicateCaseCreateRequest,
        *,
        created_by: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[DuplicateCaseResponse]:
        """Create an idempotent human-review case linked to a saved match."""
        match = await self._matches.find_one({"match_id": match_id}, {"_id": 0})
        if not match:
            return None
        existing = await self._cases.find_one({"match_id": match_id}, {"_id": 0}, sort=[("created_at", -1)])
        if existing:
            return DuplicateCaseResponse(**existing)
        now = datetime.now(timezone.utc)
        document = {
            "case_id": str(uuid4()),
            "match_id": match_id,
            "work_ids": [match["left_work_id"], match["right_work_id"]],
            "status": "open",
            "notes": request.notes,
            "assigned_to": request.assigned_to,
            "created_by": created_by,
            "created_at": now,
        }
        await self._cases.insert_one(document)
        await self._set_review_status(
            match_id,
            DuplicateMatchStatus.CASE_CREATED,
            reviewed_by=created_by,
            notes=request.notes,
            assigned_to=request.assigned_to,
        )
        await self._audit.log_event(
            AuditEventType.DUPLICATE_CASE_CREATED,
            user_id=created_by,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="duplicate_work_case",
            resource_id=document["case_id"],
            details={"match_id": match_id, "work_ids": document["work_ids"]},
        )
        return DuplicateCaseResponse(**document)

    async def mark_not_duplicate(
        self,
        match_id: str,
        request: DuplicateReviewRequest,
        *,
        reviewed_by: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[dict[str, Any]]:
        """Record a human decision that this possible match is not a duplicate."""
        match = await self._set_review_status(
            match_id,
            DuplicateMatchStatus.MARKED_NOT_DUPLICATE,
            reviewed_by=reviewed_by,
            notes=request.notes,
            assigned_to=request.assigned_to,
        )
        if not match:
            return None
        await self._audit.log_event(
            AuditEventType.DUPLICATE_MARKED_NOT_DUPLICATE,
            user_id=reviewed_by,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="duplicate_work_match",
            resource_id=match_id,
            details={"assigned_to": request.assigned_to, "notes_recorded": bool(request.notes)},
        )
        return match

    async def request_field_verification(
        self,
        match_id: str,
        request: DuplicateReviewRequest,
        *,
        requested_by: str,
        ip_address: str = "",
        user_agent: str = "",
    ) -> Optional[dict[str, Any]]:
        """Persist a request for field verification against a possible match."""
        match = await self._set_review_status(
            match_id,
            DuplicateMatchStatus.FIELD_VERIFICATION_REQUESTED,
            reviewed_by=requested_by,
            notes=request.notes,
            assigned_to=request.assigned_to,
        )
        if not match:
            return None
        await self._audit.log_event(
            AuditEventType.DUPLICATE_FIELD_VERIFICATION_REQUESTED,
            user_id=requested_by,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type="duplicate_work_match",
            resource_id=match_id,
            details={"assigned_to": request.assigned_to, "notes_recorded": bool(request.notes)},
        )
        return match

    async def _set_review_status(
        self,
        match_id: str,
        status: DuplicateMatchStatus,
        *,
        reviewed_by: str,
        notes: str,
        assigned_to: str,
    ) -> Optional[dict[str, Any]]:
        result = await self._matches.update_one(
            {"match_id": match_id},
            {"$set": {
                "status": status.value,
                "reviewed_by": reviewed_by,
                "reviewed_at": datetime.now(timezone.utc),
                "review_notes": notes,
                "assigned_to": assigned_to,
            }},
        )
        if not getattr(result, "matched_count", 0):
            return None
        return await self._matches.find_one({"match_id": match_id}, {"_id": 0})

    async def _load_works(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._works.find(query, _work_projection()).sort(
            [("work_id", 1)]
        ).to_list(length=None)

    async def _scoped_work_ids(self, jurisdiction_filter: dict[str, Any]) -> set[str]:
        documents = await self._works.find(
            jurisdiction_filter, {"_id": 0, "work_id": 1}
        ).to_list(length=None)
        return {str(document["work_id"]) for document in documents if document.get("work_id")}

    async def _load_evidence_hashes(self, work_ids: list[str]) -> dict[str, set[str]]:
        if not work_ids:
            return {}
        documents = await self._evidence.find(
            {"work_id": {"$in": work_ids}, "evidence_type": "site_photo"},
            {"_id": 0, "work_id": 1, "file_hash": 1},
        ).to_list(length=None)
        hashes: dict[str, set[str]] = defaultdict(set)
        for document in documents:
            work_id = str(document.get("work_id", ""))
            file_hash = str(document.get("file_hash", ""))
            if work_id and file_hash:
                hashes[work_id].add(file_hash)
        return hashes


def _work_projection() -> dict[str, int]:
    return {
        "_id": 0,
        "work_id": 1,
        "title": 1,
        "description": 1,
        "category": 1,
        "sub_category": 1,
        "status": 1,
        "state_name": 1,
        "district_name": 1,
        "implementing_agency": 1,
        "vendor_name": 1,
        "vendor": 1,
        "contractor": 1,
        "sanctioned_amount": 1,
        "funds_released": 1,
        "actual_expenditure": 1,
        "physical_progress_pct": 1,
        "recommended_date": 1,
        "sanctioned_date": 1,
        "start_date": 1,
        "expected_completion_date": 1,
        "actual_completion_date": 1,
        "location": 1,
    }


def _tfidf_pairs(works: list[dict[str, Any]], threshold: float) -> list[tuple[int, int, float]]:
    """Return deterministic TF-IDF/cosine candidate pairs at or above threshold."""
    if len(works) < 2:
        return []
    documents = [_text_document(work) for work in works]
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity

        matrix = TfidfVectorizer(
            lowercase=True,
            strip_accents="unicode",
            stop_words="english",
            ngram_range=(1, 2),
            norm="l2",
        ).fit_transform(documents)
        similarity_matrix = cosine_similarity(matrix, dense_output=False)
    except ValueError:
        return []

    pairs: list[tuple[int, int, float]] = []
    for index in range(len(works)):
        row = similarity_matrix.getrow(index)
        for compared_index, similarity in zip(row.indices, row.data):
            if compared_index <= index or float(similarity) < threshold:
                continue
            pairs.append((index, int(compared_index), round(float(similarity), 8)))
    return pairs


def _text_document(work: dict[str, Any]) -> str:
    return " ".join(
        str(work.get(field, "") or "")
        for field in ("title", "description", "sub_category", "category")
    )


def _build_match(
    *,
    scan_id: str,
    left: dict[str, Any],
    right: dict[str, Any],
    text_similarity: float,
    evidence_by_work: dict[str, set[str]],
    rule: DuplicateDetectionRule,
    created_at: datetime,
) -> Optional[DuplicateMatch]:
    category_similarity, category_relationship = _category_relationship(left, right)
    distance_meters = _haversine_distance(left.get("location"), right.get("location"))
    cost_difference_pct = _cost_difference_pct(left.get("sanctioned_amount"), right.get("sanctioned_amount"))
    timeline_overlap, overlap_days, same_financial_year = _timeline_relationship(left, right)
    agency_vendor_relationship = _agency_vendor_relationship(left, right)
    evidence_similarity, evidence_relationship = _evidence_relationship(
        evidence_by_work.get(str(left.get("work_id", "")), set()),
        evidence_by_work.get(str(right.get("work_id", "")), set()),
    )

    category_ok = category_similarity >= 0.7 if rule.require_same_or_similar_category else True
    distance_ok = distance_meters is not None and distance_meters <= rule.distance_threshold_meters
    cost_ok = cost_difference_pct is not None and cost_difference_pct <= rule.comparable_cost_range_pct
    timeline_ok = (timeline_overlap or same_financial_year) if rule.require_timeline_overlap_or_same_financial_year else True
    if not (text_similarity >= rule.text_similarity_threshold and category_ok and distance_ok and cost_ok and timeline_ok):
        return None

    distance_component = max(0.0, 1.0 - (distance_meters / rule.distance_threshold_meters))
    cost_component = max(0.0, 1.0 - (cost_difference_pct / rule.comparable_cost_range_pct)) if rule.comparable_cost_range_pct else 1.0
    timeline_component = 1.0 if timeline_overlap else 0.7
    agency_component = 1.0 if agency_vendor_relationship != "No agency or vendor relationship recorded" else 0.0
    evidence_component = evidence_similarity or 0.0
    similarity_score = 100.0 * (
        0.45 * text_similarity
        + 0.15 * distance_component
        + 0.10 * category_similarity
        + 0.10 * cost_component
        + 0.10 * timeline_component
        + 0.05 * agency_component
        + 0.05 * evidence_component
    )
    signals = [
        f"TF-IDF/cosine text similarity {text_similarity:.2f} meets the {rule.text_similarity_threshold:.2f} threshold.",
        f"Distance {distance_meters:.1f}m is within {rule.distance_threshold_meters:.0f}m ({category_relationship.lower()} category).",
        f"Sanctioned-cost difference {cost_difference_pct:.1f}% is within the {rule.comparable_cost_range_pct:.1f}% comparable range.",
        "Timelines overlap." if timeline_overlap else "Works fall in the same financial year.",
    ]
    if agency_component:
        signals.append(agency_vendor_relationship)
    if evidence_similarity is not None:
        signals.append(evidence_relationship)

    return DuplicateMatch(
        match_id=str(uuid4()),
        scan_id=scan_id,
        left_work_id=str(left.get("work_id", "")),
        right_work_id=str(right.get("work_id", "")),
        left_work_title=str(left.get("title", "") or ""),
        right_work_title=str(right.get("title", "") or ""),
        similarity_score=round(min(100.0, similarity_score), 2),
        text_similarity=round(text_similarity, 6),
        distance_meters=round(distance_meters, 2),
        distance_method="haversine_fallback",
        category_similarity=round(category_similarity, 2),
        category_relationship=category_relationship,
        cost_difference_pct=round(cost_difference_pct, 2),
        comparable_cost_range=True,
        timeline_overlap=timeline_overlap,
        timeline_overlap_days=overlap_days,
        same_financial_year=same_financial_year,
        agency_vendor_relationship=agency_vendor_relationship,
        evidence_photo_similarity=round(evidence_similarity, 4) if evidence_similarity is not None else None,
        evidence_photo_relationship=evidence_relationship,
        matching_signals=signals,
        rule_snapshot=rule,
        created_at=created_at,
    )


def _category_relationship(left: dict[str, Any], right: dict[str, Any]) -> tuple[float, str]:
    left_category = str(left.get("category", "other") or "other")
    right_category = str(right.get("category", "other") or "other")
    if left_category == right_category:
        return 1.0, "Same category"
    if CATEGORY_FAMILIES.get(left_category) and CATEGORY_FAMILIES.get(left_category) == CATEGORY_FAMILIES.get(right_category):
        return 0.7, "Similar category family"
    return 0.0, "Different category"


def _haversine_distance(left_location: Any, right_location: Any) -> Optional[float]:
    left_coordinates = _coordinates(left_location)
    right_coordinates = _coordinates(right_location)
    if not left_coordinates or not right_coordinates:
        return None
    left_lat, left_lon = left_coordinates
    right_lat, right_lon = right_coordinates
    radius_m = 6_371_000.0
    phi_1, phi_2 = math.radians(left_lat), math.radians(right_lat)
    delta_phi, delta_lambda = math.radians(right_lat - left_lat), math.radians(right_lon - left_lon)
    value = math.sin(delta_phi / 2) ** 2 + math.cos(phi_1) * math.cos(phi_2) * math.sin(delta_lambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _coordinates(location: Any) -> Optional[tuple[float, float]]:
    if not isinstance(location, dict):
        return None
    try:
        latitude = float(location.get("latitude"))
        longitude = float(location.get("longitude"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    return latitude, longitude


def _cost_difference_pct(left_amount: Any, right_amount: Any) -> Optional[float]:
    left = _positive_number(left_amount)
    right = _positive_number(right_amount)
    if left is None or right is None:
        return None
    return abs(left - right) / max(left, right) * 100.0


def _timeline_relationship(left: dict[str, Any], right: dict[str, Any]) -> tuple[bool, Optional[int], bool]:
    left_start, left_end = _timeline_bounds(left)
    right_start, right_end = _timeline_bounds(right)
    same_financial_year = bool(
        left_start and right_start and _financial_year(left_start) == _financial_year(right_start)
    )
    if not (left_start and left_end and right_start and right_end):
        return False, None, same_financial_year
    overlap_days = (min(left_end, right_end) - max(left_start, right_start)).days + 1
    return overlap_days > 0, max(0, overlap_days), same_financial_year


def _timeline_bounds(work: dict[str, Any]) -> tuple[Optional[datetime], Optional[datetime]]:
    start = _as_datetime(work.get("start_date")) or _as_datetime(work.get("sanctioned_date")) or _as_datetime(work.get("recommended_date"))
    end = _as_datetime(work.get("actual_completion_date")) or _as_datetime(work.get("expected_completion_date")) or start
    return start, end


def _financial_year(timestamp: datetime) -> int:
    return timestamp.year if timestamp.month >= 4 else timestamp.year - 1


def _agency_vendor_relationship(left: dict[str, Any], right: dict[str, Any]) -> str:
    left_agency = _normalise(left.get("implementing_agency"))
    right_agency = _normalise(right.get("implementing_agency"))
    left_vendor = _normalise(left.get("vendor_name") or left.get("vendor") or left.get("contractor"))
    right_vendor = _normalise(right.get("vendor_name") or right.get("vendor") or right.get("contractor"))
    if left_vendor and left_vendor == right_vendor:
        return "Same vendor/contractor"
    if left_agency and left_agency == right_agency:
        return "Same implementing agency"
    return "No agency or vendor relationship recorded"


def _evidence_relationship(left_hashes: set[str], right_hashes: set[str]) -> tuple[Optional[float], str]:
    if not left_hashes or not right_hashes:
        return None, "No comparable evidence-photo hashes available"
    shared = left_hashes & right_hashes
    similarity = len(shared) / len(left_hashes | right_hashes)
    if shared:
        return similarity, f"{len(shared)} shared evidence-photo hash(es)"
    return 0.0, "Evidence-photo hashes are distinct"


def _build_clusters(scan_id: str, matches: list[DuplicateMatch], created_at: datetime) -> list[DuplicateCluster]:
    parent: dict[str, str] = {}

    def find(work_id: str) -> str:
        parent.setdefault(work_id, work_id)
        if parent[work_id] != work_id:
            parent[work_id] = find(parent[work_id])
        return parent[work_id]

    def join(left: str, right: str) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for match in matches:
        join(match.left_work_id, match.right_work_id)

    grouped_work_ids: dict[str, set[str]] = defaultdict(set)
    grouped_matches: dict[str, list[DuplicateMatch]] = defaultdict(list)
    for match in matches:
        root = find(match.left_work_id)
        grouped_work_ids[root].update((match.left_work_id, match.right_work_id))
        grouped_matches[root].append(match)

    clusters = []
    for root in sorted(grouped_work_ids):
        group_matches = grouped_matches[root]
        clusters.append(DuplicateCluster(
            cluster_id=str(uuid4()),
            scan_id=scan_id,
            work_ids=sorted(grouped_work_ids[root]),
            match_ids=sorted(match.match_id for match in group_matches),
            cluster_similarity_score=round(sum(match.similarity_score for match in group_matches) / len(group_matches), 2),
            created_at=created_at,
        ))
    return sorted(clusters, key=lambda cluster: (-cluster.cluster_similarity_score, cluster.cluster_id))


def _work_summary(work: dict[str, Any]) -> DuplicateWorkSummary:
    location = work.get("location") if isinstance(work.get("location"), dict) else {}
    return DuplicateWorkSummary(
        work_id=str(work.get("work_id", "")),
        title=str(work.get("title", "Untitled work")),
        description=str(work.get("description", "") or ""),
        category=str(work.get("category", "other") or "other"),
        sub_category=str(work.get("sub_category", "") or ""),
        status=str(work.get("status", "") or ""),
        state_name=str(work.get("state_name", "") or ""),
        district_name=str(work.get("district_name", "") or ""),
        implementing_agency=str(work.get("implementing_agency", "") or ""),
        vendor_name=str(work.get("vendor_name") or work.get("vendor") or work.get("contractor") or ""),
        sanctioned_amount=_number(work.get("sanctioned_amount")),
        funds_released=_number(work.get("funds_released")),
        actual_expenditure=_number(work.get("actual_expenditure")),
        physical_progress_pct=_number(work.get("physical_progress_pct")),
        recommended_date=_as_datetime(work.get("recommended_date")),
        sanctioned_date=_as_datetime(work.get("sanctioned_date")),
        start_date=_as_datetime(work.get("start_date")),
        expected_completion_date=_as_datetime(work.get("expected_completion_date")),
        location_latitude=_number_or_none(location.get("latitude")),
        location_longitude=_number_or_none(location.get("longitude")),
        location_address=str(location.get("address", "") or ""),
    )


def _number(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _number_or_none(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _positive_number(value: Any) -> Optional[float]:
    parsed = _number_or_none(value)
    return parsed if parsed is not None and parsed > 0 else None


def _normalise(value: Any) -> str:
    return " ".join(str(value or "").lower().split())


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
