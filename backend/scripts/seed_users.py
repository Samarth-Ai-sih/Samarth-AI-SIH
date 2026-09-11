"""
SAMARTH AI — Demo User Seeder

Seeds 8 demo users (one per role) into the `users` collection.
Credentials are read from environment variables — never embedded in source.

Usage:
    cd backend
    python -m scripts.seed_users

Features:
    - Idempotent: skips existing emails
    - must_change_password=True by default (configurable)
    - Fails closed when a required seed credential is absent
"""

import asyncio
import logging
import os
import sys

# Ensure the backend directory is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.config import get_settings
from app.core.database import Database
from app.core.security import hash_password
from app.models.user import JurisdictionScope, UserCreateRequest, UserRole

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("samarth.seed")


def _required_env(key: str, settings=None) -> str:
    """Read a credential from process env or the configured local env file."""
    value = os.environ.get(key, "").strip()
    if not value and settings is not None:
        value = str(getattr(settings, key, "") or "").strip()
    if not value:
        raise RuntimeError(f"Missing required seed environment variable: {key}")
    return value


def _seed_username(base: str) -> str:
    """Optionally namespace a demo user without changing existing accounts."""
    suffix = os.environ.get("SEED_USERNAME_SUFFIX", "").strip().lower()
    return f"{base}.{suffix}" if suffix else base


def get_seed_users(force_pw_change: bool, settings=None) -> list[dict]:
    """
    Build the list of seed users. Passwords are read from environment
    variables. Values must be supplied in every environment so credentials
    cannot be accidentally promoted from a development default.
    """
    raw_users = [
        {
            "email": _required_env("SEED_ADMIN_EMAIL", settings),
            "username": _seed_username("admin"),
            "full_name": "System Administrator",
            "password": _required_env("SEED_ADMIN_PASSWORD", settings),
            "role": UserRole.ADMIN,
            "jurisdiction": JurisdictionScope(),
        },
        {
            "email": _required_env("SEED_MOSPI_EMAIL", settings),
            "username": _seed_username("mospi.officer"),
            "full_name": "MoSPI Officer",
            "password": _required_env("SEED_MOSPI_PASSWORD", settings),
            "role": UserRole.MOSPI,
            "jurisdiction": JurisdictionScope(),
        },
        {
            "email": _required_env("SEED_SNO_EMAIL", settings),
            "username": _seed_username("sno.up"),
            "full_name": "State Nodal Officer (Uttar Pradesh)",
            "password": _required_env("SEED_SNO_PASSWORD", settings),
            "role": UserRole.STATE_NODAL_OFFICER,
            "jurisdiction": JurisdictionScope(state_code="UP"),
        },
        {
            "email": _required_env("SEED_DA_EMAIL", settings),
            "username": _seed_username("da.lucknow"),
            "full_name": "District Authority (Lucknow)",
            "password": _required_env("SEED_DA_PASSWORD", settings),
            "role": UserRole.DISTRICT_AUTHORITY,
            "jurisdiction": JurisdictionScope(
                state_code="UP", district_code="UP-LKO"
            ),
        },
        {
            "email": _required_env("SEED_INSPECTOR_EMAIL", settings),
            "username": _seed_username("inspector.lucknow"),
            "full_name": "Field Inspector (Lucknow)",
            "password": _required_env("SEED_INSPECTOR_PASSWORD", settings),
            "role": UserRole.INSPECTOR,
            "jurisdiction": JurisdictionScope(
                state_code="UP",
                district_code="UP-LKO",
                assigned_task_ids=["TASK-001", "TASK-002"],
            ),
        },
        {
            "email": _required_env("SEED_MP_EMAIL", settings),
            "username": _seed_username("mp.varanasi"),
            "full_name": "Member of Parliament (Varanasi)",
            "password": _required_env("SEED_MP_PASSWORD", settings),
            "role": UserRole.MP,
            "jurisdiction": JurisdictionScope(
                state_code="UP", constituency="VARANASI"
            ),
        },
        {
            "email": _required_env("SEED_AGENCY_EMAIL", settings),
            "username": _seed_username("agency.delhi"),
            "full_name": "Implementing Agency (Delhi)",
            "password": _required_env("SEED_AGENCY_PASSWORD", settings),
            "role": UserRole.AGENCY,
            "jurisdiction": JurisdictionScope(
                state_code="DL", district_code="CENTRAL_DELHI"
            ),
        },
        {
            "email": _required_env("SEED_CITIZEN_EMAIL", settings),
            "username": _seed_username("citizen.user"),
            "full_name": "Citizen User",
            "password": _required_env("SEED_CITIZEN_PASSWORD", settings),
            "role": UserRole.CITIZEN,
            "jurisdiction": JurisdictionScope(),
        },
    ]
    try:
        return [UserCreateRequest(**user, must_change_password=force_pw_change).model_dump() for user in raw_users]
    except ValueError as exc:
        raise RuntimeError(f"Invalid seed user configuration: {exc}") from exc


async def seed_users() -> None:
    """Main seeder function."""
    settings = get_settings()

    force_pw_change = settings.SEED_FORCE_PASSWORD_CHANGE
    try:
        users_to_seed = get_seed_users(force_pw_change, settings=settings)
    except RuntimeError as exc:
        logger.error("Seed users aborted: %s", exc)
        sys.exit(1)

    logger.info("Connecting to configured MongoDB...")
    db = Database(settings)
    await db.connect()

    users_col = db.get_collection("users")
    created = 0
    skipped = 0

    # Preflight username collisions before inserting anything. Email collisions
    # remain idempotent skips, but reusing a username for a different address
    # would otherwise fail after earlier records had already been created.
    username_collisions = []
    existing_emails = set()
    for user_data in users_to_seed:
        email = user_data["email"]
        existing_email = await users_col.find_one(
            {"email": {"$regex": f"^{email}$", "$options": "i"}}
        )
        if existing_email:
            existing_emails.add(email.lower())
            continue
        existing_username = await users_col.find_one({"username": user_data["username"]})
        if existing_username:
            username_collisions.append(user_data["username"])

    if username_collisions:
        raise RuntimeError(
            "Username collision(s): " + ", ".join(username_collisions)
            + ". Set SEED_USERNAME_SUFFIX to create a separate demo account set."
        )

    for user_data in users_to_seed:
        email = user_data["email"]

        # Check if user already exists (idempotent)
        if email.lower() in existing_emails:
            logger.info("  ⏭  %s (%s) — already exists, skipping", email, user_data["role"].value)
            skipped += 1
            continue

        from uuid import uuid4
        from datetime import datetime, timezone

        doc = {
            "user_id": str(uuid4()),
            "email": email.lower(),
            "username": user_data["username"],
            "full_name": user_data["full_name"],
            "hashed_password": hash_password(user_data["password"]),
            "role": user_data["role"].value,
            # ``get_seed_users`` returns Pydantic's serialised dict, so this
            # value is already JSON-safe and must not be serialised again.
            "jurisdiction": user_data["jurisdiction"],
            "is_active": True,
            "must_change_password": force_pw_change,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "last_login": None,
        }

        await users_col.insert_one(doc)
        logger.info(
            "  ✅ %s (%s) — created%s",
            email,
            user_data["role"].value,
            " [must change password]" if force_pw_change else "",
        )
        created += 1

    # Ensure indexes
    await users_col.create_index("user_id", unique=True)
    await users_col.create_index("email", unique=True)
    await users_col.create_index("username", unique=True)
    await users_col.create_index("role")

    logger.info(
        "\nSeed complete: %d created, %d skipped (already existed)",
        created, skipped,
    )

    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(seed_users())
