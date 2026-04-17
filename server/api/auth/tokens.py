"""
Opaque-token helpers + per-request user resolution.

- ``generate_session_token`` / ``generate_api_key`` mint 32-byte URL-safe tokens.
- ``resolve_user_from_request`` walks the spec's lookup order (session →
  API key header → API key query) and returns the matching ``User`` or None.

All lookups are cached in a small LRU keyed by token string to keep the
cost to ≤ 5ms p95 even under heavy request loads. The cache is invalidated
explicitly on logout + API key regeneration.
"""

from __future__ import annotations

import logging
import secrets
import threading
from collections import OrderedDict
from datetime import datetime

from fastapi import Request
from sqlalchemy import select

from server.api.auth.models import ApiKey, Session, User
from server.api.db import SessionLocal

log = logging.getLogger(__name__)

TOKEN_BYTES = 32


def generate_session_token() -> str:
    """Mint a fresh opaque 32-byte URL-safe session token."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def generate_api_key() -> str:
    """Mint a fresh opaque 32-byte URL-safe API key."""
    return secrets.token_urlsafe(TOKEN_BYTES)


# ---------------------------------------------------------------------------
# Token → user_id LRU
# ---------------------------------------------------------------------------

_CACHE_MAX = 1024


class _TokenCache:
    """Tiny thread-safe LRU. Keeps (user_id, expires_at) per token."""

    def __init__(self, maxsize: int = _CACHE_MAX) -> None:
        self._maxsize = maxsize
        self._data: OrderedDict[str, tuple[str, datetime | None]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, token: str) -> tuple[str, datetime | None] | None:
        with self._lock:
            entry = self._data.get(token)
            if entry is None:
                return None
            self._data.move_to_end(token)
            return entry

    def put(self, token: str, user_id: str, expires_at: datetime | None) -> None:
        with self._lock:
            self._data[token] = (user_id, expires_at)
            self._data.move_to_end(token)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def invalidate(self, token: str) -> None:
        with self._lock:
            self._data.pop(token, None)

    def invalidate_user(self, user_id: str) -> None:
        """Drop every cache entry belonging to a user (on key rotation / logout-all)."""
        with self._lock:
            stale = [t for t, (uid, _) in self._data.items() if uid == user_id]
            for t in stale:
                self._data.pop(t, None)


_session_cache = _TokenCache()
_api_key_cache = _TokenCache()


def invalidate_session_token(token: str) -> None:
    _session_cache.invalidate(token)


def invalidate_api_key_cache(api_key: str) -> None:
    _api_key_cache.invalidate(api_key)


def invalidate_user_caches(user_id: str) -> None:
    _session_cache.invalidate_user(user_id)
    _api_key_cache.invalidate_user(user_id)


# ---------------------------------------------------------------------------
# Per-request resolver
# ---------------------------------------------------------------------------

def _extract_bearer(request_headers) -> str | None:
    auth = request_headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip() or None
    return None


def resolve_user_id_from_session(token: str) -> str | None:
    cached = _session_cache.get(token)
    now = datetime.utcnow()
    if cached is not None:
        user_id, expires_at = cached
        if expires_at is not None and expires_at <= now:
            _session_cache.invalidate(token)
            return None
        return user_id

    with SessionLocal() as db:
        row = db.execute(select(Session).where(Session.token == token)).scalar_one_or_none()
        if row is None or row.expires_at <= now:
            return None
        _session_cache.put(token, row.user_id, row.expires_at)
        return row.user_id


def resolve_user_id_from_api_key(api_key: str) -> str | None:
    cached = _api_key_cache.get(api_key)
    if cached is not None:
        return cached[0]

    with SessionLocal() as db:
        row = db.execute(select(ApiKey).where(ApiKey.key == api_key)).scalar_one_or_none()
        if row is None:
            return None
        _api_key_cache.put(api_key, row.user_id, None)
        return row.user_id


def resolve_user_from_request(request: Request) -> User | None:
    """Resolve the caller to a ``User`` via session → API key header → query.

    Returns None if the request carries no credentials, the token is invalid,
    or the session is expired. Caller decides the HTTP code (401 for REST,
    1008 for WS).
    """
    token = _extract_bearer(request.headers)
    user_id: str | None = None
    if token:
        user_id = resolve_user_id_from_session(token)

    if user_id is None:
        api_key = request.headers.get("x-api-key")
        if api_key:
            user_id = resolve_user_id_from_api_key(api_key)

    if user_id is None:
        api_key_q = request.query_params.get("api_key")
        if api_key_q:
            user_id = resolve_user_id_from_api_key(api_key_q)

    if user_id is None:
        return None

    with SessionLocal() as db:
        return db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
