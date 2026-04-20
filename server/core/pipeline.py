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

    The block row carries only the stream-fair-value view (``raw_value`` →
    ``target_value``). Market-implied value is no longer a per-block quantity
    — it lives at the space level and is applied downstream in
    ``market_value_inference``.
    """
    parts: list[pl.DataFrame] = []
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

        # Target-space conversion via selected transform or legacy fallback.
        conv_params = sc.get_conversion_params()
        if unit_conversion is not None:
            val_expr = unit_conversion.fn("raw_value", **conv_params)
        else:
            val_expr = raw_to_target_expr("raw_value", sc.scale, sc.offset, sc.exponent)
        snap = snap.with_columns(val_expr.alias("target_value"))

        # block_name = stream_name + (optional extra_key cells joined by "_")
        if extra_keys:
            block_name_expr = pl.concat_str(
                [pl.lit(sc.stream_name)] + [pl.col(k).cast(pl.Utf8) for k in extra_keys],
                separator="_",
            )
        else:
            block_name_expr = pl.lit(sc.stream_name)

        # space_id: override > shifting > formatted start_timestamp
        if sc.space_id_override is not None:
            space_id_expr = pl.lit(sc.space_id_override)
        elif sc.block.temporal_position == "shifting":
            space_id_expr = pl.lit("shifting")
        else:
            null_rows = snap.filter(pl.col("start_timestamp").is_null())
            if null_rows.height > 0:
                bad = null_rows.row(0, named=True)
                bad_name = "_".join([sc.stream_name] + [str(bad[k]) for k in extra_keys])
                raise ValueError(f"start_timestamp required for static block {bad_name}")
            space_id_expr = pl.lit("static_") + pl.col("start_timestamp").dt.strftime("%Y%m%d_%H%M%S")

        block_df = snap.select(
            block_name_expr.alias("block_name"),
            pl.lit(sc.stream_name).alias("stream_name"),
            pl.col("target_value"),
            pl.col("raw_value"),
            pl.col("start_timestamp"),
            space_id_expr.alias("space_id"),
            pl.lit(sc.block.annualized).alias("annualized"),
            pl.lit(sc.block.temporal_position).alias("temporal_position"),
            pl.lit(sc.block.decay_end_size_mult).alias("decay_end_size_mult"),
            pl.lit(sc.block.decay_rate_prop_per_min).alias("decay_rate_prop_per_min"),
            pl.lit(sc.block.var_fair_ratio).alias("var_fair_ratio"),
            pl.lit(sc.scale).alias("scale"),
            pl.lit(sc.offset).alias("offset"),
            pl.lit(sc.exponent).cast(pl.Float64).alias("exponent"),
            *[pl.col(rdc) for rdc in risk_dimension_cols],
        )
        parts.append(block_df)

    if not parts:
        return pl.DataFrame()
    return pl.concat(parts)


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
    space_market_values: dict[tuple[str, str, str], float] | None = None,
) -> dict[str, pl.DataFrame]:
    """Execute the full pipeline and return every intermediate as a dict.

    All pluggable steps are dispatched through the transform registry.
    Default selections reproduce the original hardcoded behaviour exactly.
    When *transform_config* is provided, overrides are applied first.

    Market-implied value is modelled at the space level (one value per
    ``(symbol, expiry, space_id)``). Users provide either:
      * ``aggregate_market_values`` — ``{(symbol, expiry_key): total_vol}``,
        distributed to spaces by the ``market_value_inference`` step
        proportional to each space's forward fair shape; OR
      * ``space_market_values`` — ``{(symbol, expiry_key, space_id): vol}``,
        an explicit per-space override that bypasses inference for those
        spaces and feeds the remainder to the aggregate allocator.

    When neither is set, the default is zero edge at every timestamp —
    each space's market_fair curve equals its own fair curve.

    Keys:
        blocks_df        — one row per block (flat config + target value)
        time_grid        — timestamp grid per risk dimension
        block_fair_df    — long-format fair per (timestamp, block)
        block_var_df     — above + variance column
        space_agg_df     — per (risk_dim, space_id, timestamp): space_fair,
                           space_var, space_market_fair (post-inference)
        desired_pos_df   — per (risk_dim, timestamp): total_fair,
                           total_market_fair, edge, var, smoothed_edge,
                           smoothed_var, raw & smoothed desired position
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
    mvi_fn    = get_step("market_value_inference").get_selected()
    agg_fn    = get_step("aggregation").get_selected()
    pos_fn    = get_step("position_sizing").get_selected()
    smooth_fn = get_step("smoothing").get_selected()

    blocks_df     = build_blocks_df(streams, risk_dimension_cols, unit_fn)
    time_grid     = build_time_grid(blocks_df, risk_dimension_cols, now, interval=time_grid_interval)

    block_fair_df = fair_fn.fn(
        blocks_df, time_grid, risk_dimension_cols, now, decay_fn,
        **get_step("temporal_fair_value").get_param_values(),
    )
    block_var_df  = var_fn.fn(block_fair_df, **get_step("variance").get_param_values())

    # Space-level aggregation + market-fair inference. The mvi step collapses
    # block_var_df to per-(risk_dim, space_id, timestamp) rows and attaches
    # ``space_market_fair`` — either defaulted to ``space_fair`` (edge-zero
    # default), allocated from user-set per-space values, or inferred from
    # the aggregate ``total_vol`` via the time-varying allocator.
    space_agg_df = mvi_fn.fn(
        block_var_df,
        risk_dimension_cols,
        aggregate_market_values or {},
        space_market_values or {},
        now,
        **get_step("market_value_inference").get_param_values(),
    )

    # Edge aggregation: sum all spaces within a risk dimension to produce
    # total_fair, total_market_fair, edge, var per (risk_dim, timestamp).
    agg_df = agg_fn.fn(
        space_agg_df, risk_dimension_cols,
        **get_step("aggregation").get_param_values(),
    )

    # Vol-point conversion (before smoothing). The aggregation step emits
    # variance-unit columns (per-t, dtte-weighted). Traders reason in vol
    # points — for ATM options the PnL is linear in vol (constant vega), so
    # edge should be a direct vol-point difference, not a signed sqrt of
    # the variance-unit edge.
    #
    # For each non-negative column X (var, total_fair, total_market_fair):
    #   X_fwd(t) = Σ_{t' ≥ t in same risk_dim} X(t')
    #   X_vp(t)  = √(X_fwd(t) / T_years_remaining(t)) · 100
    # Then define edge directly in vp space:
    #   edge_vp(t) = total_fair_vp(t) - total_market_fair_vp(t)
    # Smoothing and position sizing both operate on these vp columns.
    VOL_POINTS_SCALE = 100.0
    _non_neg_sources = ("var", "total_fair", "total_market_fair")
    _t_years_expr = (
        (pl.col("expiry").cast(pl.Datetime("us")) - pl.col("timestamp"))
        .dt.total_seconds() / SECONDS_PER_YEAR
    )
    vp_df = (
        agg_df
        # Reverse-cumulative sum per (risk_dim): sort descending by timestamp
        # within each group, cum_sum, then re-sort ascending.
        .sort(risk_dimension_cols + ["timestamp"],
              descending=[False] * len(risk_dimension_cols) + [True])
        .with_columns([
            pl.col(c).cum_sum().over(risk_dimension_cols).alias(f"_fwd_{c}")
            for c in _non_neg_sources
        ])
        .sort(risk_dimension_cols + ["timestamp"])
        .with_columns(_t_years_expr.alias("_t_years_remaining"))
        .with_columns([
            pl.when(pl.col("_t_years_remaining") <= 0.0)
            .then(0.0)
            .otherwise(
                (pl.col(f"_fwd_{c}") / pl.col("_t_years_remaining")).sqrt()
                * VOL_POINTS_SCALE
            )
            .fill_null(0.0)
            .alias(f"{c}_vp")
            for c in _non_neg_sources
        ])
        .with_columns(
            (pl.col("total_fair_vp") - pl.col("total_market_fair_vp")).alias("edge_vp"),
        )
        # Replace variance-unit columns with their vp counterparts. From
        # here on, the pipeline works exclusively in vol points — smoothing
        # smooths vp values, Kelly runs vp ÷ vp.
        .drop(["edge", "var", "total_fair", "total_market_fair"])
        .rename({
            "edge_vp": "edge",
            "var_vp": "var",
            "total_fair_vp": "total_fair",
            "total_market_fair_vp": "total_market_fair",
        })
        .drop([f"_fwd_{c}" for c in _non_neg_sources] + ["_t_years_remaining"])
    )

    smoothed_df = smooth_fn.fn(
        vp_df, risk_dimension_cols, **get_step("smoothing").get_param_values(),
    )

    # Position sizing — Kelly in vp space (edge and variance both in vol
    # points). ``VAR_FLOOR`` is expressed in vp; 1e-6 is ~1e-4 bps, well
    # below any realistic variance, and catches the degenerate edge-to-
    # expiry tail where the forward integral approaches zero.
    VAR_FLOOR = 1e-6
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
