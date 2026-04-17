"""
Per-user WebSocket fan-out for the pipeline broadcast.

Topology:
- One background ticker loop runs at ``TICK_INTERVAL_SECS``.
- Each tick iterates every user that has ≥ 1 connected WebSocket, rebuilds
  their payload from their own pipeline results, and broadcasts it only to
  *their* sockets — never across accounts.
- When a user's pipeline is rerun (via ``rerun_and_broadcast``), the ticker
  picks up the fresh results on the next tick; ``restart_ticker(user_id)``
  resets per-user diff state so position updates compute against the new
  baseline.

Route: ``ws://host:port/ws?session_token=<token>``. Invalid / missing tokens
are rejected during the accept handshake with close code 1008.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import polars as pl
from fastapi import WebSocket, WebSocketDisconnect

from server.api.auth.tokens import resolve_user_id_from_session
from server.api.config import TICK_INTERVAL_SECS
from server.api.engine_state import get_pipeline_results, rerun_pipeline
from server.api.market_value_store import clear_dirty, is_dirty
from server.api.models import ServerPayload
from server.api.stream_registry import get_stream_registry
from server.api.ws_serializers import (
    context_at_tick,
    positions_at_tick,
    streams_from_blocks,
    updates_from_diff,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Per-user broadcast state
# ---------------------------------------------------------------------------

@dataclass
class _UserTickerState:
    """Mutable per-user state for the broadcast ticker."""
    prev_positions: dict[str, float] = field(default_factory=dict)
    last_ts_idx: int = -1
    tick_count: int = 0
    current_tick_ts: datetime | None = None
    latest_payload: str | None = None


_clients: dict[str, set[WebSocket]] = {}
_states: dict[str, _UserTickerState] = {}
_ticker_task: asyncio.Task | None = None
_lock = asyncio.Lock()


def _get_state(user_id: str) -> _UserTickerState:
    state = _states.get(user_id)
    if state is None:
        state = _UserTickerState()
        _states[user_id] = state
    return state


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------

def get_current_tick_ts(user_id: str) -> datetime | None:
    state = _states.get(user_id)
    return state.current_tick_ts if state is not None else None


def get_latest_payload(user_id: str) -> str | None:
    state = _states.get(user_id)
    return state.latest_payload if state is not None else None


def active_connection_counts() -> dict[str, int]:
    """Return {user_id: connection_count} — consumed by the admin dashboard."""
    return {uid: len(sockets) for uid, sockets in _clients.items() if sockets}


# ---------------------------------------------------------------------------
# Payload building
# ---------------------------------------------------------------------------

def _build_payload(streams: list, context: dict, positions: list, updates: list) -> str:
    return ServerPayload(
        streams=streams,
        context=context,
        positions=positions,
        updates=updates,
    ).model_dump_json(by_alias=True)


def _heartbeat_payload() -> str:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return _build_payload(
        streams=[],
        context={"lastUpdateTimestamp": now_ms},
        positions=[],
        updates=[],
    )


def _extract_timeline(results: dict[str, pl.DataFrame]) -> tuple[pl.DataFrame, pl.DataFrame, list[datetime]] | None:
    desired_pos_df = results["desired_pos_df"]
    blocks_df = results["blocks_df"]
    timestamps: list[datetime] = (
        desired_pos_df.select("timestamp")
        .unique()
        .sort("timestamp")["timestamp"]
        .to_list()
    )
    if not timestamps:
        return None
    return desired_pos_df, blocks_df, timestamps


async def _check_dirty_rerun(user_id: str) -> None:
    """Coalesced pipeline rerun if the user's market value store is dirty."""
    if not is_dirty(user_id):
        return
    clear_dirty(user_id)
    registry = get_stream_registry(user_id)
    stream_configs = registry.build_stream_configs()
    if not stream_configs:
        return
    try:
        await asyncio.to_thread(rerun_pipeline, user_id, stream_configs)
    except Exception:
        log.exception("Coalesced pipeline rerun failed for user=%s", user_id)


def _build_user_payload_sync(user_id: str, real_now: datetime) -> str:
    """Build the tick payload for one user from their latest pipeline results.

    Falls back to a heartbeat payload when the user has no pipeline data yet.
    """
    results = get_pipeline_results(user_id)
    if results is None:
        return _heartbeat_payload()

    timeline = _extract_timeline(results)
    if timeline is None:
        return _heartbeat_payload()

    desired_pos_df, blocks_df, timestamps = timeline
    state = _get_state(user_id)

    # Find latest ts <= real_now (walking forward from previous idx is O(1)
    # in the steady state since timestamps are monotonic).
    ts_idx = state.last_ts_idx
    for i, ts in enumerate(timestamps):
        if ts <= real_now:
            ts_idx = i
        else:
            break
    if ts_idx < 0:
        ts_idx = 0

    ts = timestamps[ts_idx]
    state.current_tick_ts = ts

    positions = positions_at_tick(desired_pos_df, ts, state.prev_positions)

    updates: list = []
    if ts_idx != state.last_ts_idx:
        updates = updates_from_diff(positions, state.prev_positions, state.tick_count)
        for pos in positions:
            key = f"{pos['symbol']}-{pos['expiry']}"
            state.prev_positions[key] = pos["desiredPos"]
        state.last_ts_idx = ts_idx

    streams = streams_from_blocks(blocks_df, timestamps[0])
    ts_ms = int(real_now.timestamp() * 1000)
    for s in streams:
        s["lastHeartbeat"] = ts_ms

    state.tick_count += 1
    return _build_payload(streams, context_at_tick(ts), positions, updates)


# ---------------------------------------------------------------------------
# Ticker loop — one task, iterates every active user per tick
# ---------------------------------------------------------------------------

async def _broadcast(user_id: str, payload: str) -> None:
    sockets = _clients.get(user_id)
    if not sockets:
        return
    disconnected: list[WebSocket] = []
    for ws in sockets:
        try:
            await ws.send_text(payload)
        except WebSocketDisconnect:
            disconnected.append(ws)
        except Exception as exc:
            log.debug("WS broadcast error for user=%s: %s", user_id, type(exc).__name__)
            disconnected.append(ws)
    for ws in disconnected:
        sockets.discard(ws)


async def _run_ticker() -> None:
    log.info("WS ticker started")
    while True:
        try:
            real_now = datetime.now(timezone.utc).replace(tzinfo=None)
            for user_id in list(_clients.keys()):
                sockets = _clients.get(user_id)
                if not sockets:
                    continue
                await _check_dirty_rerun(user_id)
                try:
                    payload = _build_user_payload_sync(user_id, real_now)
                except Exception:
                    log.exception("Payload build failed for user=%s", user_id)
                    continue
                _get_state(user_id).latest_payload = payload
                await _broadcast(user_id, payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Ticker loop iteration failed")
        await asyncio.sleep(TICK_INTERVAL_SECS)


def _ensure_ticker() -> None:
    global _ticker_task
    if _ticker_task is None or _ticker_task.done():
        _ticker_task = asyncio.get_running_loop().create_task(_run_ticker())


async def restart_ticker(user_id: str) -> None:
    """Reset per-user ticker state after a pipeline rerun.

    The singleton ticker keeps running across all users — we only invalidate
    this user's diff baseline so position updates compute against the new
    pipeline output.
    """
    state = _get_state(user_id)
    state.prev_positions.clear()
    state.last_ts_idx = -1
    state.current_tick_ts = None
    state.latest_payload = None
    _ensure_ticker()


# ---------------------------------------------------------------------------
# Client registration API (used by pipeline_ws + client_ws)
# ---------------------------------------------------------------------------

def register_client(user_id: str, ws: WebSocket) -> None:
    _clients.setdefault(user_id, set()).add(ws)
    _ensure_ticker()


def unregister_client(user_id: str, ws: WebSocket) -> None:
    sockets = _clients.get(user_id)
    if sockets is not None:
        sockets.discard(ws)
        if not sockets:
            _clients.pop(user_id, None)


# ---------------------------------------------------------------------------
# /ws handler — UI pipeline subscription
# ---------------------------------------------------------------------------

async def pipeline_ws(websocket: WebSocket) -> None:
    """Accept a UI WS connection and register it under the owning user.

    Session token is read from the ``session_token`` query param. Invalid /
    missing tokens are rejected with close code 1008 — never accepted.
    """
    token = websocket.query_params.get("session_token")
    user_id: str | None = None
    if token:
        user_id = resolve_user_id_from_session(token)

    if user_id is None:
        await websocket.accept()
        await websocket.close(code=1008, reason="invalid_session")
        return

    await websocket.accept()
    log.info("UI WS connected for user=%s (%d total)", user_id, len(_clients.get(user_id, set())) + 1)

    _ensure_ticker()
    latest = get_latest_payload(user_id)
    if latest is not None:
        try:
            await websocket.send_text(latest)
        except Exception:
            return

    register_client(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        unregister_client(user_id, websocket)
        log.info("UI WS disconnected for user=%s", user_id)
