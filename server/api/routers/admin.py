"""
Admin endpoints — usage overview for the operator.

Only admin users can reach these. Non-admin callers get 403 via
``Depends(current_admin)``.
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from server.api.auth.dependencies import current_admin
from server.api.auth.models import Session as SessionRow, UsageEvent, User
from server.api.db import SessionLocal
from server.api.models import AdminUserListResponse, AdminUserSummary

router = APIRouter()


def _summarise_sync() -> list[AdminUserSummary]:
    """Build one AdminUserSummary per user via three aggregated queries."""
    with SessionLocal() as db:
        users = db.execute(select(User).order_by(User.created_at)).scalars().all()

        manual_counts = dict(
            db.execute(
                select(UsageEvent.user_id, func.count())
                .where(UsageEvent.event_type == "manual_block_create")
                .group_by(UsageEvent.user_id)
            ).all()
        )

        session_counts = dict(
            db.execute(
                select(SessionRow.user_id, func.count()).group_by(SessionRow.user_id)
            ).all()
        )

        # time-on-app = sum of (app_blur.created_at - matching app_focus.created_at).
        # v1 approximation: count of focus events × 60s — swap for a real
        # paired-event sum when analytics volume makes it worth the query.
        focus_counts = dict(
            db.execute(
                select(UsageEvent.user_id, func.count())
                .where(UsageEvent.event_type == "app_focus")
                .group_by(UsageEvent.user_id)
            ).all()
        )

        # Active WS connections (per-user) come from the pipeline broadcast
        # dict. Imported lazily to sidestep the ws ↔ admin module cycle.
        from server.api.ws import active_connection_counts
        conn_counts = active_connection_counts()

        out: list[AdminUserSummary] = []
        for u in users:
            focus_seconds = focus_counts.get(u.id, 0) * 60
            out.append(AdminUserSummary(
                id=u.id,
                username=u.username_display,
                created_at=u.created_at,
                last_login_at=u.last_login_at,
                active_ws_connections=conn_counts.get(u.id, 0),
                manual_block_count=manual_counts.get(u.id, 0),
                total_sessions=session_counts.get(u.id, 0),
                total_time_seconds=focus_seconds,
            ))
        return out


@router.get("/api/admin/users", response_model=AdminUserListResponse)
async def list_users(_admin: User = Depends(current_admin)) -> AdminUserListResponse:
    rows = await asyncio.to_thread(_summarise_sync)
    return AdminUserListResponse(users=rows)
