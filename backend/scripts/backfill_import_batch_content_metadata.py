"""Audit or explicitly backfill canonical staged-payload hashes for old batches.

New uploads persist a SHA-256 of their original byte stream. Historical batch
records only retain decoded ``raw_content`` and may have lost a UTF-8 BOM, so
this utility intentionally writes *stored_content_* fields instead of claiming
to reconstruct an original upload hash. It is dry-run by default.

Usage (from ``backend``)::

    python scripts/backfill_import_batch_content_metadata.py
    python scripts/backfill_import_batch_content_metadata.py --apply
"""

import argparse
import asyncio
import hashlib
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def staged_payload_metadata(raw_content: str | bytes) -> dict[str, int | str]:
    """Hash the exact canonical payload retained by a historical batch."""
    payload = raw_content.encode("utf-8") if isinstance(raw_content, str) else raw_content
    return {
        "stored_content_sha256": hashlib.sha256(payload).hexdigest(),
        "stored_content_size_bytes": len(payload),
        "stored_content_encoding": "utf-8",
    }


async def run(apply: bool = False) -> tuple[int, int]:
    from app.core.config import get_settings
    from app.core.database import Database

    db = Database(get_settings())
    await db.connect()
    try:
        batches = db.get_collection("import_batches")
        query: dict[str, Any] = {
            "$or": [
                {"stored_content_sha256": {"$exists": False}},
                {"stored_content_size_bytes": {"$exists": False}},
            ]
        }
        cursor = batches.find(query, {"_id": 0, "batch_id": 1, "raw_content": 1})
        candidates = []
        async for item in cursor:
            candidates.append(item)
        updated = 0
        for batch in candidates:
            raw_content = batch.get("raw_content")
            if not isinstance(raw_content, (str, bytes)):
                print(f"[SKIP] {batch.get('batch_id')}: staged content is unavailable")
                continue
            metadata = staged_payload_metadata(raw_content)
            if apply:
                await batches.update_one(
                    {"batch_id": batch["batch_id"]},
                    {"$set": {**metadata, "source_metadata_status": "canonical_payload_backfill"}},
                )
                updated += 1
            print(
                f"[{'APPLY' if apply else 'DRY RUN'}] {batch['batch_id']}: "
                f"{metadata['stored_content_size_bytes']} canonical bytes"
            )
        return len(candidates), updated
    finally:
        await db.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Persist metadata (default is dry-run).")
    args = parser.parse_args()
    candidates, updated = asyncio.run(run(apply=args.apply))
    mode = "apply" if args.apply else "dry-run"
    print(f"Candidates: {candidates}; updated: {updated}; mode: {mode}")


if __name__ == "__main__":
    main()
