"""
WebSocket endpoint — pushes real pipeline data to the UI.

A **singleton background ticker** advances through the ``desired_pos_df``
time grid once.  Connected WS clients receive the latest payload on every
tick.  Reconnecting clients join at the current tick — they never restart
the timeline.

Route:  ws://host:port/ws
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
import polars as pl
from fastapi import WebSocket, WebSocketDisconnect

from server.api.config import POSIT_MODE, TICK_INTERVAL_SECS
from server.api.engine_state import get_pipeline_results, rerun_pipeline
from server.api.market_value_store import is_dirty, clear_dirty, to_dict as mv_to_dict
from server.api.ws_serializers import (
    context_at_tick,
    positions_at_tick,
    streams_from_blocks,
    updates_from_diff,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Singleton ticker — two modes:
#   mock:  steps through the pipeline time grid at artificial intervals
#   prod:  broadcasts positions matching real wall-clock time
# ---------------------------------------------------------------------------

_clients: set[WebSocket] = set()
_latest_payload: str | None = None
_ticker_task: asyncio.Task | None = None
_current_tick_ts: datetime | None = None


def get_current_tick_ts() -> datetime | None:
    """Return the timestamp of the most recently broadcast pipeline tick."""
    return _current_tick_ts


def _extract_timeline(results: dict[str, pl.DataFrame]) -> tuple[pl.DataFrame, pl.DataFrame, list[datetime]] | None:
    """Shared setup: extract DataFrames and sorted timestamps from pipeline results."""
    desired_pos_df = results["desired_pos_df"]
    blocks_df = results["blocks_df"]

    timestamps: list[datetime] = (
        desired_pos_df.select("timestamp")
        .unique()
        .sort("timestamp")["timestamp"]
        .to_list()
    )

    if not timestamps:
        log.error("No timestamps in pipeline output")
        return None

    return desired_pos_df, blocks_df, timestamps


async def _check_dirty_rerun() -> tuple[pl.DataFrame, pl.DataFrame, list[datetime]] | None:
    """If the market value store is dirty, rerun the pipeline and return new timeline.

    Returns None if not dirty or if the rerun produces no data.
    """
    if not is_dirty():
        return None

    clear_dirty()
    log.info("Dirty flag set — coalesced pipeline rerun")

    from server.api.stream_registry import get_stream_registry
    registry = get_stream_registry()
    stream_configs = registry.build_stream_configs()
    if not stream_configs:
        return None

    try:
        await asyncio.to_thread(rerun_pipeline, stream_configs)
    except Exception:
        log.exception("Coalesced pipeline rerun failed")
        return None

    results = get_pipeline_results()
    if results is None:
        return None
    return _extract_timeline(results)


async def _broadcast(payload: str) -> None:
    """Send payload to all connected WS clients, pruning dead connections."""
    disconnected: list[WebSocket] = []
    for ws in _clients:
        try:
            await ws.send_text(payload)
        except WebSocketDisconnect:
            disconnected.append(ws)
        except Exception as exc:
            log.debug("WS broadcast error for client: %s", type(exc).__name__)
            disconnected.append(ws)
    for ws in disconnected:
        _clients.discard(ws)


async def _run_ticker_mock(
    desired_pos_df: pl.DataFrame,
    blocks_df: pl.DataFrame,
    timestamps: list[datetime],
) -> None:
    """Mock mode: step through pipeline time grid at artificial intervals."""
    global _latest_payload, _current_tick_ts

    log.info("Mock ticker started: %d pipeline ticks at %.1fs interval", len(timestamps), TICK_INTERVAL_SECS)

    prev_positions: dict[str, float] = {}
    streams = streams_from_blocks(blocks_df, timestamps[0])

    for i, ts in enumerate(timestamps):
        # Coalesced rerun: if market value store is dirty, rerun pipeline
        new_timeline = await _check_dirty_rerun()
        if new_timeline is not None:
            desired_pos_df, blocks_df, timestamps_new = new_timeline
            streams = streams_from_blocks(blocks_df, timestamps_new[0])
            log.info("Pipeline swapped from dirty-flag rerun (mock)")
            # Continue with current tick index on the new timeline

        _current_tick_ts = ts
        positions = positions_at_tick(desired_pos_df, ts, prev_positions)
        updates = updates_from_diff(positions, prev_positions, i)

        payload_dict = {
            "streams": streams,
            "context": context_at_tick(ts),
            "positions": positions,
            "updates": updates,
        }
        _latest_payload = json.dumps(payload_dict)

        for pos in positions:
            key = f"{pos['symbol']}-{pos['expiry']}"
            prev_positions[key] = pos["desiredPos"]

        ts_ms = int(ts.timestamp() * 1000)
        for s in streams:
            s["lastHeartbeat"] = ts_ms

        await _broadcast(_latest_payload)
        await asyncio.sleep(TICK_INTERVAL_SECS)

    log.info("All pipeline ticks sent. Mock ticker idle.")


async def _run_ticker_prod(
    desired_pos_df: pl.DataFrame,
    blocks_df: pl.DataFrame,
    timestamps: list[datetime],
) -> None:
    """Prod mode: broadcast positions matching real wall-clock time.

    On each tick, finds the latest pipeline timestamp <= now and broadcasts
    that snapshot.  Runs continuously until cancelled by ``restart_ticker()``.
    Checks the market value store dirty flag each tick for coalesced reruns.
    """
    global _latest_payload, _current_tick_ts

    log.info("Prod ticker started: %d pipeline timestamps, %.1fs heartbeat", len(timestamps), TICK_INTERVAL_SECS)

    prev_positions: dict[str, float] = {}
    streams = streams_from_blocks(blocks_df, timestamps[0])
    last_ts_idx: int = -1
    tick_count: int = 0

    while True:
        # Coalesced rerun: if market value store is dirty, rerun pipeline
        new_timeline = await _check_dirty_rerun()
        if new_timeline is not None:
            desired_pos_df, blocks_df, timestamps = new_timeline
            streams = streams_from_blocks(blocks_df, timestamps[0])
            last_ts_idx = -1
            log.info("Pipeline swapped from dirty-flag rerun (prod)")

        real_now = datetime.now(timezone.utc).replace(tzinfo=None)

        # Find the latest timestamp <= real_now
        ts_idx = last_ts_idx
        for i, ts in enumerate(timestamps):
            if ts <= real_now:
                ts_idx = i
            else:
                break

        # If real_now is before the first timestamp, use the first one
        if ts_idx < 0:
            ts_idx = 0

        ts = timestamps[ts_idx]
        _current_tick_ts = ts
        positions = positions_at_tick(desired_pos_df, ts, prev_positions)

        # Only emit update cards when the active timestamp advances
        updates = []
        if ts_idx != last_ts_idx:
            updates = updates_from_diff(positions, prev_positions, tick_count)
            for pos in positions:
                key = f"{pos['symbol']}-{pos['expiry']}"
                prev_positions[key] = pos["desiredPos"]
            last_ts_idx = ts_idx

        ts_ms = int(real_now.timestamp() * 1000)
        for s in streams:
            s["lastHeartbeat"] = ts_ms

        payload_dict = {
            "streams": streams,
            "context": context_at_tick(ts),
            "positions": positions,
            "updates": updates,
        }
        _latest_payload = json.dumps(payload_dict)

        await _broadcast(_latest_payload)

        tick_count += 1
        await asyncio.sleep(TICK_INTERVAL_SECS)


async def _run_heartbeat() -> None:
    """Broadcast empty heartbeat payloads until pipeline data is available.

    Keeps connected clients alive so they know the connection is working.
    Cancelled by ``restart_ticker()`` once the pipeline has run.
    """
    global _latest_payload

    log.info("Heartbeat ticker started (no pipeline data yet)")

    while True:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        payload_dict = {
            "streams": [],
            "context": {
                "lastUpdateTimestamp": now_ms,
            },
            "positions": [],
            "updates": [],
        }
        _latest_payload = json.dumps(payload_dict)
        await _broadcast(_latest_payload)
        await asyncio.sleep(TICK_INTERVAL_SECS)


async def _run_ticker() -> None:
    """Background task: dispatch to heartbeat, mock, or prod ticker."""
    results = get_pipeline_results()
    if results is None:
        await _run_heartbeat()
        return

    timeline = _extract_timeline(results)
    if timeline is None:
        await _run_heartbeat()
        return

    desired_pos_df, blocks_df, timestamps = timeline

    if POSIT_MODE == "prod":
        await _run_ticker_prod(desired_pos_df, blocks_df, timestamps)
    else:
        await _run_ticker_mock(desired_pos_df, blocks_df, timestamps)


def _ensure_ticker() -> None:
    """Start the singleton ticker if it isn't already running."""
    global _ticker_task
    if _ticker_task is None or _ticker_task.done():
        _ticker_task = asyncio.get_running_loop().create_task(_run_ticker())


async def restart_ticker() -> None:
    """Cancel the running ticker and start a fresh one with current pipeline results.

    Called after ``rerun_pipeline()`` so the WS broadcast picks up the new
    time grid.  Safe to call even if no ticker is running.
    """
    global _ticker_task, _latest_payload
    if _ticker_task is not None and not _ticker_task.done():
        _ticker_task.cancel()
        try:
            await _ticker_task
        except asyncio.CancelledError:
            pass
        log.info("Previous ticker cancelled for pipeline restart")
    _latest_payload = None
    _ticker_task = asyncio.get_running_loop().create_task(_run_ticker())


# ---------------------------------------------------------------------------
# Client registration API (used by client_ws.py)
# ---------------------------------------------------------------------------

def register_client(ws: WebSocket) -> None:
    """Add an external client WS to the broadcast set."""
    _clients.add(ws)
    _ensure_ticker()


def unregister_client(ws: WebSocket) -> None:
    """Remove an external client WS from the broadcast set."""
    _clients.discard(ws)


def get_latest_payload() -> str | None:
    """Return the most recent broadcast payload (for initial catch-up)."""
    return _latest_payload


# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------

async def pipeline_ws(websocket: WebSocket) -> None:
    """Accept a WS connection and register it with the singleton ticker."""
    await websocket.accept()
    log.info("WS client connected (%d total)", len(_clients) + 1)

    _ensure_ticker()

    # Send the latest payload immediately so the client isn't blank
    if _latest_payload is not None:
        try:
            await websocket.send_text(_latest_payload)
        except Exception:
            return

    _clients.add(websocket)
    try:
        # Hold the connection open — the ticker pushes data
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)
        log.info("WS client disconnected (%d remaining)", len(_clients))
