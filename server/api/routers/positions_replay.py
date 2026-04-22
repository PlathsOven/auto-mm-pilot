"""Positions replay endpoint — audit §9.2 gap recovery."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.models import PositionsSinceResponse, ServerPayload
from server.api.positions_replay_store import get_store as get_replay_store

log = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/api/positions/since/{seq}",
    response_model=PositionsSinceResponse,
)
async def positions_since(
    seq: int,
    user: User = Depends(current_user),
) -> PositionsSinceResponse:
    """Return every broadcast payload with ``seq > <seq>``.

    A reconnecting consumer that tracked the last-seen seq calls this on
    reconnect to fetch anything it missed. ``gap_detected`` fires when the
    caller's seq is older than the server's replay buffer — the response
    still carries the oldest N, but the caller should treat state as stale.
    """
    store = get_replay_store(user.id)
    entries = store.since(seq)
    oldest = store.oldest_seq()
    gap = oldest is not None and seq < oldest - 1 and seq != 0

    payloads = [
        ServerPayload.model_validate(json.loads(e.payload_json))
        for e in entries
    ]
    return PositionsSinceResponse(
        payloads=payloads,
        gap_detected=gap,
        latest_seq=store.latest_seq(),
    )
