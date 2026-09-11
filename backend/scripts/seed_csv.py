"""
SAMARTH AI — CSV Seed Script

Imports both MPLADS allocation CSV files into MongoDB Atlas.

Usage:
    cd backend
    python scripts/seed_csv.py

This script:
  1. Connects to MongoDB Atlas using settings from .env
  2. Ensures required indexes
  3. Uploads, validates, and imports both CSV files
  4. Reports results and collection statistics
  5. Is idempotent — safe to run multiple times
"""

import asyncio
import os
import sys
from pathlib import Path

# Add backend root to path so we can import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("PYTHONIOENCODING", "utf-8")


async def main():
    from app.core.config import get_settings
    from app.core.database import Database
    from app.services.ingestion import IngestionService

    settings = get_settings()

    print("=" * 60)
    print("SAMARTH AI — CSV Seed Import")
    print("=" * 60)
    print(f"Environment: {settings.ENVIRONMENT.value}")
    print(f"Database:    {settings.MONGODB_DB_NAME}")
    print()

    # Connect to MongoDB
    db = Database(settings)
    await db.connect()
    print("[OK] Connected to MongoDB Atlas")

    svc = IngestionService(db)
    await svc.ensure_indexes()
    print("[OK] Indexes ensured")
    print()

    # Locate CSV files
    data_dir = Path(__file__).resolve().parent.parent.parent / "data"
    csv_files = [
        ("Allocated Limit for Honble MPs (1).csv", "Lok Sabha"),
        ("Allocated Limit for Honble MPs (2).csv", "Rajya Sabha"),
    ]

    for csv_filename, label in csv_files:
        csv_path = data_dir / csv_filename
        if not csv_path.exists():
            print(f"[SKIP] {csv_filename} not found at {csv_path}")
            continue

        print(f"{'─' * 60}")
        print(f"Importing: {csv_filename} ({label})")
        print(f"{'─' * 60}")

        content = csv_path.read_bytes()

        # Step 1: Upload
        batch = await svc.upload_csv(csv_filename, content, user_id="seed_script")
        batch_id = batch["batch_id"]
        print(f"  [1/3] Uploaded: {batch['total_rows']} rows, "
              f"type={batch['file_type']}")
        print(f"        Columns: {batch['column_mapping']}")

        # Step 2: Validate
        validation = await svc.validate_batch(batch_id)
        print(f"  [2/3] Validated: {validation['valid_rows']} valid, "
              f"{validation['invalid_rows']} invalid")
        if validation["errors"]:
            print(f"        Errors ({len(validation['errors'])}):")
            for err in validation["errors"][:5]:
                print(f"          Row {err['row_number']}: "
                      f"{err['column']} = '{err['value']}' — {err['error']}")
            if len(validation["errors"]) > 5:
                print(f"          ... and {len(validation['errors']) - 5} more")

        # Step 3: Import
        result = await svc.import_batch(batch_id)
        print(f"  [3/3] Imported: {result['imported_rows']} new, "
              f"{result['skipped_duplicate_rows']} duplicates skipped")
        print(f"        Status: {result['status']}")
        if result["import_errors"]:
            print(f"        Import errors: {len(result['import_errors'])}")
        print()

    # Final stats
    stats = await svc.get_collection_stats()
    print("=" * 60)
    print("Collection Statistics")
    print("=" * 60)
    for col_name, count in stats.items():
        print(f"  {col_name:20s}: {count:>6d} documents")
    print()

    # Sample data
    print("Sample MPs (first 5):")
    cursor = db.get_collection("mps").find({}, {"_id": 0, "name": 1, "house": 1, "state_name": 1}).limit(5)
    async for mp in cursor:
        print(f"  {mp['name']:40s} | {mp['house']:12s} | {mp['state_name']}")

    print()
    print("Sample States (first 5):")
    cursor = db.get_collection("states").find({}, {"_id": 0, "name": 1, "name_variants": 1}).limit(5)
    async for state in cursor:
        print(f"  {state['name']:40s} | variants: {state.get('name_variants', [])}")

    await db.disconnect()
    print()
    print("[OK] Seed complete!")


if __name__ == "__main__":
    asyncio.run(main())
