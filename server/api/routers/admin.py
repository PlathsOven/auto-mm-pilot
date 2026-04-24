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
from server.api.llm.models import LlmFailure
from server.api.models import (
    AdminLlmFailureListResponse,
    AdminLlmFailureRow,
    AdminUserListResponse,
    AdminUserSummary,
)

router = APIRouter()

# v1 approximation: each `app_focus` event represents ~1 minute of dwell.
# Replace with a paired focus/blur sum once analytics volume justifies the
# query cost. See `_summarise_sync` below.
_FOCUS_EVENT_APPROX_SECS = 60


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
        # v1 approximates with a per-focus-event constant — see
        # `_FOCUS_EVENT_APPROX_SECS` at the top of this module.
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
            focus_seconds = focus_counts.get(u.id, 0) * _FOCUS_EVENT_APPROX_SECS
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


_FAILURE_PAGE_MAX = 200


def _fetch_failures_sync(
    user_id: str | None,
    signal_type: str | None,
    since: datetime | None,
    limit: int,
) -> list[AdminLlmFailureRow]:
    """Query llm_failures with optional filters, ordered newest-first."""
    with SessionLocal() as db:
        stmt = select(LlmFailure).order_by(LlmFailure.id.desc()).limit(limit)
        if user_id:
            stmt = stmt.where(LlmFailure.user_id == user_id)
        if signal_type:
            stmt = stmt.where(LlmFailure.signal_type == signal_type)
        if since is not None:
            stmt = stmt.where(LlmFailure.created_at >= since)
        rows = db.execute(stmt).scalars().all()
        return [
            AdminLlmFailureRow(
                id=r.id,
                user_id=r.user_id,
                conversation_turn_id=r.conversation_turn_id,
                llm_call_id=r.llm_call_id,
                signal_type=r.signal_type,
                trigger=r.trigger,
                llm_output_snippet=r.llm_output_snippet,
                trader_response_snippet=r.trader_response_snippet,
                detector_reasoning=r.detector_reasoning,
                metadata_json=r.metadata_json,
                created_at=r.created_at,
            )
            for r in rows
        ]


@router.get("/api/admin/llm-failures", response_model=AdminLlmFailureListResponse)
async def list_llm_failures(
    user_id: str | None = None,
    signal_type: str | None = None,
    since: datetime | None = None,
    limit: int = 50,
    _admin: User = Depends(current_admin),
) -> AdminLlmFailureListResponse:
    """List recent ``llm_failures`` rows, optionally filtered.

    Developer-only read path — no UI in v1 (spec §16.8). Use it for
    offline analysis of which proposals / modes / users generate the
    most failure signals.
    """
    bounded = max(1, min(limit, _FAILURE_PAGE_MAX))
    rows = await asyncio.to_thread(
        _fetch_failures_sync, user_id, signal_type, since, bounded,
    )
    return AdminLlmFailureListResponse(rows=rows)
