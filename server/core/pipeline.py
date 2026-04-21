"""
Core pipeline: data streams → desired position.

Organised around the four spaces: **risk / raw / calculation / target**.

Stages:
  A. Block expansion — dedup snapshots, compute block_name + space_id,
     run variance → raw_var, apply unit_conversion per stream to produce
     calc_fair_total / calc_var_total / calc_market_total, fan out each
     block via applies_to.
  B. Time distribution — temporal_fair_value distributes each total into
     per-timestamp fair / var / market columns (market is overridden by
     market_value_source: passthrough → fair, aggregate → null).
  C. Risk-space aggregation — mean of fair / var / market over blocks
     sharing a (risk_dim, space_id), per timestamp.
  D. Market inference + sum across spaces — market_value_inference fills
     null space_market_fair (aggregate source); aggregation sums across
     spaces to per-(risk_dim, timestamp) totals in calc space.
  E. Calc → target — forward map (default annualised_sqrt); edge computed
     in target space.
  F. Smoothing — forward EWM on edge and var.
  G. Position sizing — default Kelly = edge * bankroll / var.

All pluggable steps dispatch through the transform registry. Default
selections match the spec exactly and reproduce today's options numbers
(unit_conversion=affine_power exponent=2, calc_to_target=annualised_sqrt).
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

import polars as pl

from server.api.expiry import canonical_expiry_key
from server.core.config import SECONDS_PER_YEAR, StreamConfig
from server.core.transforms import TransformRegistration, from_dict, get_step

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stage A: Block expansion (dedup + metadata + variance + unit_conversion + fan-out)
# ---------------------------------------------------------------------------

def build_blocks_df(
    streams: list[StreamConfig],
    risk_dimension_cols: list[str],
    unit_fn: TransformRegistration,
    var_fn: TransformRegistration,
    var_params: dict[str, Any],
) -> pl.DataFrame:
    """Flatten stream configs into one row per ``(block × applied_dim)``.

    Produces ``blocks_df`` with scalar columns:
      raw_fair, raw_var, raw_market, calc_fair_total, calc_var_total,
      calc_market_total, block_name, stream_name, space_id,
      var_fair_ratio, annualized, temporal_position, decay_end_size_mult,
      decay_rate_prop_per_min, scale, offset, exponent, start_timestamp,
      plus the risk dimension columns (symbol, expiry, ...).

    Each stream's raw snapshot is deduplicated to the latest row per
    ``key_cols``, variance is computed in raw space, and unit_conversion
    is applied per-stream to produce the three calc totals. The resulting
    rows are then expanded along the risk dimensions according to how the
    snapshot is shaped:

    * **Scalar snap** (one row after dedup) — fanned out via cross-join to
      every dim in ``applies_to`` (defaults to the full dim universe).
      This supports streams whose single value should apply to every cell.
    * **Per-dim snap** (multiple rows after dedup) — each row stays on its
      native ``(symbol, expiry, ...)`` pair. ``applies_to=None`` means
      "pass through every native dim", and an explicit list acts as an
      inner-join filter on those native dims.

    Raises ``ValueError`` if any stream's ``applies_to`` names a dim not
    in the universe.
    """
    # Pass 1: dedup, collect dim universe, compute metadata and calc totals.
    # The canonical-key set normalises expiry to its ISO string so JSON-
    # supplied applies_to entries (strings from the API) match snapshot
    # values (datetime objects from Polars).
    per_stream_dfs: list[tuple[StreamConfig, pl.DataFrame]] = []
    dim_universe_set: set[tuple] = set()
    dim_universe_canon: set[tuple[str, ...]] = set()

    def _canon_dim(values: tuple) -> tuple[str, ...]:
        canon: list[str] = []
        for c, v in zip(risk_dimension_cols, values):
            if c == "expiry":
                canon.append(canonical_expiry_key(v))
            else:
                canon.append(str(v))
        return tuple(canon)

    for sc in streams:
        missing = set(risk_dimension_cols) - set(sc.key_cols)
        if missing:
            raise ValueError(
                f"Stream '{sc.stream_name}' key_cols {sc.key_cols} "
                f"missing risk_dimension_cols: {missing}"
            )

        snap = sc.snapshot.sort("timestamp").group_by(sc.key_cols).agg(pl.all().last())
        if "start_timestamp" not in snap.columns:
            snap = snap.with_columns(
                pl.lit(None).cast(pl.Datetime("us")).alias("start_timestamp"),
            )

        for row in snap.iter_rows(named=True):
            dim_tuple = tuple(row[c] for c in risk_dimension_cols)
            dim_universe_set.add(dim_tuple)
            dim_universe_canon.add(_canon_dim(dim_tuple))

        extra_keys = [k for k in sc.key_cols if k not in risk_dimension_cols]
        block_name_expr = (
            pl.concat_str(
                [pl.lit(sc.stream_name)] + [pl.col(k).cast(pl.Utf8) for k in extra_keys],
                separator="_",
            )
            if extra_keys
            else pl.lit(sc.stream_name)
        )

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
            space_id_expr = (
                pl.lit("static_") + pl.col("start_timestamp").dt.strftime("%Y%m%d_%H%M%S")
            )

        raw_market_expr = (
            pl.col("market_value")
            if "market_value" in snap.columns
            else pl.lit(None).cast(pl.Float64)
        )

        # Preserve the snap's native risk-dimension cols so per-dim rows can
        # stay on their own (symbol, expiry) in Pass 2. Scalar snaps (height
        # == 1) drop these before the cross-join to avoid column collision
        # with the applies_to universe.
        raw_block_df = snap.select(
            *(pl.col(c) for c in risk_dimension_cols),
            block_name_expr.alias("block_name"),
            pl.lit(sc.stream_name).alias("stream_name"),
            pl.col("raw_value").cast(pl.Float64).alias("raw_fair"),
            raw_market_expr.cast(pl.Float64).alias("raw_market"),
            pl.col("start_timestamp"),
            space_id_expr.alias("space_id"),
            pl.lit(sc.block.annualized).alias("annualized"),
            pl.lit(sc.block.temporal_position).alias("temporal_position"),
            pl.lit(sc.block.decay_end_size_mult).cast(pl.Float64).alias("decay_end_size_mult"),
            pl.lit(sc.block.decay_rate_prop_per_min).cast(pl.Float64).alias("decay_rate_prop_per_min"),
            pl.lit(sc.block.var_fair_ratio).cast(pl.Float64).alias("var_fair_ratio"),
            pl.lit(sc.scale).cast(pl.Float64).alias("scale"),
            pl.lit(sc.offset).cast(pl.Float64).alias("offset"),
            pl.lit(sc.exponent).cast(pl.Float64).alias("exponent"),
        )

        # Variance in raw space — adds raw_var column.
        raw_block_df = var_fn.fn(raw_block_df, **var_params)

        # Unit conversion with this stream's scalar params, applied to each
        # raw total. Null propagates through the expression for aggregate /
        # passthrough rows whose raw_market is None.
        conv_params = sc.get_conversion_params()
        raw_block_df = raw_block_df.with_columns(
            unit_fn.fn("raw_fair", **conv_params).alias("calc_fair_total"),
            unit_fn.fn("raw_var", **conv_params).alias("calc_var_total"),
            unit_fn.fn("raw_market", **conv_params).alias("calc_market_total"),
        )

        # Capture the scalar-vs-per-dim signal from the deduped snap, before
        # any downstream transforms that could change row count. A single
        # deduped row is the "scalar" shape — cross-joined to every target
        # dim in Pass 2; multiple rows are "per-dim" — each stays on its
        # native (symbol, expiry, ...) combo.
        is_scalar = raw_block_df.height == 1
        per_stream_dfs.append((sc, raw_block_df, is_scalar))

    # Pass 2: applies_to fan-out and concat.
    if not per_stream_dfs:
        return pl.DataFrame()

    dim_universe = sorted(dim_universe_set)
    canon_to_native = {_canon_dim(t): t for t in dim_universe_set}
    parts: list[pl.DataFrame] = []

    for sc, stream_df, is_scalar in per_stream_dfs:
        if sc.applies_to is None:
            applies_to = dim_universe
        else:
            # Canonicalise user-supplied pairs (strings from JSON) and match
            # against the canonical universe; resolve matches back to native
            # (datetime-typed) tuples for the join.
            requested_canon = [_canon_dim(tuple(p)) for p in sc.applies_to]
            missing_canon = [c for c in requested_canon if c not in dim_universe_canon]
            if missing_canon:
                raise ValueError(
                    f"Stream '{sc.stream_name}' applies_to contains dims "
                    f"not in universe: {missing_canon}"
                )
            applies_to = [canon_to_native[c] for c in requested_canon]

        if not applies_to:
            continue

        applies_to_df = pl.DataFrame(
            {c: [pair[i] for pair in applies_to] for i, c in enumerate(risk_dimension_cols)},
        )
        for c in risk_dimension_cols:
            if c in stream_df.schema:
                applies_to_df = applies_to_df.with_columns(
                    pl.col(c).cast(stream_df.schema[c]),
                )

        if is_scalar:
            # Scalar fan-out: drop the single-row's native dim (it would
            # otherwise collide with applies_to_df during the cross-join)
            # and replicate that row across every dim in applies_to.
            part = stream_df.drop(risk_dimension_cols).join(applies_to_df, how="cross")
        elif sc.applies_to is None:
            # Per-dim pass-through: each snap row keeps its native dim. No
            # fan-out — the stream already covers the dims it has data for.
            part = stream_df
        else:
            # Per-dim with explicit applies_to: filter snap rows to the
            # requested dims via inner-join on the risk-dimension cols.
            part = stream_df.join(applies_to_df, on=risk_dimension_cols, how="inner")

        # Normalise column order so ``pl.concat`` can vstack regardless of
        # which branch produced each part (scalar cross-join appends dims at
        # the end; per-dim parts carry them at the start from Pass 1's
        # select). Put risk-dim cols first, the rest in insertion order.
        ordered_cols = list(risk_dimension_cols) + [
            c for c in part.columns if c not in risk_dimension_cols
        ]
        parts.append(part.select(ordered_cols))

    if not parts:
        return pl.DataFrame()

    return pl.concat(parts)


def _attach_market_value_source(
    blocks_df: pl.DataFrame,
    risk_dimension_cols: list[str],
    aggregate_market_values: dict[tuple[str, str], float],
) -> pl.DataFrame:
    """Tag each block with ``market_value_source`` ∈ {block, aggregate, passthrough}.

    Precedence (spec Stage A §7): block if raw_market is set, else aggregate
    if the (symbol, canonical_expiry) key is in ``aggregate_market_values``,
    else passthrough.
    """
    if blocks_df.is_empty():
        return blocks_df

    unique_dims = blocks_df.select(risk_dimension_cols).unique()
    rows: list[dict] = []
    for dim_row in unique_dims.iter_rows(named=True):
        dim_tuple = tuple(dim_row[c] for c in risk_dimension_cols)
        # Pipeline default risk dims are ["symbol", "expiry"] — canonicalise
        # the expiry so the lookup matches the dict's key format.
        if (
            len(risk_dimension_cols) == 2
            and risk_dimension_cols[0] == "symbol"
            and risk_dimension_cols[1] == "expiry"
        ):
            key = (dim_row["symbol"], canonical_expiry_key(dim_row["expiry"]))
        else:
            key = dim_tuple
        row = {c: dim_row[c] for c in risk_dimension_cols}
        row["_has_aggregate"] = key in aggregate_market_values
        rows.append(row)

    if not rows:
        return blocks_df.with_columns(pl.lit("passthrough").alias("market_value_source"))

    has_agg_df = pl.DataFrame(rows)
    for c in risk_dimension_cols:
        has_agg_df = has_agg_df.with_columns(
            pl.col(c).cast(blocks_df.schema[c]),
        )

    return (
        blocks_df
        .join(has_agg_df, on=risk_dimension_cols, how="left")
        .with_columns(
            pl.when(pl.col("raw_market").is_not_null()).then(pl.lit("block"))
            .when(pl.col("_has_aggregate").fill_null(False)).then(pl.lit("aggregate"))
            .otherwise(pl.lit("passthrough"))
            .alias("market_value_source"),
        )
        .drop("_has_aggregate")
    )


# ---------------------------------------------------------------------------
# Time grid (internal — not in the return dict)
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

# Position sizing sentinel: below this variance floor the Kelly ratio
# `edge * bankroll / var` is replaced with 0 to avoid division-by-near-zero
# blow-ups. Does not clamp the in-band output — see the Kelly bounding
# discussion if finite-upper-bound positions are needed.
VAR_FLOOR: float = 1e-6


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
    """Execute the full 4-space pipeline and return every intermediate frame.

    Returned keys:
      blocks_df        — one row per (block × applied_dim) with raw + calc scalars.
      block_series_df  — one row per (block × dim × timestamp) with fair, var, market.
      space_series_df  — one row per (dim × space_id × timestamp) post space-mean + MVI.
      dim_calc_df      — one row per (dim × timestamp) in calc space (pre calc→target).
      dim_target_df    — one row per (dim × timestamp) in target space with edge.
      desired_pos_df   — dim_target_df + smoothed_{edge,var} + raw/smoothed positions.
    """
    from_dict(transform_config or {})

    if not transform_config or "smoothing_params" not in transform_config:
        get_step("smoothing").set_param_values({"half_life_secs": smoothing_hl_secs})

    unit_fn = get_step("unit_conversion").get_selected()
    decay_fn = get_step("decay_profile").get_selected()
    var_fn = get_step("variance").get_selected()
    fair_fn = get_step("temporal_fair_value").get_selected()
    rsa_fn = get_step("risk_space_aggregation").get_selected()
    mvi_fn = get_step("market_value_inference").get_selected()
    agg_fn = get_step("aggregation").get_selected()
    ctt_fn = get_step("calc_to_target").get_selected()
    smooth_fn = get_step("smoothing").get_selected()
    pos_fn = get_step("position_sizing").get_selected()

    var_params = get_step("variance").get_param_values()
    fair_params = get_step("temporal_fair_value").get_param_values()
    rsa_params = get_step("risk_space_aggregation").get_param_values()
    mvi_params = get_step("market_value_inference").get_param_values()
    agg_params = get_step("aggregation").get_param_values()
    ctt_params = get_step("calc_to_target").get_param_values()
    smooth_params = get_step("smoothing").get_param_values()
    pos_params = get_step("position_sizing").get_param_values()

    agg_mv = aggregate_market_values or {}
    space_mv = space_market_values or {}

    # Stage A: block expansion.
    blocks_df = build_blocks_df(streams, risk_dimension_cols, unit_fn, var_fn, var_params)
    blocks_df = _attach_market_value_source(blocks_df, risk_dimension_cols, agg_mv)

    if blocks_df.is_empty():
        empty = pl.DataFrame()
        return {
            "blocks_df": empty, "block_series_df": empty, "space_series_df": empty,
            "dim_calc_df": empty, "dim_target_df": empty, "desired_pos_df": empty,
        }

    time_grid = build_time_grid(
        blocks_df, risk_dimension_cols, now, interval=time_grid_interval,
    )

    # Stage B: time distribution of each calc total.
    block_series_df = fair_fn.fn(
        blocks_df, time_grid, risk_dimension_cols, now, decay_fn,
        **fair_params,
    )

    # Stage C: risk-space mean.
    space_series_df = rsa_fn.fn(
        block_series_df, risk_dimension_cols, **rsa_params,
    )

    # Stage D.1: fill null space_market_fair from aggregate input.
    space_series_df = mvi_fn.fn(
        space_series_df, risk_dimension_cols, agg_mv, space_mv, now,
        **mvi_params,
    )

    # Stage D.2: sum across spaces within (risk_dim, timestamp).
    dim_calc_df = agg_fn.fn(
        space_series_df, risk_dimension_cols, **agg_params,
    ).sort(risk_dimension_cols + ["timestamp"])

    # Stage E: calc → target forward map + edge.
    tte_expr = (
        (pl.col("expiry").cast(pl.Datetime("us")) - pl.col("timestamp"))
        .dt.total_seconds() / SECONDS_PER_YEAR
    )
    dim_target_df = (
        dim_calc_df
        .with_columns(
            ctt_fn.fn(pl.col("total_fair_calc"), tte_expr, risk_dimension_cols, **ctt_params)
                .alias("total_fair"),
            ctt_fn.fn(pl.col("total_var_calc"), tte_expr, risk_dimension_cols, **ctt_params)
                .alias("var"),
            ctt_fn.fn(pl.col("total_market_fair_calc"), tte_expr, risk_dimension_cols, **ctt_params)
                .alias("total_market_fair"),
        )
        .with_columns(
            (pl.col("total_fair") - pl.col("total_market_fair")).alias("edge"),
        )
        .drop(["total_fair_calc", "total_var_calc", "total_market_fair_calc"])
    )

    # Stage F: smoothing.
    smoothed_df = smooth_fn.fn(
        dim_target_df, risk_dimension_cols, **smooth_params,
    )

    # Stage G: position sizing (Kelly by default).
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
        "block_series_df": block_series_df,
        "space_series_df": space_series_df,
        "dim_calc_df": dim_calc_df,
        "dim_target_df": dim_target_df,
        "desired_pos_df": desired_pos_df,
    }
