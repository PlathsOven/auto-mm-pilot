"""
Account endpoints — profile, API key read, API key regeneration.

Key rotation immediately invalidates the old key everywhere:
- the per-key LRU cache is dropped,
- every open ``/ws/client`` bound to the old key is force-closed with 1008.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select

from server.api.auth.dependencies import current_user
from server.api.auth.models import ApiKey, User
from server.api.auth.tokens import generate_api_key, invalidate_api_key_cache
from server.api.db import SessionLocal
from server.api.models import ApiKeyResponse, UserPublic

log = logging.getLogger(__name__)

router = APIRouter()


def _to_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        username=user.username_display,
        created_at=user.created_at,
        is_admin=user.is_admin,
    )


def _read_api_key_sync(user_id: str) -> str | None:
    with SessionLocal() as db:
        row = db.execute(select(ApiKey).where(ApiKey.user_id == user_id)).scalar_one_or_none()
        return None if row is None else row.key


def _regenerate_api_key_sync(user_id: str) -> tuple[str, str | None]:
    """Replace the caller's API key. Returns (new_key, old_key | None)."""
    new_key = generate_api_key()
    now = datetime.utcnow()

    with SessionLocal() as db:
        row = db.execute(select(ApiKey).where(ApiKey.user_id == user_id)).scalar_one_or_none()
        old_key = row.key if row is not None else None
        if row is None:
            db.add(ApiKey(key=new_key, user_id=user_id, created_at=now))
        else:
            db.delete(row)
            db.flush()
            db.add(ApiKey(key=new_key, user_id=user_id, created_at=now))
        db.commit()
        return new_key, old_key


@router.get("/api/account", response_model=UserPublic)
async def get_account(user: User = Depends(current_user)) -> UserPublic:
    return _to_public(user)


@router.get("/api/account/key", response_model=ApiKeyResponse)
async def get_api_key(user: User = Depends(current_user)) -> ApiKeyResponse:
    key = await asyncio.to_thread(_read_api_key_sync, user.id)
    if key is None:
        # Self-heal: users created before the key table existed shouldn't see a 404.
        new_key, _ = await asyncio.to_thread(_regenerate_api_key_sync, user.id)
        return ApiKeyResponse(api_key=new_key)
    return ApiKeyResponse(api_key=key)


@router.post("/api/account/key/regenerate", response_model=ApiKeyResponse)
async def regenerate_api_key(user: User = Depends(current_user)) -> ApiKeyResponse:
    new_key, old_key = await asyncio.to_thread(_regenerate_api_key_sync, user.id)
    if old_key is not None:
        invalidate_api_key_cache(old_key)
        # Lazy import to sidestep the ws ↔ account router module cycle.
        from server.api.client_ws import close_connections_for_key
        await close_connections_for_key(old_key, reason="key_rotated")
    log.info("API key regenerated for user=%s", user.username_display)
    return ApiKeyResponse(api_key=new_key)
