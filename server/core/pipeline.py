"""
Core pipeline: data streams → desired position.

Implements MVP steps 4–6:
  4. Target-space unit conversion
  5. Timestamp × fair value computation
  6. Desired position simulation

Each function corresponds to a discrete pipeline stage.  ``run_pipeline``
orchestrates all stages and returns every intermediate as a dict of
Polars DataFrames.

When a ``transform_config`` dict is provided, the pipeline dispatches each
pluggable step to the selected function from the transform registry.
When omitted, it falls back to the original hardcoded implementations for
full backward compatibility.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

import polars as pl

log = logging.getLogger(__name__)

from server.core.config import SECONDS_PER_YEAR, StreamConfig
from server.core.helpers import annualize, deannualize, raw_to_target_expr
from server.core.transforms.registry import TransformRegistration


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
# Legacy stage functions (kept for backward compatibility)
# ---------------------------------------------------------------------------

def _get_end_timestamp(
    start_ts: dt.datetime,
    expiry: dt.datetime,
    decay_end_size_mult: float,
    decay_rate_prop_per_min: float,
) -> dt.datetime:
    if decay_end_size_mult == 1 or decay_rate_prop_per_min == 0:
        return expiry
    return start_ts + dt.timedelta(minutes=1 / decay_rate_prop_per_min)


def _get_total_value(
    stream_value: float,
    market_value: float,
    start_ts: dt.datetime,
    end_ts: dt.datetime,
    is_annualized: bool,
    size_type: str,
) -> float:
    if is_annualized:
        ann_val = stream_value if size_type == "fixed" else stream_value - market_value
        return deannualize(ann_val, (end_ts - start_ts).total_seconds())
    return stream_value


def _get_start_annualized_value(
    total_value: float,
    expiry: dt.datetime,
    start_ts: dt.datetime,
    end_ts: dt.datetime,
    end_annualized_value: float,
    is_annualized: bool,
) -> float:
    start_to_expiry_secs = (expiry - start_ts).total_seconds()
    start_to_end_secs = (end_ts - start_ts).total_seconds()
    ann_val = annualize(total_value, start_to_end_secs)

    if is_annualized:
        start_to_end_secs = min(start_to_expiry_secs, start_to_end_secs)
        p = start_to_end_secs / start_to_expiry_secs
        return (2 / p) * (ann_val - (1 - p) * end_annualized_value) - end_annualized_value
    return ann_val


def compute_block_fair_values(
    blocks_df: pl.DataFrame,
    time_grid: pl.DataFrame,
    risk_dimension_cols: list[str],
    now: dt.datetime,
) -> pl.DataFrame:
    """Legacy: compute block fair values with hardcoded linear decay."""
    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        block_name = row["block_name"]
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        end_ts = _get_end_timestamp(start_ts, expiry, row["decay_end_size_mult"], row["decay_rate_prop_per_min"])

        target_val = row["target_value"]
        target_mkt = row["target_market_value"]

        total_val = _get_total_value(target_val, target_mkt, start_ts, end_ts, is_ann, row["size_type"])
        dur_secs = (end_ts - start_ts).total_seconds()
        end_ann = annualize(total_val, dur_secs) * row["decay_end_size_mult"]
        start_ann = _get_start_annualized_value(total_val, expiry, start_ts, end_ts, end_ann, is_ann)

        mkt_total = _get_total_value(target_mkt, target_mkt, start_ts, end_ts, is_ann, row["size_type"])
        mkt_end_ann = annualize(mkt_total, dur_secs) * row["decay_end_size_mult"]
        mkt_start_ann = _get_start_annualized_value(mkt_total, expiry, start_ts, end_ts, mkt_end_ann, is_ann)

        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])

        block_df = grid_filter.select(risk_dimension_cols + ["timestamp", "dtte"]).with_columns(
            (
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .when(pl.col("timestamp") > end_ts).then(end_ann)
                .when(pl.lit(is_ann)).then(
                    start_ann + (end_ann - start_ann)
                    * (pl.col("timestamp") - start_ts) / (end_ts - start_ts)
                )
                .otherwise(start_ann)
            ).alias("fair_annualized"),
            (
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .when(pl.col("timestamp") > end_ts).then(mkt_end_ann)
                .when(pl.lit(is_ann)).then(
                    mkt_start_ann + (mkt_end_ann - mkt_start_ann)
                    * (pl.col("timestamp") - start_ts) / (end_ts - start_ts)
                )
                .otherwise(mkt_start_ann)
            ).alias("market_fair_annualized"),
            pl.lit(block_name).alias("block_name"),
            pl.lit(row["stream_name"]).alias("stream_name"),
            pl.lit(row["space_id"]).alias("space_id"),
            pl.lit(row["aggregation_logic"]).alias("aggregation_logic"),
            pl.lit(row["var_fair_ratio"]).alias("var_fair_ratio"),
        ).with_columns(
            (pl.col("fair_annualized") * pl.col("dtte")).alias("fair"),
            (pl.col("market_fair_annualized") * pl.col("dtte")).alias("market_fair"),
        )

        parts.append(block_df)

    return pl.concat(parts)


def compute_block_variances(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    """Legacy: variance = abs(fair) * var_fair_ratio."""
    return block_fair_df.with_columns(
        (pl.col("fair").abs() * pl.col("var_fair_ratio")).alias("var"),
    )


def aggregate_by_space(
    block_df: pl.DataFrame,
    risk_dimension_cols: list[str],
) -> pl.DataFrame:
    """Legacy: average/offset aggregation."""
    group_keys = risk_dimension_cols + ["timestamp", "space_id"]

    avg_df = block_df.filter(pl.col("aggregation_logic") == "average")
    off_df = block_df.filter(pl.col("aggregation_logic") == "offset")

    if avg_df.height > 0:
        avg_agg = avg_df.group_by(group_keys).agg(
            pl.col("fair").mean().alias("avg_fair"),
            pl.col("market_fair").mean().alias("avg_market_fair"),
        )
    else:
        schema = {c: block_df.schema[c] for c in group_keys}
        schema.update({"avg_fair": pl.Float64, "avg_market_fair": pl.Float64})
        avg_agg = pl.DataFrame(schema=schema)

    if off_df.height > 0:
        off_agg = off_df.group_by(group_keys).agg(
            pl.col("fair").sum().alias("off_fair"),
            pl.col("market_fair").sum().alias("off_market_fair"),
        )
    else:
        schema = {c: block_df.schema[c] for c in group_keys}
        schema.update({"off_fair": pl.Float64, "off_market_fair": pl.Float64})
        off_agg = pl.DataFrame(schema=schema)

    var_agg = block_df.group_by(group_keys).agg(
        pl.col("var").sum().alias("space_var"),
    )

    space_df = var_agg.join(avg_agg, on=group_keys, how="left")
    space_df = space_df.join(off_agg, on=group_keys, how="left")
    space_df = space_df.with_columns(
        pl.col("avg_fair").fill_null(0.0),
        pl.col("avg_market_fair").fill_null(0.0),
        pl.col("off_fair").fill_null(0.0),
        pl.col("off_market_fair").fill_null(0.0),
    ).with_columns(
        (pl.col("avg_fair") + pl.col("off_fair")).alias("space_fair"),
        (pl.col("avg_market_fair") + pl.col("off_market_fair")).alias("space_market_fair"),
    ).with_columns(
        (pl.col("space_fair") - pl.col("space_market_fair")).alias("space_edge"),
    )

    rd_ts_keys = risk_dimension_cols + ["timestamp"]
    total = space_df.group_by(rd_ts_keys).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_edge").sum().alias("edge"),
        pl.col("space_var").sum().alias("var"),
    ).sort(rd_ts_keys)

    return total


def compute_desired_position(
    agg_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    bankroll: float,
    smoothing_hl_secs: int,
) -> pl.DataFrame:
    """Legacy: forward EWM smoothing + Kelly position sizing."""
    VAR_FLOOR = 1e-18
    hl = f"{smoothing_hl_secs}s"

    out = agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(
        pl.col("edge")
        .reverse()
        .ewm_mean_by("timestamp", half_life=hl)
        .reverse()
        .over(risk_dimension_cols)
        .alias("smoothed_edge"),
        pl.col("var")
        .reverse()
        .ewm_mean_by("timestamp", half_life=hl)
        .reverse()
        .over(risk_dimension_cols)
        .alias("smoothed_var"),
    )

    out = out.with_columns(
        pl.when(pl.col("var").abs() < VAR_FLOOR)
        .then(0.0)
        .otherwise(pl.col("edge") * bankroll / pl.col("var"))
        .alias("raw_desired_position"),
    )

    out = out.with_columns(
        pl.when(pl.col("smoothed_var").abs() < VAR_FLOOR)
        .then(0.0)
        .otherwise(pl.col("smoothed_edge") * bankroll / pl.col("smoothed_var"))
        .alias("smoothed_desired_position"),
    )

    return out


# ---------------------------------------------------------------------------
# Transform-aware position sizing helper
# ---------------------------------------------------------------------------

def _apply_position_sizing(
    df: pl.DataFrame,
    bankroll: float,
    pos_fn: TransformRegistration,
    pos_params: dict[str, Any],
) -> pl.DataFrame:
    """Apply position sizing to both raw and smoothed edge/var."""
    VAR_FLOOR = 1e-18
    return df.with_columns(
        pl.when(pl.col("var").abs() < VAR_FLOOR)
        .then(0.0)
        .otherwise(pos_fn.fn(pl.col("edge"), pl.col("var"), bankroll, **pos_params))
        .alias("raw_desired_position"),
        pl.when(pl.col("smoothed_var").abs() < VAR_FLOOR)
        .then(0.0)
        .otherwise(pos_fn.fn(pl.col("smoothed_edge"), pl.col("smoothed_var"), bankroll, **pos_params))
        .alias("smoothed_desired_position"),
    )


# ---------------------------------------------------------------------------
# Config application helper
# ---------------------------------------------------------------------------

def _apply_config(registry: Any, config: dict[str, Any]) -> None:
    """Apply a transform_config dict to the registry."""
    for step_name in registry.list_steps():
        if step_name in config:
            registry.get_step(step_name).select(config[step_name])
        params_key = f"{step_name}_params"
        if params_key in config and config[params_key]:
            registry.get_step(step_name).set_param_values(config[params_key])


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

    When *transform_config* is provided, dispatches each pluggable step to
    the selected function from the transform registry.  When omitted,
    uses the original hardcoded implementations for backward compatibility.

    Keys:
        blocks_df        — one row per block (flat config + target values)
        time_grid        — timestamp grid per risk dimension
        block_fair_df    — long-format fair / market_fair per (timestamp, block)
        block_var_df     — above + variance column
        space_agg_df     — one row per (risk_dimension, timestamp), aggregated across spaces
        desired_pos_df   — above + smoothed_edge, smoothed_var, raw & smoothed desired position
    """
    if transform_config is not None:
        # --- Transform-registry path ---
        from server.core.transforms import get_registry

        registry = get_registry()
        _apply_config(registry, transform_config)

        unit_fn   = registry.get_step("unit_conversion").get_selected()
        decay_fn  = registry.get_step("decay_profile").get_selected()
        fair_fn   = registry.get_step("temporal_fair_value").get_selected()
        var_fn    = registry.get_step("variance").get_selected()
        agg_fn    = registry.get_step("aggregation").get_selected()
        pos_fn    = registry.get_step("position_sizing").get_selected()
        smooth_fn = registry.get_step("smoothing").get_selected()

        blocks_df    = build_blocks_df(streams, risk_dimension_cols, unit_fn)
        blocks_df    = attach_market_values(blocks_df, market_pricing, unit_fn)
        time_grid    = build_time_grid(blocks_df, risk_dimension_cols, now, interval=time_grid_interval)

        fair_params  = registry.get_step("temporal_fair_value").get_param_values()
        block_fair_df = fair_fn.fn(blocks_df, time_grid, risk_dimension_cols, now, decay_fn, **fair_params)

        var_params   = registry.get_step("variance").get_param_values()
        block_var_df = var_fn.fn(block_fair_df, **var_params)

        agg_params   = registry.get_step("aggregation").get_param_values()
        space_agg_df = agg_fn.fn(block_var_df, risk_dimension_cols, **agg_params)

        smooth_params = registry.get_step("smoothing").get_param_values()
        smoothed_df   = smooth_fn.fn(space_agg_df, risk_dimension_cols, **smooth_params)

        pos_params    = registry.get_step("position_sizing").get_param_values()
        desired_pos_df = _apply_position_sizing(smoothed_df, bankroll, pos_fn, pos_params)
    else:
        # --- Legacy path (full backward compatibility) ---
        blocks_df      = build_blocks_df(streams, risk_dimension_cols)
        blocks_df      = attach_market_values(blocks_df, market_pricing)
        time_grid      = build_time_grid(blocks_df, risk_dimension_cols, now, interval=time_grid_interval)
        block_fair_df  = compute_block_fair_values(blocks_df, time_grid, risk_dimension_cols, now)
        block_var_df   = compute_block_variances(block_fair_df)
        space_agg_df   = aggregate_by_space(block_var_df, risk_dimension_cols)
        desired_pos_df = compute_desired_position(space_agg_df, risk_dimension_cols, bankroll, smoothing_hl_secs)

    return {
        "blocks_df": blocks_df,
        "time_grid": time_grid,
        "block_fair_df": block_fair_df,
        "block_var_df": block_var_df,
        "space_agg_df": space_agg_df,
        "desired_pos_df": desired_pos_df,
    }
