"""
Core pipeline: data streams → desired position.

Each function corresponds to a discrete pipeline stage.  ``run_pipeline``
orchestrates all stages and returns every intermediate as a dict of
Polars DataFrames.

All pluggable steps are dispatched through the transform registry.
Default selections reproduce the original hardcoded behaviour exactly.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

import polars as pl

log = logging.getLogger(__name__)

from server.core.config import SECONDS_PER_YEAR, StreamConfig
from server.core.helpers import raw_to_target_expr
from server.core.transforms import TransformRegistration, from_dict, get_step


# ---------------------------------------------------------------------------
# Stage 1: Build blocks DataFrame
# ---------------------------------------------------------------------------

def build_blocks_df(
    streams: list[StreamConfig],
    risk_dimension_cols: list[str],
    unit_conversion: TransformRegistration | None = None,
) -> pl.DataFrame:
    """Flatten stream configs into one row per block with all needed columns.

    When *unit_conversion* is provided, uses it for the raw → target conversion.
    Otherwise falls back to the legacy ``raw_to_target_expr``.
    """
    rows: list[dict] = []
    for sc in streams:
        missing = set(risk_dimension_cols) - set(sc.key_cols)
        if missing:
            raise ValueError(
                f"Stream '{sc.stream_name}' key_cols {sc.key_cols} "
                f"missing risk_dimension_cols: {missing}"
            )

        extra_keys = [k for k in sc.key_cols if k not in risk_dimension_cols]
        snap = sc.snapshot.sort("timestamp").group_by(sc.key_cols).agg(pl.all().last())

        # Ensure start_timestamp column exists
        if "start_timestamp" not in snap.columns:
            snap = snap.with_columns(pl.lit(None).cast(pl.Datetime("us")).alias("start_timestamp"))

        # Track whether each row has a user-defined market_value before fill
        if "market_value" not in snap.columns:
            snap = snap.with_columns(
                pl.lit(False).alias("has_user_market_value"),
                pl.col("raw_value").alias("market_value"),
            )
        else:
            snap = snap.with_columns(
                pl.col("market_value").is_not_null().alias("has_user_market_value"),
                pl.col("market_value").fill_null(pl.col("raw_value")),
            )

        # Target-space conversion via selected transform or legacy fallback.
        # Apply the same conversion to both raw_value and market_value.
        conv_params = sc.get_conversion_params()
        if unit_conversion is not None:
            val_expr = unit_conversion.fn("raw_value", **conv_params)
            mkt_expr = unit_conversion.fn("market_value", **conv_params)
        else:
            val_expr = raw_to_target_expr("raw_value", sc.scale, sc.offset, sc.exponent)
            mkt_expr = raw_to_target_expr("market_value", sc.scale, sc.offset, sc.exponent)
        snap = snap.with_columns(
            val_expr.alias("target_value"),
            mkt_expr.alias("target_market_value"),
        )

        for row in snap.iter_rows(named=True):
            block_name = "_".join([sc.stream_name] + [str(row[k]) for k in extra_keys])

            # Assign space_id (with optional override from StreamConfig)
            if sc.space_id_override is not None:
                space_id = sc.space_id_override
            elif sc.block.temporal_position == "shifting":
                space_id = "shifting"
            else:
                st = row["start_timestamp"]
                if st is None:
                    raise ValueError(f"start_timestamp required for static block {block_name}")
                space_id = f"static_{st.strftime('%Y%m%d_%H%M%S')}"

            entry = {
                "block_name": block_name,
                "stream_name": sc.stream_name,
                "target_value": row["target_value"],
                "raw_value": row["raw_value"],
                "market_value": row["market_value"],
                "target_market_value": row["target_market_value"],
                "has_user_market_value": row["has_user_market_value"],
                "start_timestamp": row.get("start_timestamp"),
                "space_id": space_id,
                # Block config fields (flat)
                "annualized": sc.block.annualized,
                "size_type": sc.block.size_type,
                "aggregation_logic": sc.block.aggregation_logic,
                "temporal_position": sc.block.temporal_position,
                "decay_end_size_mult": sc.block.decay_end_size_mult,
                "decay_rate_prop_per_min": sc.block.decay_rate_prop_per_min,
                "var_fair_ratio": sc.block.var_fair_ratio,
                "scale": sc.scale,
                "offset": sc.offset,
                "exponent": sc.exponent,
            }

            # Carry through all risk dimension cols from the row
            for rdc in risk_dimension_cols:
                entry[rdc] = row[rdc]

            rows.append(entry)

    return pl.DataFrame(rows)


# ---------------------------------------------------------------------------
# Stage 2: Build time grid
# ---------------------------------------------------------------------------

def _pick_grid_interval(ttx_secs: float, default: str) -> str:
    """Choose a time-grid interval for a single risk dimension."""
    if ttx_secs <= 2 * 86_400:
        return default
    if ttx_secs <= 30 * 86_400:
        return "15m"
    if ttx_secs <= 365 * 86_400:
        return "1h"
    return "4h"


def build_time_grid(
    blocks_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    now: dt.datetime,
    interval: str = "1m",
) -> pl.DataFrame:
    """Create a time grid per unique risk dimension."""
    if "expiry" not in blocks_df.columns:
        raise ValueError("blocks_df must contain an 'expiry' column to build time grids")

    unique_dims = blocks_df.select(risk_dimension_cols).unique()
    parts: list[pl.DataFrame] = []

    for row in unique_dims.iter_rows(named=True):
        expiry = row["expiry"]
        ttx_secs = (expiry - now).total_seconds()
        dim_interval = _pick_grid_interval(ttx_secs, interval)
        timestamps = pl.datetime_range(start=now, end=expiry, interval=dim_interval, eager=True)
        grid = pl.DataFrame({"timestamp": timestamps})

        for rdc in risk_dimension_cols:
            grid = grid.with_columns(pl.lit(row[rdc]).alias(rdc))

        grid = grid.with_columns(
            dtte=-pl.col("timestamp").diff(-1).dt.total_seconds() / SECONDS_PER_YEAR,
        )
        parts.append(grid)

    return pl.concat(parts)


# ---------------------------------------------------------------------------
# Full pipeline orchestrator
# ---------------------------------------------------------------------------

def run_pipeline(
    streams: list[StreamConfig],
    risk_dimension_cols: list[str],
    now: dt.datetime,
    bankroll: float,
    smoothing_hl_secs: int,
    time_grid_interval: str = "1m",
    transform_config: dict[str, Any] | None = None,
    aggregate_market_values: dict[tuple[str, str], float] | None = None,
) -> dict[str, pl.DataFrame]:
    """Execute the full pipeline and return every intermediate as a dict.

    All pluggable steps are dispatched through the transform registry.
    Default selections reproduce the original hardcoded behaviour exactly.
    When *transform_config* is provided, overrides are applied first.

    Market pricing is now per-block: each snapshot row carries an optional
    ``market_value`` field (defaults to ``raw_value`` when absent).
    ``build_blocks_df`` converts it through the same unit transform as
    ``raw_value``, producing ``target_market_value`` inline — no separate
    join stage needed.

    Keys:
        blocks_df        — one row per block (flat config + target values)
        time_grid        — timestamp grid per risk dimension
        block_fair_df    — long-format fair / market_fair per (timestamp, block)
        block_var_df     — above + variance column
        space_agg_df     — one row per (risk_dimension, timestamp), aggregated across spaces
        desired_pos_df   — above + smoothed_edge, smoothed_var, raw & smoothed desired position
    """
    # Reset registry to defaults, then apply any overrides
    from_dict(transform_config or {})

    # Honour the smoothing_hl_secs param when no explicit smoothing override
    if not transform_config or "smoothing_params" not in transform_config:
        get_step("smoothing").set_param_values({"half_life_secs": smoothing_hl_secs})

    unit_fn   = get_step("unit_conversion").get_selected()
    decay_fn  = get_step("decay_profile").get_selected()
    fair_fn   = get_step("temporal_fair_value").get_selected()
    var_fn    = get_step("variance").get_selected()
    agg_fn    = get_step("aggregation").get_selected()
    pos_fn    = get_step("position_sizing").get_selected()
    smooth_fn = get_step("smoothing").get_selected()
    mvi_fn    = get_step("market_value_inference").get_selected()

    blocks_df     = build_blocks_df(streams, risk_dimension_cols, unit_fn)

    # Market value inference: distribute aggregate total vol to blocks
    blocks_df     = mvi_fn.fn(
        blocks_df, aggregate_market_values or {}, unit_fn,
        **get_step("market_value_inference").get_param_values(),
    )

    time_grid     = build_time_grid(blocks_df, risk_dimension_cols, now, interval=time_grid_interval)

    block_fair_df = fair_fn.fn(
        blocks_df, time_grid, risk_dimension_cols, now, decay_fn,
        **get_step("temporal_fair_value").get_param_values(),
    )
    block_var_df  = var_fn.fn(block_fair_df, **get_step("variance").get_param_values())
    space_agg_df  = agg_fn.fn(
        block_var_df, risk_dimension_cols, **get_step("aggregation").get_param_values(),
    )
    smoothed_df   = smooth_fn.fn(
        space_agg_df, risk_dimension_cols, **get_step("smoothing").get_param_values(),
    )

    # Position sizing
    VAR_FLOOR = 1e-18
    pos_params = get_step("position_sizing").get_param_values()
    desired_pos_df = smoothed_df.with_columns(
        pl.when(pl.col("var").abs() < VAR_FLOOR).then(0.0)
        .otherwise(pos_fn.fn(pl.col("edge"), pl.col("var"), bankroll, **pos_params))
        .alias("raw_desired_position"),
        pl.when(pl.col("smoothed_var").abs() < VAR_FLOOR).then(0.0)
        .otherwise(pos_fn.fn(pl.col("smoothed_edge"), pl.col("smoothed_var"), bankroll, **pos_params))
        .alias("smoothed_desired_position"),
    )

    return {
        "blocks_df": blocks_df,
        "time_grid": time_grid,
        "block_fair_df": block_fair_df,
        "block_var_df": block_var_df,
        "space_agg_df": space_agg_df,
        "desired_pos_df": desired_pos_df,
    }
