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
          raw_value, target_value, target_market_value, space_id, etc.
        - current_agg: dict — total_fair, total_market_fair, edge, var.
        - current_position: dict — smoothed_edge, smoothed_var,
          raw_desired_position, smoothed_desired_position.
        - scenario: dict — bankroll, smoothing_hl_secs, now, risk_dimension.
    """
    blocks_df = results["blocks_df"]
    block_var_df = results["block_var_df"]
    desired_pos_df = results["desired_pos_df"]

    # --- block_summary: static per-block config (not time-varying) ---
    block_summary = _serialize_blocks_df(blocks_df, risk_dimension_cols)

    # --- Enrich block_summary with time-varying fair/market_fair at timestamp ---
    _enrich_block_summary_at_timestamp(block_summary, block_var_df, timestamp)

    # --- current_agg: single row from desired_pos_df at timestamp ---
    current_agg = _extract_agg_at_timestamp(desired_pos_df, timestamp, risk_dimension_cols)

    # --- current_position: smoothed values at timestamp ---
    current_position = _extract_position_at_timestamp(desired_pos_df, timestamp)

    # --- scenario ---
    # Build risk_dimension from the first matching row
    risk_dim = {}
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
        "current_agg": current_agg,
        "current_position": current_position,
        "scenario": scenario,
    }


def engine_state_from_pipeline(
    results: dict[str, pl.DataFrame],
    timestamp: dt.datetime,
    risk_dimension_cols: list[str],
) -> dict[str, Any]:
    """Build the engine state dict consumed by the investigation prompt.

    Returns a dict with:
        - positions: list of current desired positions per risk dimension
        - streams: list of active data stream statuses
        - context: global engine context
    """
    desired_pos_df = results["desired_pos_df"]
    blocks_df = results["blocks_df"]

    # --- positions ---
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

    # --- streams: derive from blocks_df unique stream names ---
    stream_names = blocks_df["stream_name"].unique().to_list()
    streams = [
        {
            "id": f"stream-{name}",
            "status": "active",
            "lastUpdate": _serialize_value(timestamp),
        }
        for name in sorted(stream_names)
    ]

    # --- context ---
    context = {
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
        "block_name", "stream_name", "space_id", "aggregation_logic",
        "raw_value", "market_value", "target_value", "target_market_value",
        "var_fair_ratio", "annualized", "size_type", "temporal_position",
        "decay_end_size_mult", "decay_rate_prop_per_min",
    ]
    # Only include columns that exist
    available = [c for c in summary_cols if c in blocks_df.columns]
    rows = blocks_df.select(available).to_dicts()
    for row in rows:
        for k, v in row.items():
            row[k] = _serialize_value(v)
    return rows


def _enrich_block_summary_at_timestamp(
    block_summary: list[dict[str, Any]],
    block_var_df: pl.DataFrame,
    timestamp: dt.datetime,
) -> None:
    """Add time-varying fair/market_fair values to block_summary in place."""
    ts_slice = block_var_df.filter(pl.col("timestamp") == timestamp)
    if ts_slice.height == 0:
        return

    # Build lookup: block_name → {fair, market_fair, var}
    lookup: dict[str, dict[str, float]] = {}
    for row in ts_slice.iter_rows(named=True):
        lookup[row["block_name"]] = {
            "fair": row.get("fair", 0.0),
            "market_fair": row.get("market_fair", 0.0),
            "var": row.get("var", 0.0),
        }

    for block in block_summary:
        bn = block.get("block_name", "")
        if bn in lookup:
            block.update(lookup[bn])


def _extract_agg_at_timestamp(
    desired_pos_df: pl.DataFrame,
    timestamp: dt.datetime,
    risk_dimension_cols: list[str],
) -> dict[str, Any]:
    """Extract aggregated values at a specific timestamp."""
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
