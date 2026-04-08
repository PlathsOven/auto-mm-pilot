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
from typing import Any

import polars as pl
from fastapi import WebSocket, WebSocketDisconnect

from server.api.config import APT_MODE
from server.api.engine_state import get_pipeline_results

log = logging.getLogger(__name__)

# How often (in real seconds) we push a new tick to clients
TICK_INTERVAL_SECS: float = 2.0

# Minimum |delta| in smoothed_desired_position to emit an UpdateCard
UPDATE_THRESHOLD: float = 50.0


# ---------------------------------------------------------------------------
# Serialization helpers  (pipeline DataFrame → JSON-safe dicts)
# ---------------------------------------------------------------------------

def _format_expiry(val: Any) -> str:
    if isinstance(val, datetime):
        return val.strftime("%d%b%y").upper()
    return str(val)


def _positions_at_tick(
    desired_pos_df: pl.DataFrame,
    timestamp: datetime,
    prev_positions: dict[str, float],
) -> list[dict[str, Any]]:
    """Build the ``positions`` array for a single tick.

    Uses "latest at or before" semantics per risk dimension so that
    dimensions with different time grids always have data.
    """
    at_or_before = desired_pos_df.filter(pl.col("timestamp") <= timestamp)
    if at_or_before.is_empty():
        return []

    # Per (symbol, expiry), take the row with the latest timestamp
    rows = at_or_before.sort("timestamp").group_by(["symbol", "expiry"]).agg(pl.all().last())

    positions: list[dict[str, Any]] = []
    for row in rows.iter_rows(named=True):
        key = f"{row['symbol']}-{_format_expiry(row['expiry'])}"
        prev_desired = prev_positions.get(key, row["smoothed_desired_position"])
        change = row["smoothed_desired_position"] - prev_desired

        # Send full-precision floats for edge/variance inputs so the client's
        # LiveEquationStrip can reproduce the position-sizing math exactly.
        # `desiredPos` / `rawDesiredPos` stay rounded at 2dp — that's display
        # precision, and the UI uses it as the authoritative cell value.
        positions.append({
            "asset": row["symbol"],
            "expiry": _format_expiry(row["expiry"]),
            "edge": row.get("edge", 0.0),
            "smoothedEdge": row.get("smoothed_edge", 0.0),
            "variance": row.get("var", 0.0),
            "smoothedVar": row.get("smoothed_var", 0.0),
            "desiredPos": round(row.get("smoothed_desired_position", 0.0), 2),
            "rawDesiredPos": round(row.get("raw_desired_position", 0.0), 2),
            "currentPos": 0.0,
            "totalFair": row.get("total_fair", 0.0),
            "totalMarketFair": row.get("total_market_fair", 0.0),
            "changeMagnitude": round(change, 2),
            "updatedAt": int(timestamp.timestamp() * 1000),
        })

    return positions


def _updates_from_diff(
    positions: list[dict[str, Any]],
    prev_positions: dict[str, float],
    tick_index: int,
) -> list[dict[str, Any]]:
    """Generate UpdateCards for positions whose desired changed significantly."""
    updates: list[dict[str, Any]] = []
    for pos in positions:
        key = f"{pos['asset']}-{pos['expiry']}"
        prev = prev_positions.get(key, pos["desiredPos"])
        delta = pos["desiredPos"] - prev
        if abs(delta) >= UPDATE_THRESHOLD:
            updates.append({
                "id": f"update-{tick_index}-{key}",
                "asset": pos["asset"],
                "expiry": pos["expiry"],
                "oldPos": round(prev, 2),
                "newPos": pos["desiredPos"],
                "delta": round(delta, 2),
                "timestamp": pos["updatedAt"],
            })
    return updates


def _streams_from_blocks(blocks_df: pl.DataFrame, timestamp: datetime) -> list[dict[str, Any]]:
    """Derive DataStream entries from block stream names."""
    names = sorted(blocks_df["stream_name"].unique().to_list())
    ts_ms = int(timestamp.timestamp() * 1000)
    return [
        {
            "id": f"stream-{i}",
            "name": name,
            "status": "ONLINE",
            "lastHeartbeat": ts_ms,
        }
        for i, name in enumerate(names)
    ]


def _context_at_tick(timestamp: datetime) -> dict[str, Any]:
    return {
        "lastUpdateTimestamp": int(timestamp.timestamp() * 1000),
    }


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


async def _broadcast(payload: str) -> None:
    """Send payload to all connected WS clients, pruning dead connections."""
    disconnected: list[WebSocket] = []
    for ws in _clients:
        try:
            await ws.send_text(payload)
        except Exception:
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
    streams = _streams_from_blocks(blocks_df, timestamps[0])

    for i, ts in enumerate(timestamps):
        _current_tick_ts = ts
        positions = _positions_at_tick(desired_pos_df, ts, prev_positions)
        updates = _updates_from_diff(positions, prev_positions, i)

        payload_dict = {
            "streams": streams,
            "context": _context_at_tick(ts),
            "positions": positions,
            "updates": updates,
        }
        _latest_payload = json.dumps(payload_dict)

        for pos in positions:
            key = f"{pos['asset']}-{pos['expiry']}"
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
    """
    global _latest_payload, _current_tick_ts

    log.info("Prod ticker started: %d pipeline timestamps, %.1fs heartbeat", len(timestamps), TICK_INTERVAL_SECS)

    prev_positions: dict[str, float] = {}
    streams = _streams_from_blocks(blocks_df, timestamps[0])
    last_ts_idx: int = -1
    tick_count: int = 0

    while True:
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
        positions = _positions_at_tick(desired_pos_df, ts, prev_positions)

        # Only emit update cards when the active timestamp advances
        updates = []
        if ts_idx != last_ts_idx:
            updates = _updates_from_diff(positions, prev_positions, tick_count)
            for pos in positions:
                key = f"{pos['asset']}-{pos['expiry']}"
                prev_positions[key] = pos["desiredPos"]
            last_ts_idx = ts_idx

        ts_ms = int(real_now.timestamp() * 1000)
        for s in streams:
            s["lastHeartbeat"] = ts_ms

        payload_dict = {
            "streams": streams,
            "context": _context_at_tick(ts),
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

    if APT_MODE == "prod":
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
