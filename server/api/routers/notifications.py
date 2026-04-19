"""Notification REST endpoints.

Today: unregistered-stream push attempts (see
``server/api/unregistered_push_store.py``). The WS ticker also broadcasts
the same list as part of each tick payload — these endpoints are for
initial hydration + manual dismissal.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.models import UnregisteredPushAttempt
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
