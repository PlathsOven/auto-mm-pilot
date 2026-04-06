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

        # Target-space conversion via selected transform or legacy fallback
        if unit_conversion is not None:
            conv_params = sc.get_conversion_params()
            expr = unit_conversion.fn("raw_value", **conv_params)
        else:
            expr = raw_to_target_expr("raw_value", sc.scale, sc.offset, sc.exponent)
        snap = snap.with_columns(expr.alias("target_value"))

        # Get conversion params for storing in block rows (needed by attach_market_values)
        conv_params = sc.get_conversion_params()

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
                # Store legacy fields for backward compat + attach_market_values
                "scale": sc.scale,
                "offset": sc.offset,
                "exponent": sc.exponent,
            }
            # Store all conversion params (for attach_market_values to use)
            for k, v in conv_params.items():
                entry[f"conv_{k}"] = v

            # Carry through all risk dimension cols from the row
            for rdc in risk_dimension_cols:
                entry[rdc] = row[rdc]

            rows.append(entry)

    return pl.DataFrame(rows)


# ---------------------------------------------------------------------------
# Stage 2: Attach market values
# ---------------------------------------------------------------------------

def attach_market_values(
    blocks_df: pl.DataFrame,
    market_pricing: dict[str, float],
    unit_conversion: TransformRegistration | None = None,
) -> pl.DataFrame:
    """Join market-implied values and convert to target space."""
    missing = set(blocks_df["space_id"].unique().to_list()) - set(market_pricing.keys())
    if missing:
        log.warning("Missing market pricing for spaces: %s — defaulting to 0.0", missing)
        market_pricing = dict(market_pricing)
        for sid in missing:
            market_pricing[sid] = 0.0

    market_df = pl.DataFrame({
        "space_id": list(market_pricing.keys()),
        "market_value": list(market_pricing.values()),
    })

    out = blocks_df.join(market_df, on="space_id", how="left")

    if unit_conversion is not None:
        # Apply the selected conversion function to market_value per-block.
        # Each block may have different conversion params (stored as conv_* columns).
        # We need to apply the transform row-by-row since params vary per block.
        # For efficiency, collect unique param sets and apply in batches.
        conv_param_cols = [c for c in out.columns if c.startswith("conv_")]
        if conv_param_cols:
            # Group blocks by their conversion params
            unique_params = out.select(conv_param_cols).unique()
            parts: list[pl.DataFrame] = []
            for param_row in unique_params.iter_rows(named=True):
                # Filter blocks with these params
                filter_expr = pl.lit(True)
                for col_name, val in param_row.items():
                    filter_expr = filter_expr & (pl.col(col_name) == val)
                subset = out.filter(filter_expr)

                # Build params dict (strip "conv_" prefix)
                params = {k[5:]: v for k, v in param_row.items()}
                expr = unit_conversion.fn("market_value", **params)
                subset = subset.with_columns(expr.alias("target_market_value"))
                parts.append(subset)
            out = pl.concat(parts)
        else:
            # No conv_ columns, use transform with no extra params
            expr = unit_conversion.fn("market_value")
            out = out.with_columns(expr.alias("target_market_value"))
    else:
        # Legacy: hardcoded formula
        out = out.with_columns(
            (pl.col("scale") * pl.col("market_value") + pl.col("offset"))
            .pow(pl.col("exponent"))
            .alias("target_market_value"),
        )

    # Validation
    null_count = out.filter(pl.col("target_value").is_null()).height
    if null_count > 0:
        raise ValueError(f"{null_count} blocks have null target_value")

    return out


# ---------------------------------------------------------------------------
# Stage 3: Build time grid (unchanged)
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
    market_pricing: dict[str, float],
    risk_dimension_cols: list[str],
    now: dt.datetime,
    bankroll: float,
    smoothing_hl_secs: int,
    time_grid_interval: str = "1m",
    transform_config: dict[str, Any] | None = None,
) -> dict[str, pl.DataFrame]:
    """Execute the full pipeline and return every intermediate as a dict.

    All pluggable steps are dispatched through the transform registry.
    Default selections reproduce the original hardcoded behaviour exactly.
    When *transform_config* is provided, overrides are applied first.

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

    blocks_df     = build_blocks_df(streams, risk_dimension_cols, unit_fn)
    blocks_df     = attach_market_values(blocks_df, market_pricing, unit_fn)
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
