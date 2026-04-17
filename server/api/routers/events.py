"""
Usage analytics endpoint — client-instrumented events.

Events are low-cardinality + non-PII (panel opens, block creates, focus/blur,
Zone C cell clicks). The admin dashboard aggregates them server-side.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends

from server.api.auth.dependencies import current_user
from server.api.auth.models import User, UsageEvent
from server.api.db import SessionLocal
from server.api.models import UsageEventRequest

log = logging.getLogger(__name__)

router = APIRouter()


def _log_event_sync(user_id: str, event_type: str, metadata: dict) -> None:
    with SessionLocal() as db:
        db.add(UsageEvent(
            user_id=user_id,
            event_type=event_type,
            event_metadata=metadata,
            created_at=datetime.utcnow(),
        ))
        db.commit()


async def log_event(user_id: str, event_type: str, metadata: dict | None = None) -> None:
    """Server-callable helper for events logged from routers (e.g. block creation)."""
    await asyncio.to_thread(_log_event_sync, user_id, event_type, metadata or {})


@router.post("/api/events", status_code=204)
async def post_event(
    req: UsageEventRequest,
    user: User = Depends(current_user),
) -> None:
    await log_event(user.id, req.type, dict(req.metadata))
