"""
DataFrame → dict serializers for downstream consumers.

Converts pipeline output DataFrames into the dict structures expected by
the LLM service layer (``engine_state.py``, ``snapshot_buffer.py``, and
the investigation prompt).
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import polars as pl


def snapshot_from_pipeline(
    results: dict[str, pl.DataFrame],
    timestamp: dt.datetime,
    risk_dimension_cols: list[str],
    bankroll: float,
    smoothing_hl_secs: int,
    now: dt.datetime,
) -> dict[str, Any]:
    """Extract a single-timestamp pipeline snapshot dict.

    Returns the same structure that the LLM prompts expect:
        - block_summary: list[dict] — one per block with stream_name,
          raw_fair, space_id, plus time-varying fair/var/market at the
          requested timestamp.
        - space_summary: list[dict] — one per (risk_dim, space_id) at the
          timestamp, with space_fair / space_var / space_market_fair.
        - current_agg: dict — total_fair, total_market_fair, edge, var.
        - current_position: dict — smoothed_edge, smoothed_var,
          raw_desired_position, smoothed_desired_position.
        - scenario: dict — bankroll, smoothing_hl_secs, now, risk_dimension.
    """
    blocks_df = results["blocks_df"]
    block_series_df = results["block_series_df"]
    space_series_df = results["space_series_df"]
    desired_pos_df = results["desired_pos_df"]

    block_summary = _serialize_blocks_df(blocks_df, risk_dimension_cols)
    _enrich_block_summary_at_timestamp(block_summary, block_series_df, timestamp)

    space_summary = _serialize_space_series_at_timestamp(
        space_series_df, timestamp, risk_dimension_cols,
    )

    current_agg = _extract_agg_at_timestamp(desired_pos_df, timestamp, risk_dimension_cols)
    current_position = _extract_position_at_timestamp(desired_pos_df, timestamp)

    risk_dim: dict[str, Any] = {}
    agg_row = desired_pos_df.filter(pl.col("timestamp") == timestamp)
    if agg_row.height > 0:
        first = agg_row.row(0, named=True)
        for rdc in risk_dimension_cols:
            risk_dim[rdc] = _serialize_value(first[rdc])

    scenario = {
        "bankroll": bankroll,
        "smoothing_hl_secs": smoothing_hl_secs,
        "now": str(now),
        "risk_dimension": risk_dim,
    }

    return {
        "block_summary": block_summary,
        "space_summary": space_summary,
        "current_agg": current_agg,
        "current_position": current_position,
        "scenario": scenario,
    }


def engine_state_from_pipeline(
    results: dict[str, pl.DataFrame],
    timestamp: dt.datetime,
    risk_dimension_cols: list[str],
) -> dict[str, Any]:
    """Build the engine state dict consumed by the investigation prompt."""
    desired_pos_df = results["desired_pos_df"]
    blocks_df = results["blocks_df"]

    pos_rows = desired_pos_df.filter(pl.col("timestamp") == timestamp)
    positions = []
    for row in pos_rows.iter_rows(named=True):
        positions.append({
            "asset": row.get("symbol", ""),
            "expiry": _serialize_value(row.get("expiry")),
            "desiredVega": row.get("smoothed_desired_position", 0.0),
            "previousDesiredVega": row.get("raw_desired_position", 0.0),
            "changeMagnitude": abs(
                row.get("smoothed_desired_position", 0.0)
                - row.get("raw_desired_position", 0.0)
            ),
            "updatedAt": _serialize_value(timestamp),
        })

    stream_names = blocks_df["stream_name"].unique().to_list() if blocks_df.height > 0 else []
    streams = [
        {
            "id": f"stream-{name}",
            "status": "active",
            "lastUpdate": _serialize_value(timestamp),
        }
        for name in sorted(stream_names)
    ]

    context: dict[str, Any] = {
        "now": _serialize_value(timestamp),
        "riskDimensions": [],
    }
    unique_dims = desired_pos_df.select(risk_dimension_cols).unique()
    for dim_row in unique_dims.iter_rows(named=True):
        context["riskDimensions"].append(
            {rdc: _serialize_value(dim_row[rdc]) for rdc in risk_dimension_cols}
        )

    return {
        "positions": positions,
        "streams": streams,
        "context": context,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _serialize_value(val: Any) -> Any:
    """Convert Polars/Python datetime values to ISO strings for JSON."""
    if isinstance(val, dt.datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(val, dt.date):
        return val.isoformat()
    return val


def _serialize_blocks_df(
    blocks_df: pl.DataFrame,
    risk_dimension_cols: list[str],
) -> list[dict[str, Any]]:
    """Convert blocks_df rows to list of dicts for block_summary."""
    summary_cols = risk_dimension_cols + [
        "block_name", "stream_name", "space_id",
        "raw_fair", "raw_var", "raw_market",
        "calc_fair_total", "calc_var_total", "calc_market_total",
        "var_fair_ratio", "annualized", "temporal_position",
        "decay_end_size_mult", "decay_rate_prop_per_min",
        "market_value_source",
    ]
    available = [c for c in summary_cols if c in blocks_df.columns]
    rows = blocks_df.select(available).to_dicts()
    for row in rows:
        for k, v in row.items():
            row[k] = _serialize_value(v)
    return rows


def _enrich_block_summary_at_timestamp(
    block_summary: list[dict[str, Any]],
    block_series_df: pl.DataFrame,
    timestamp: dt.datetime,
) -> None:
    """Add time-varying fair / var / market to block_summary in place."""
    if block_series_df.is_empty():
        return
    ts_slice = block_series_df.filter(pl.col("timestamp") == timestamp)
    if ts_slice.height == 0:
        return

    lookup: dict[str, dict[str, float]] = {}
    for row in ts_slice.iter_rows(named=True):
        lookup[row["block_name"]] = {
            "fair": row.get("fair", 0.0),
            "var": row.get("var", 0.0),
            "market": row.get("market", 0.0),
        }

    for block in block_summary:
        bn = block.get("block_name", "")
        if bn in lookup:
            block.update(lookup[bn])


def _serialize_space_series_at_timestamp(
    space_series_df: pl.DataFrame,
    timestamp: dt.datetime,
    risk_dimension_cols: list[str],
) -> list[dict[str, Any]]:
    """Emit per-(risk_dim, space_id) rows at the given timestamp."""
    if space_series_df.is_empty():
        return []
    ts_slice = space_series_df.filter(pl.col("timestamp") == timestamp)
    if ts_slice.height == 0:
        return []

    cols = risk_dimension_cols + ["space_id", "space_fair", "space_var", "space_market_fair"]
    available = [c for c in cols if c in ts_slice.columns]
    rows = ts_slice.select(available).to_dicts()
    for row in rows:
        for k, v in row.items():
            row[k] = _serialize_value(v)
    return rows


def _extract_agg_at_timestamp(
    desired_pos_df: pl.DataFrame,
    timestamp: dt.datetime,
    risk_dimension_cols: list[str],
) -> dict[str, Any]:
    """Extract aggregated values at a specific timestamp."""
    if desired_pos_df.is_empty():
        return {}
    row_df = desired_pos_df.filter(pl.col("timestamp") == timestamp)
    if row_df.height == 0:
        return {}
    row = row_df.row(0, named=True)
    result: dict[str, Any] = {}
    for rdc in risk_dimension_cols:
        result[rdc] = _serialize_value(row.get(rdc))
    result["timestamp"] = _serialize_value(timestamp)
    result["total_fair"] = row.get("total_fair", 0.0)
    result["total_market_fair"] = row.get("total_market_fair", 0.0)
    result["edge"] = row.get("edge", 0.0)
    result["var"] = row.get("var", 0.0)
    return result


def _extract_position_at_timestamp(
    desired_pos_df: pl.DataFrame,
    timestamp: dt.datetime,
) -> dict[str, Any]:
    """Extract position values at a specific timestamp."""
    if desired_pos_df.is_empty():
        return {}
    row_df = desired_pos_df.filter(pl.col("timestamp") == timestamp)
    if row_df.height == 0:
        return {}
    row = row_df.row(0, named=True)
    return {
        "smoothed_edge": row.get("smoothed_edge", 0.0),
        "smoothed_var": row.get("smoothed_var", 0.0),
        "raw_desired_position": row.get("raw_desired_position", 0.0),
        "smoothed_desired_position": row.get("smoothed_desired_position", 0.0),
    }
