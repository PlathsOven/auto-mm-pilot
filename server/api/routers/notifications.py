"""Notification REST endpoints.

Surfaces:

- ``unregistered`` — push attempts against unknown stream names. Source:
  ``server/api/unregistered_push_store.py``.
- ``silent-streams`` — READY streams whose snapshots lack ``market_value``.
  Source: ``server/api/silent_stream_store.py``.

The WS ticker broadcasts both lists as part of each tick payload — these
endpoints are for initial hydration + manual dismissal.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.models import SilentStreamAlert, UnregisteredPushAttempt
from server.api.silent_stream_store import get_store as get_silent_stream_store
from server.api.unregistered_push_store import get_store as get_unregistered_push_store

router = APIRouter()


@router.get(
    "/api/notifications/unregistered",
    response_model=list[UnregisteredPushAttempt],
)
async def list_unregistered(
    user: User = Depends(current_user),
) -> list[UnregisteredPushAttempt]:
    """Return every unregistered-stream push attempt for the calling user."""
    return [
        UnregisteredPushAttempt(
            stream_name=a.stream_name,
            example_row=a.example_row,
            attempt_count=a.attempt_count,
            first_seen=a.first_seen.isoformat(),
            last_seen=a.last_seen.isoformat(),
        )
        for a in get_unregistered_push_store(user.id).list()
    ]


@router.delete(
    "/api/notifications/unregistered/{stream_name}",
    status_code=204,
)
async def dismiss_unregistered(
    stream_name: str,
    user: User = Depends(current_user),
) -> Response:
    """Drop an unregistered-push notification.

    Idempotent — dismissing a non-existent entry returns 204.
    """
    get_unregistered_push_store(user.id).dismiss(stream_name)
    return Response(status_code=204)


@router.get(
    "/api/notifications/silent-streams",
    response_model=list[SilentStreamAlert],
)
async def list_silent_streams(
    user: User = Depends(current_user),
) -> list[SilentStreamAlert]:
    """Return every silent-stream alert for the calling user."""
    return [
        SilentStreamAlert(
            stream_name=c.stream_name,
            rows_seen=c.rows_seen,
            first_seen=c.first_seen.isoformat(),
            last_seen=c.last_seen.isoformat(),
        )
        for c in get_silent_stream_store(user.id).list()
    ]


@router.delete(
    "/api/notifications/silent-streams/{stream_name}",
    status_code=204,
)
async def dismiss_silent_stream(
    stream_name: str,
    user: User = Depends(current_user),
) -> Response:
    """Drop a silent-stream notification.

    Idempotent — dismissing a non-existent entry returns 204.
    """
    get_silent_stream_store(user.id).dismiss(stream_name)
    return Response(status_code=204)
