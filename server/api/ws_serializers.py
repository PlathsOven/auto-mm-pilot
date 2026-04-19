"""
Pipeline DataFrame → JSON-safe dict serialization helpers.

Extracted from ``ws.py`` to keep the WebSocket ticker module focused on
connection management and broadcast lifecycle.  All functions here are
pure (no module-level state) and operate on Polars DataFrames.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import polars as pl

from server.api.config import UPDATE_THRESHOLD


# ---------------------------------------------------------------------------
# Expiry formatting
# ---------------------------------------------------------------------------

def format_expiry(val: Any) -> str:
    """Format a date / datetime / ISO string / DDMMMYY string to DDMMMYY.

    Polars hands back ``date`` for ``pl.Date`` columns and ``datetime`` for
    ``pl.Datetime`` columns; both need the same wire format. ISO-string
    inputs (e.g. cached payloads) are also normalised. Strings that already
    look like DDMMMYY pass through untouched.
    """
    # datetime is a subclass of date, so check it first.
    if isinstance(val, datetime):
        return val.strftime("%d%b%y").upper()
    if isinstance(val, date):
        return val.strftime("%d%b%y").upper()
    if isinstance(val, str):
        # Already DDMMMYY (length 7, ends with 2-digit year)?
        if len(val) == 7 and val[2:5].isalpha():
            return val.upper()
        # Try parsing as ISO and reformat.
        try:
            return datetime.fromisoformat(val).strftime("%d%b%y").upper()
        except ValueError:
            pass
    return str(val)


# ---------------------------------------------------------------------------
# Tick serialization
# ---------------------------------------------------------------------------

def positions_at_tick(
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

    ts_ms = int(timestamp.timestamp() * 1000)

    # Vectorised rename + format: build the wire-shape DataFrame in one pass,
    # then call .to_dicts() instead of looping with iter_rows.
    # Send full-precision floats for edge/variance inputs so the client's
    # LiveEquationStrip can reproduce the position-sizing math exactly.
    # `desiredPos` / `rawDesiredPos` stay rounded at 2dp — that's display
    # precision, and the UI uses it as the authoritative cell value.
    wire = rows.select(
        pl.col("symbol"),
        pl.col("expiry").map_elements(format_expiry, return_dtype=pl.Utf8).alias("expiry"),
        pl.col("edge").fill_null(0.0).alias("edge"),
        pl.col("smoothed_edge").fill_null(0.0).alias("smoothedEdge"),
        pl.col("var").fill_null(0.0).alias("variance"),
        pl.col("smoothed_var").fill_null(0.0).alias("smoothedVar"),
        pl.col("smoothed_desired_position").fill_null(0.0).round(2).alias("desiredPos"),
        pl.col("raw_desired_position").fill_null(0.0).round(2).alias("rawDesiredPos"),
        pl.lit(0.0).alias("currentPos"),
        pl.col("total_fair").fill_null(0.0).alias("totalFair"),
        pl.col("total_market_fair").fill_null(0.0).alias("totalMarketFair"),
        pl.lit(ts_ms).alias("updatedAt"),
    )

    positions = wire.to_dicts()

    # Compute changeMagnitude per position using prev_positions lookup
    for pos in positions:
        key = f"{pos['symbol']}-{pos['expiry']}"
        prev_desired = prev_positions.get(key, pos["desiredPos"])
        pos["changeMagnitude"] = round(pos["desiredPos"] - prev_desired, 2)

    return positions


def updates_from_diff(
    positions: list[dict[str, Any]],
    prev_positions: dict[str, float],
    tick_index: int,
) -> list[dict[str, Any]]:
    """Generate UpdateCards for positions whose desired changed significantly."""
    updates: list[dict[str, Any]] = []
    for pos in positions:
        key = f"{pos['symbol']}-{pos['expiry']}"
        prev = prev_positions.get(key, pos["desiredPos"])
        delta = pos["desiredPos"] - prev
        if abs(delta) >= UPDATE_THRESHOLD:
            updates.append({
                "id": f"update-{tick_index}-{key}",
                "symbol": pos["symbol"],
                "expiry": pos["expiry"],
                "oldPos": round(prev, 2),
                "newPos": pos["desiredPos"],
                "delta": round(delta, 2),
                "timestamp": pos["updatedAt"],
            })
    return updates


def streams_from_blocks(
    blocks_df: pl.DataFrame,
    timestamp: datetime,
    allowed_names: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Derive DataStream entries from block stream names.

    When ``allowed_names`` is provided, the result is intersected with it so
    stale stream names from older pipeline runs (renames, deletions) don't
    appear in the WS payload. Caller passes the current per-user registry's
    stream names — keeps the WS broadcast a single source of truth with the
    registry, which prevents the StreamInspector from 404ing on a stream the
    server no longer knows about.
    """
    names = sorted(blocks_df["stream_name"].unique().to_list())
    if allowed_names is not None:
        names = [n for n in names if n in allowed_names]
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


def context_at_tick(timestamp: datetime) -> dict[str, Any]:
    """Build the global context payload for a single tick."""
    return {
        "lastUpdateTimestamp": int(timestamp.timestamp() * 1000),
    }
