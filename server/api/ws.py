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
    """Build the ``positions`` array for a single tick."""
    rows = desired_pos_df.filter(pl.col("timestamp") == timestamp)
    positions: list[dict[str, Any]] = []

    for row in rows.iter_rows(named=True):
        key = f"{row['symbol']}-{_format_expiry(row['expiry'])}"
        prev_desired = prev_positions.get(key, row["smoothed_desired_position"])
        change = row["smoothed_desired_position"] - prev_desired

        positions.append({
            "asset": row["symbol"],
            "expiry": _format_expiry(row["expiry"]),
            "edge": round(row.get("edge", 0.0), 6),
            "smoothedEdge": round(row.get("smoothed_edge", 0.0), 6),
            "variance": round(row.get("var", 0.0), 6),
            "smoothedVar": round(row.get("smoothed_var", 0.0), 6),
            "desiredPos": round(row.get("smoothed_desired_position", 0.0), 2),
            "rawDesiredPos": round(row.get("raw_desired_position", 0.0), 2),
            "currentPos": 0.0,
            "totalFair": round(row.get("total_fair", 0.0), 6),
            "totalMarketFair": round(row.get("total_market_fair", 0.0), 6),
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
                "reason": "",
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
        "engineState": "OPTIMIZING",
        "operatingSpace": "VARIANCE",
        "lastUpdateTimestamp": int(timestamp.timestamp() * 1000),
    }


# ---------------------------------------------------------------------------
# Singleton ticker — advances through the time grid once, broadcasts to all
# connected clients.
# ---------------------------------------------------------------------------

_clients: set[WebSocket] = set()
_latest_payload: str | None = None
_ticker_task: asyncio.Task | None = None


async def _run_ticker() -> None:
    """Background task: step through the pipeline time grid and broadcast."""
    results = get_pipeline_results()
    if results is None:
        log.error("Pipeline not initialized — ticker cannot start")
        return

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
        return

    log.info("Ticker started: %d pipeline ticks at %.1fs interval", len(timestamps), TICK_INTERVAL_SECS)

    global _latest_payload
    prev_positions: dict[str, float] = {}
    streams = _streams_from_blocks(blocks_df, timestamps[0])

    for i, ts in enumerate(timestamps):
        positions = _positions_at_tick(desired_pos_df, ts, prev_positions)
        updates = _updates_from_diff(positions, prev_positions, i)

        payload_dict = {
            "streams": streams,
            "context": _context_at_tick(ts),
            "positions": positions,
            "updates": updates,
        }
        _latest_payload = json.dumps(payload_dict)

        # Update prev_positions for next tick
        for pos in positions:
            key = f"{pos['asset']}-{pos['expiry']}"
            prev_positions[key] = pos["desiredPos"]

        # Update stream heartbeats
        ts_ms = int(ts.timestamp() * 1000)
        for s in streams:
            s["lastHeartbeat"] = ts_ms

        # Broadcast to all connected clients
        disconnected: list[WebSocket] = []
        for ws in _clients:
            try:
                await ws.send_text(_latest_payload)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            _clients.discard(ws)

        await asyncio.sleep(TICK_INTERVAL_SECS)

    log.info("All pipeline ticks sent. Ticker idle.")


def _ensure_ticker() -> None:
    """Start the singleton ticker if it isn't already running."""
    global _ticker_task
    if _ticker_task is None or _ticker_task.done():
        _ticker_task = asyncio.get_event_loop().create_task(_run_ticker())


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
    _ticker_task = asyncio.get_event_loop().create_task(_run_ticker())


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
