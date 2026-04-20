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

from server.api.config import MARKET_VALUE_MISMATCH_ABS_TOL_VOL, UPDATE_THRESHOLD
from server.api.expiry import canonical_expiry_key
from server.core.config import SECONDS_PER_YEAR


# Decimal-vol → vol-points conversion: one "vol point" is 1% annualised
# vol, i.e. decimal × 100. Applied to every ``*_vol`` wire field (and to
# the aggregate ``marketVol`` pulled from the per-user store) so the grid
# and cell inspector render the number options traders actually read.
VOL_POINTS_SCALE: float = 100.0

# Names of the variance-unit columns in ``desired_pos_df`` that we expose as
# annualised-vol aggregates to the client. Edge and smoothed-edge carry sign;
# variance / fair are non-negative but the signed formula is safe either way.
_VOL_SOURCE_COLS: tuple[str, ...] = (
    "edge",
    "smoothed_edge",
    "var",
    "smoothed_var",
    "total_fair",
    "total_market_fair",
)

# Wire-field names mirrored in ``DesiredPosition`` (server) + ``types.ts`` (client).
_VOL_WIRE_FIELDS: dict[str, str] = {
    "edge":              "edge_vol",
    "smoothed_edge":     "smoothed_edge_vol",
    "var":               "variance_vol",
    "smoothed_var":      "smoothed_var_vol",
    "total_fair":        "total_fair_vol",
    "total_market_fair": "total_market_fair_vol",
}


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

def _vol_aggregates(
    desired_pos_df: pl.DataFrame,
    timestamp: datetime,
) -> pl.DataFrame:
    """Per-(symbol, expiry) variance-units-to-vol-points aggregate.

    For each source column s in ``_VOL_SOURCE_COLS``:

        s_vol = sign(sum_s) * sqrt(|sum_s| / T)

    where ``sum_s`` sums ``s`` over the forward grid from ``timestamp`` to
    ``expiry``, and ``T`` is that span in years. This is the inverse of the
    ``total_vol ** 2 → aggregate_var`` mapping used in
    ``market_value_inference``, lifting variance-space scalars back into
    annualised vol points that options traders can read directly.
    """
    forward = desired_pos_df.filter(pl.col("timestamp") >= timestamp)

    agg_exprs = [pl.col(c).sum().alias(f"_{c}_sum") for c in _VOL_SOURCE_COLS]
    if forward.is_empty():
        dims = desired_pos_df.select("symbol", "expiry").unique()
        sums = dims.with_columns(*(pl.lit(0.0).alias(f"_{c}_sum") for c in _VOL_SOURCE_COLS))
    else:
        sums = forward.group_by(["symbol", "expiry"]).agg(agg_exprs)

    t_years = (
        (pl.col("expiry").cast(pl.Datetime("us")) - pl.lit(timestamp))
        .dt.total_seconds() / SECONDS_PER_YEAR
    )
    with_t = sums.with_columns(t_years.alias("_t_years"))

    vol_exprs = []
    for src, wire_name in _VOL_WIRE_FIELDS.items():
        s = pl.col(f"_{src}_sum")
        vol_exprs.append(
            pl.when(pl.col("_t_years") <= 0.0)
            .then(0.0)
            .otherwise(s.sign() * (s.abs() / pl.col("_t_years")).sqrt() * VOL_POINTS_SCALE)
            .fill_null(0.0)
            .alias(wire_name)
        )

    return with_t.with_columns(vol_exprs).select(
        "symbol", "expiry", *_VOL_WIRE_FIELDS.values(),
    )


def positions_at_tick(
    desired_pos_df: pl.DataFrame,
    timestamp: datetime,
    prev_positions: dict[str, float],
    market_values: dict[tuple[str, str], float] | None = None,
) -> list[dict[str, Any]]:
    """Build the ``positions`` array for a single tick.

    Uses "latest at or before" semantics per risk dimension so that
    dimensions with different time grids always have data. Alongside the
    variance-unit scalars, emits annualised-vol-point versions (``edgeVol``,
    ``varianceVol``, …) sourced from the forward-grid integral — see
    ``_vol_aggregates``. ``market_values`` keys are ``(symbol, iso_expiry)``
    tuples matching the per-user aggregate market-value store; dimensions
    without a user-set quote emit ``marketVol = 0.0``.
    """
    mv_map = market_values or {}
    at_or_before = desired_pos_df.filter(pl.col("timestamp") <= timestamp)
    if at_or_before.is_empty():
        return []

    # Per (symbol, expiry), take the row with the latest timestamp
    rows = at_or_before.sort("timestamp").group_by(["symbol", "expiry"]).agg(pl.all().last())

    vol_rows = _vol_aggregates(desired_pos_df, timestamp)
    rows = rows.join(vol_rows, on=["symbol", "expiry"], how="left")

    ts_ms = int(timestamp.timestamp() * 1000)

    # Vectorised rename + format: build the wire-shape DataFrame in one pass,
    # then call .to_dicts() instead of looping with iter_rows.
    # Send full-precision floats for edge/variance inputs so the client's
    # LiveEquationStrip can reproduce the position-sizing math exactly.
    # `desiredPos` / `rawDesiredPos` stay rounded at 2dp — that's display
    # precision, and the UI uses it as the authoritative cell value.
    wire = rows.select(
        pl.col("symbol"),
        pl.col("expiry").map_elements(
            canonical_expiry_key,
            return_dtype=pl.Utf8,
        ).alias("_expiry_iso"),
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
        pl.col("edge_vol").fill_null(0.0).alias("edgeVol"),
        pl.col("smoothed_edge_vol").fill_null(0.0).alias("smoothedEdgeVol"),
        pl.col("variance_vol").fill_null(0.0).alias("varianceVol"),
        pl.col("smoothed_var_vol").fill_null(0.0).alias("smoothedVarVol"),
        pl.col("total_fair_vol").fill_null(0.0).alias("totalFairVol"),
        pl.col("total_market_fair_vol").fill_null(0.0).alias("totalMarketFairVol"),
        pl.lit(ts_ms).alias("updatedAt"),
    )

    positions = wire.to_dicts()

    # Compute changeMagnitude per position using prev_positions lookup;
    # attach marketVol from the per-user aggregate-market-value store,
    # keyed by (symbol, iso_expiry).
    for pos in positions:
        key = f"{pos['symbol']}-{pos['expiry']}"
        prev_desired = prev_positions.get(key, pos["desiredPos"])
        pos["changeMagnitude"] = round(pos["desiredPos"] - prev_desired, 2)
        mv_key = (pos["symbol"], pos.pop("_expiry_iso"))
        pos["marketVol"] = mv_map.get(mv_key, 0.0) * VOL_POINTS_SCALE

    return positions


def market_value_mismatches_from_positions(
    positions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Flag (symbol, expiry) pairs where ``totalMarketFairVol`` != ``marketVol``.

    Both values come straight from ``positions_at_tick`` — implied from the
    per-block forward integral, aggregate from the user-set store. They should
    be equal by construction (``market_value_inference`` closes that loop).
    When they aren't, it's a real inconsistency the trader should see.

    Zero-aggregate + non-zero implied also fires: the guidance is "you should
    be setting an aggregate marketVol." Zero/zero skips.
    """
    alerts: list[dict[str, Any]] = []
    tol = MARKET_VALUE_MISMATCH_ABS_TOL_VOL
    for pos in positions:
        aggregate = pos.get("marketVol", 0.0)
        implied = pos.get("totalMarketFairVol", 0.0)
        if abs(aggregate) <= tol and abs(implied) <= tol:
            continue
        diff = implied - aggregate
        if abs(diff) <= tol:
            continue
        alerts.append({
            "symbol": pos["symbol"],
            "expiry": pos["expiry"],
            "aggregateVol": aggregate,
            "impliedVol": implied,
            "diff": diff,
        })
    return alerts


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
