"""
SAMARTH AI — Data Import Script

Imports the Lok Sabha and Rajya Sabha CSV files using IngestionService.

Usage:
    cd backend
    python -m scripts.seed_data
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

# Ensure the backend app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_settings
from app.core.database import Database
from app.services.ingestion import IngestionService

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("samarth.seed_data")

async def import_file(ingestion: IngestionService, filepath: Path, filename: str) -> None:
    if not filepath.exists():
        logger.error(f"File not found: {filepath}")
        return

    logger.info(f"\nProcessing {filename}...")
    try:
        with open(filepath, "rb") as f:
            content = f.read()

        # 1. Upload
        batch = await ingestion.upload_csv(filename, content)
        batch_id = batch["batch_id"]
        logger.info(f"  Uploaded. Batch ID: {batch_id}, File Type: {batch['file_type']}, Rows: {batch['total_rows']}")
        
        # 2. Validate
        logger.info("  Validating...")
        validation_result = await ingestion.validate_batch(batch_id)
        logger.info(f"  Validated: {validation_result['valid_rows']} valid, {validation_result['invalid_rows']} invalid rows.")

        # 3. Import
        logger.info("  Importing...")
        if validation_result['valid_rows'] > 0:
            import_result = await ingestion.import_batch(batch_id)
            logger.info(f"  Import Status: {import_result['status']}")
            logger.info(f"  Imported: {import_result.get('imported_rows', 0)} rows")
            logger.info(f"  Skipped Duplicates: {import_result.get('skipped_duplicate_rows', 0)} rows")
            if import_result.get('import_errors'):
                logger.error(f"  Import Errors: {len(import_result['import_errors'])}")
        else:
            logger.warning("  No valid rows to import.")

    except Exception as e:
        logger.error(f"Failed to process {filename}: {e}", exc_info=True)


async def main():
    settings = get_settings()
    db = Database(settings)
    await db.connect()

    ingestion = IngestionService(db)
    
    # Ensure indexes before processing
    await ingestion.ensure_indexes()
    
    base_dir = Path(__file__).resolve().parent.parent.parent
    data_dir = base_dir / "data"
    
    file1 = data_dir / "Allocated Limit for Honble MPs (1).csv"
    file2 = data_dir / "Allocated Limit for Honble MPs (2).csv"
    
    await import_file(ingestion, file1, "Allocated Limit for Honble MPs (1).csv")
    await import_file(ingestion, file2, "Allocated Limit for Honble MPs (2).csv")
    
    await db.disconnect()
    logger.info("\nData import completed.")

if __name__ == "__main__":
    asyncio.run(main())
