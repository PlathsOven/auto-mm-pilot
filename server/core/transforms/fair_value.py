"""Temporal-fair-value transforms — per-timestamp distribution for each block.

Stage B of the 4-space pipeline. Blocks arrive with three scalar totals in
CALCULATION space: ``calc_fair_total``, ``calc_var_total``, ``calc_market_total``.
Each transform distributes these totals across the per-block live window
(``start_timestamp`` through ``expiry``) and emits one row per
``(block × dim × timestamp)`` with ``fair``, ``var``, ``market`` columns.

Rows outside the live window are **omitted**, not zeroed, so Stage C's
arithmetic mean over blocks in a space only averages live contributors.

Market handling (override on top of the distributed ``calc_market_total``):
- ``market_value_source == "block"``: ``market(t)`` = distributed
  ``calc_market_total`` (the block's own market snapshot).
- ``market_value_source == "passthrough"``: ``market(t) = fair(t)``
  (zero-edge default — the block contributes nothing to total edge).
- ``market_value_source == "aggregate"``: ``market(t) = null``;
  ``market_value_inference`` fills it at the space level downstream.

All three distributions share the same temporal shape per block — the
annualised/decay curve is computed once; each total is a linear scale factor.
This is numerically identical to calling the transform three times with
different total columns, but avoids re-filtering the time grid twice.
"""

from __future__ import annotations

import datetime as dt

import polars as pl

from server.core.helpers import annualize, deannualize
from server.core.transforms.registry import transform


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_end_timestamp(
    start_ts: dt.datetime, expiry: dt.datetime,
    decay_end_size_mult: float, decay_rate_prop_per_min: float,
) -> dt.datetime:
    if decay_end_size_mult == 1 or decay_rate_prop_per_min == 0:
        return expiry
    return start_ts + dt.timedelta(minutes=1 / decay_rate_prop_per_min)


def _get_total_value(
    stream_value: float,
    start_ts: dt.datetime, end_ts: dt.datetime,
    is_annualized: bool,
) -> float:
    if is_annualized:
        return deannualize(stream_value, (end_ts - start_ts).total_seconds())
    return stream_value


def _get_start_annualized_value(
    total_value: float, expiry: dt.datetime,
    start_ts: dt.datetime, end_ts: dt.datetime,
    end_annualized_value: float, is_annualized: bool,
) -> float:
    start_to_expiry_secs = (expiry - start_ts).total_seconds()
    start_to_end_secs = (end_ts - start_ts).total_seconds()
    ann_val = annualize(total_value, start_to_end_secs)
    if is_annualized:
        start_to_end_secs = min(start_to_expiry_secs, start_to_end_secs)
        p = start_to_end_secs / start_to_expiry_secs
        return (2 / p) * (ann_val - (1 - p) * end_annualized_value) - end_annualized_value
    return ann_val


_DISTRIBUTED_COLS: list[tuple[str, str]] = [
    ("calc_fair_total", "fair"),
    ("calc_var_total", "var"),
    ("calc_market_total", "market"),
]


def _distribute_annualised_series(
    total_val: float | None,
    is_ann: bool, expiry: dt.datetime,
    start_ts: dt.datetime, end_ts: dt.datetime,
    decay_end_size_mult: float,
) -> tuple[float, float] | None:
    """Return (start_ann, end_ann) for a single total; None if total is null."""
    if total_val is None:
        return None
    total_distributed = _get_total_value(total_val, start_ts, end_ts, is_ann)
    dur_secs = (end_ts - start_ts).total_seconds()
    end_ann = annualize(total_distributed, dur_secs) * decay_end_size_mult
    start_ann = _get_start_annualized_value(
        total_distributed, expiry, start_ts, end_ts, end_ann, is_ann,
    )
    return start_ann, end_ann


def _annualised_expr(
    start_ann: float, end_ann: float,
    start_ts: dt.datetime, end_ts: dt.datetime,
    is_ann: bool,
) -> pl.Expr:
    return (
        pl.when(pl.col("timestamp") < start_ts).then(0.0)
        .when(pl.col("timestamp") > end_ts).then(end_ann)
        .when(pl.lit(is_ann)).then(
            start_ann + (end_ann - start_ann)
            * (pl.col("timestamp") - start_ts) / (end_ts - start_ts)
        )
        .otherwise(start_ann)
    )


# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------

@transform("temporal_fair_value", "standard",
           description="Linear interpolation of annualised rate within the block's "
                       "live window. Applied to calc_fair / calc_var / calc_market "
                       "in one pass; market overridden by market_value_source.")
def fv_standard(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
) -> pl.DataFrame:
    if blocks_df.is_empty():
        return pl.DataFrame()

    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        end_ts = _get_end_timestamp(
            start_ts, expiry, row["decay_end_size_mult"], row["decay_rate_prop_per_min"],
        )

        # Live window — drop rows outside so Stage C's mean is correct.
        # If the block fully decays (decay_end_size_mult == 0), it's dead after end_ts;
        # otherwise it contributes at end_ann through expiry.
        if row["decay_end_size_mult"] == 0.0:
            effective_end = min(end_ts, expiry)
        else:
            effective_end = expiry

        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])
        grid_filter = grid_filter.filter(
            (pl.col("timestamp") >= start_ts) & (pl.col("timestamp") <= effective_end),
        )

        if grid_filter.is_empty():
            continue

        distribute_cols: list[pl.Expr] = []
        for total_col, out_col in _DISTRIBUTED_COLS:
            pair = _distribute_annualised_series(
                row.get(total_col), is_ann, expiry, start_ts, end_ts,
                row["decay_end_size_mult"],
            )
            if pair is None:
                distribute_cols.append(
                    pl.lit(None).cast(pl.Float64).alias(f"{out_col}_annualized"),
                )
                continue
            start_ann, end_ann = pair
            distribute_cols.append(
                _annualised_expr(start_ann, end_ann, start_ts, end_ts, is_ann)
                .alias(f"{out_col}_annualized"),
            )

        block_df = grid_filter.select(
            risk_dimension_cols + ["timestamp", "dtte"],
        ).with_columns(
            *distribute_cols,
            pl.lit(row["block_name"]).alias("block_name"),
            pl.lit(row["stream_name"]).alias("stream_name"),
            pl.lit(row["space_id"]).alias("space_id"),
            pl.lit(row["var_fair_ratio"]).cast(pl.Float64).alias("var_fair_ratio"),
            pl.lit(row["market_value_source"]).alias("market_value_source"),
        ).with_columns(
            (pl.col("fair_annualized") * pl.col("dtte")).alias("fair"),
            (pl.col("var_annualized") * pl.col("dtte")).alias("var"),
            (pl.col("market_annualized") * pl.col("dtte")).alias("market"),
        )

        parts.append(block_df)

    if not parts:
        return pl.DataFrame()

    out = pl.concat(parts).drop(["fair_annualized", "var_annualized", "market_annualized"])

    # Market override: passthrough → fair; aggregate → null; block → distributed market.
    return out.with_columns(
        pl.when(pl.col("market_value_source") == "passthrough").then(pl.col("fair"))
        .when(pl.col("market_value_source") == "aggregate").then(pl.lit(None).cast(pl.Float64))
        .otherwise(pl.col("market"))
        .alias("market"),
    )


@transform("temporal_fair_value", "flat_forward",
           description="Constant annualised value throughout block lifetime (no decay shape). "
                       "Applied to calc_fair / calc_var / calc_market in one pass.")
def fv_flat_forward(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
) -> pl.DataFrame:
    if blocks_df.is_empty():
        return pl.DataFrame()

    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]

        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])
        grid_filter = grid_filter.filter(
            (pl.col("timestamp") >= start_ts) & (pl.col("timestamp") <= expiry),
        )

        if grid_filter.is_empty():
            continue

        distribute_cols: list[pl.Expr] = []
        for total_col, out_col in _DISTRIBUTED_COLS:
            total_val = row.get(total_col)
            if total_val is None:
                distribute_cols.append(
                    pl.lit(None).cast(pl.Float64).alias(f"{out_col}_annualized"),
                )
                continue
            if is_ann:
                fair_ann = total_val
            else:
                remaining = (expiry - start_ts).total_seconds()
                fair_ann = annualize(total_val, remaining) if remaining > 0 else 0.0
            distribute_cols.append(
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .otherwise(fair_ann).alias(f"{out_col}_annualized"),
            )

        block_df = grid_filter.select(
            risk_dimension_cols + ["timestamp", "dtte"],
        ).with_columns(
            *distribute_cols,
            pl.lit(row["block_name"]).alias("block_name"),
            pl.lit(row["stream_name"]).alias("stream_name"),
            pl.lit(row["space_id"]).alias("space_id"),
            pl.lit(row["var_fair_ratio"]).cast(pl.Float64).alias("var_fair_ratio"),
            pl.lit(row["market_value_source"]).alias("market_value_source"),
        ).with_columns(
            (pl.col("fair_annualized") * pl.col("dtte")).alias("fair"),
            (pl.col("var_annualized") * pl.col("dtte")).alias("var"),
            (pl.col("market_annualized") * pl.col("dtte")).alias("market"),
        )

        parts.append(block_df)

    if not parts:
        return pl.DataFrame()

    out = pl.concat(parts).drop(["fair_annualized", "var_annualized", "market_annualized"])

    return out.with_columns(
        pl.when(pl.col("market_value_source") == "passthrough").then(pl.col("fair"))
        .when(pl.col("market_value_source") == "aggregate").then(pl.lit(None).cast(pl.Float64))
        .otherwise(pl.col("market"))
        .alias("market"),
    )
