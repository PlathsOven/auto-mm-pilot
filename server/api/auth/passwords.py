"""
Password hashing helpers — bcrypt via passlib.

Cost factor is pulled from ``BCRYPT_ROUNDS`` in ``server.api.config``.
"""

from __future__ import annotations

from passlib.context import CryptContext

from server.api.config import BCRYPT_ROUNDS

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=BCRYPT_ROUNDS)


def hash_password(plain: str) -> str:
    """Return the bcrypt hash of a plaintext password."""
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash."""
    return _pwd_context.verify(plain, hashed)
