"""
SAMARTH AI — Security Utilities

- bcrypt password hashing (via passlib)
- Lean JWT tokens (sub + sid only; role/jurisdiction loaded from DB)
- Cryptographic refresh token generation
- SHA-256 token hashing for secure storage
- CSRF token generation
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

logger = logging.getLogger("samarth.security")

# bcrypt context — passlib handles salt generation and work factor
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
MAX_BCRYPT_PASSWORD_BYTES = 72


# ── Password Hashing ────────────────────────────────────────────


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    if len(password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        raise ValueError("Password is too long")
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against its bcrypt hash."""
    if len(plain_password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        return False
    return pwd_context.verify(plain_password, hashed_password)


# ── JWT Token Management ────────────────────────────────────────


def create_access_token(user_id: str, session_id: str) -> tuple[str, int]:
    """
    Create a lean access token containing only:
    - sub: user_id (identity)
    - sid: session_id (session binding)
    - exp, iat, type

    Role and jurisdiction are NOT embedded — they are loaded fresh
    from MongoDB on every authenticated request.

    Returns (token_string, expires_in_seconds).
    """
    settings = get_settings()
    expires_delta = timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    now = datetime.now(timezone.utc)
    expire = now + expires_delta

    payload = {
        "sub": user_id,
        "sid": session_id,
        "exp": expire,
        "iat": now,
        "type": "access",
    }

    token = jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> dict:
    """
    Decode and validate a JWT access token.

    Raises ValueError if the token is invalid, expired, or not an access token.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as exc:
        raise ValueError(f"Invalid token: {exc}")

    if payload.get("type") != "access":
        raise ValueError("Not an access token")

    if not payload.get("sub") or not payload.get("sid"):
        raise ValueError("Token missing required claims")

    return payload


# ── Refresh Token ────────────────────────────────────────────────


def create_refresh_token() -> str:
    """Generate a cryptographically random refresh token (86 chars)."""
    return secrets.token_urlsafe(64)


def hash_token(token: str) -> str:
    """SHA-256 hash a token for secure storage (never store raw)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── CSRF Token ───────────────────────────────────────────────────


def generate_csrf_token() -> str:
    """Generate a cryptographically random CSRF token."""
    return secrets.token_urlsafe(32)
