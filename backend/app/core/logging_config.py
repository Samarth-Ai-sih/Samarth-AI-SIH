"""
SAMARTH AI — Structured JSON Logging

Configures structured JSON logging for production
and human-readable logging for development.
"""

import logging
import sys
from typing import Optional

from pythonjsonlogger.json import JsonFormatter

from app.core.config import Settings


def setup_logging(settings: Optional[Settings] = None) -> None:
    """
    Configure application-wide structured logging.

    - JSON format for staging/production (machine-parseable, Sentry-compatible)
    - Human-readable format for development
    """
    log_level = getattr(settings, "LOG_LEVEL", "INFO") if settings else "INFO"
    log_format = getattr(settings, "LOG_FORMAT", "json") if settings else "json"

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Clear existing handlers
    root_logger.handlers.clear()

    # Console handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    if log_format == "json":
        formatter = JsonFormatter(
            fmt="%(asctime)s %(name)s %(levelname)s %(message)s",
            rename_fields={
                "asctime": "timestamp",
                "name": "logger",
                "levelname": "level",
            },
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    else:
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Quiet noisy third-party loggers
    for noisy_logger in ["uvicorn.access", "uvicorn.error", "motor", "pymongo"]:
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)

    # App logger at configured level
    logging.getLogger("samarth").setLevel(log_level)

    logging.getLogger("samarth.startup").info(
        "Logging configured",
        extra={"level": log_level, "format": log_format},
    )
