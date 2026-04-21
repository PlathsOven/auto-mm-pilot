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
from typing import Literal

import polars as pl

from server.core.config import SECONDS_PER_YEAR
from server.core.transforms.registry import transform


# Each distributed total maps ``calc_*_total`` (scalar per block) to an output
# column. The temporal shape is shared across the three; only the scale
# factor (the total) differs, so one pass over the joined grid produces all
# three.
_DISTRIBUTED_COLS: list[tuple[str, str]] = [
    ("calc_fair_total", "fair"),
    ("calc_var_total", "var"),
    ("calc_market_total", "market"),
]


def _fair_value(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
    *, mode: Literal["standard", "flat_forward"],
) -> pl.DataFrame:
    """Vectorised distribution of calc totals across each block's live window.

    Two modes share the same scaffold:
      * ``standard`` — piecewise-linear interpolation of the annualised rate
        between ``start_ts`` and ``end_ts`` (derived from ``decay_*``);
      * ``flat_forward`` — constant annualised rate from ``start_ts`` through
        expiry (no decay).
    """
    if blocks_df.is_empty():
        return pl.DataFrame()

    # ── Stage 1: per-block window bounds on blocks_df ────────────────────
    blocks_prepared = blocks_df.with_columns(
        pl.when(pl.col("temporal_position") == "shifting")
        .then(pl.lit(now).cast(pl.Datetime("us")))
        .otherwise(pl.col("start_timestamp").cast(pl.Datetime("us")))
        .alias("_start_ts"),
    )

    if mode == "standard":
        # end_ts = expiry when decay flattens the curve (mult==1) or the
        # decay rate is 0; otherwise ``start_ts + (1/rate) minutes``. Guard
        # the division with a safe_rate literal so pl.duration never sees 0.
        safe_rate = (
            pl.when(pl.col("decay_rate_prop_per_min") == 0.0).then(1.0)
            .otherwise(pl.col("decay_rate_prop_per_min"))
        )
        blocks_prepared = blocks_prepared.with_columns(
            pl.when(
                (pl.col("decay_end_size_mult") == 1.0)
                | (pl.col("decay_rate_prop_per_min") == 0.0)
            )
            .then(pl.col("expiry").cast(pl.Datetime("us")))
            .otherwise(pl.col("_start_ts") + pl.duration(seconds=60.0 / safe_rate))
            .alias("_end_ts"),
        ).with_columns(
            # A fully-decayed block (mult==0) contributes nothing after end_ts,
            # so clamp effective_end to end_ts; otherwise the block holds
            # end_ann through expiry.
            pl.when(pl.col("decay_end_size_mult") == 0.0)
            .then(pl.min_horizontal(pl.col("_end_ts"), pl.col("expiry").cast(pl.Datetime("us"))))
            .otherwise(pl.col("expiry").cast(pl.Datetime("us")))
            .alias("_effective_end"),
        )
    else:  # flat_forward: constant curve, lives start → expiry
        blocks_prepared = blocks_prepared.with_columns(
            pl.col("expiry").cast(pl.Datetime("us")).alias("_end_ts"),
            pl.col("expiry").cast(pl.Datetime("us")).alias("_effective_end"),
        )

    # ── Stage 2: per-total (start_ann, end_ann) per block ────────────────
    for total_col, out_col in _DISTRIBUTED_COLS:
        total_val = pl.col(total_col)
        dur_total_secs = (
            (pl.col("_end_ts") - pl.col("_start_ts")).dt.total_seconds().cast(pl.Float64)
        )

        if mode == "standard":
            dur_to_expiry_secs = (
                (pl.col("expiry").cast(pl.Datetime("us")) - pl.col("_start_ts"))
                .dt.total_seconds().cast(pl.Float64)
            )
            # Annualised pre-distribution uses the ORIGINAL dur_total; the
            # clamp-to-expiry only applies to ``p`` for the linear interp.
            total_distributed = (
                pl.when(pl.col("annualized"))
                .then(total_val / SECONDS_PER_YEAR * dur_total_secs)
                .otherwise(total_val)
            )
            ann_val = total_distributed * SECONDS_PER_YEAR / dur_total_secs
            end_ann = ann_val * pl.col("decay_end_size_mult")
            dur_clamped = pl.min_horizontal(dur_to_expiry_secs, dur_total_secs)
            p = dur_clamped / dur_to_expiry_secs
            start_ann = (
                pl.when(pl.col("annualized"))
                .then((2.0 / p) * (ann_val - (1.0 - p) * end_ann) - end_ann)
                .otherwise(ann_val)
            )
        else:  # flat_forward: start_ann == end_ann == fair_ann (degenerate)
            remaining_secs = (
                (pl.col("expiry").cast(pl.Datetime("us")) - pl.col("_start_ts"))
                .dt.total_seconds().cast(pl.Float64)
            )
            fair_ann = (
                pl.when(pl.col("annualized")).then(total_val)
                .otherwise(
                    pl.when(remaining_secs > 0)
                    .then(total_val * SECONDS_PER_YEAR / remaining_secs)
                    .otherwise(0.0)
                )
            )
            start_ann = fair_ann
            end_ann = fair_ann

        blocks_prepared = blocks_prepared.with_columns(
            start_ann.alias(f"_{out_col}_start_ann"),
            end_ann.alias(f"_{out_col}_end_ann"),
        )

    # ── Stage 3: inner-join with time_grid on risk dims, clip to window ──
    expanded = (
        blocks_prepared.join(time_grid, on=risk_dimension_cols, how="inner")
        .filter(
            (pl.col("timestamp") >= pl.col("_start_ts"))
            & (pl.col("timestamp") <= pl.col("_effective_end"))
        )
    )
    if expanded.is_empty():
        return pl.DataFrame()

    # ── Stage 4: piecewise-linear annualised column × dtte per total ─────
    dur_total_secs = (
        (pl.col("_end_ts") - pl.col("_start_ts")).dt.total_seconds().cast(pl.Float64)
    )
    ts_progress = (
        (pl.col("timestamp") - pl.col("_start_ts")).dt.total_seconds().cast(pl.Float64)
    )
    annualised_cols: list[pl.Expr] = []
    for _, out_col in _DISTRIBUTED_COLS:
        start_ann = pl.col(f"_{out_col}_start_ann")
        end_ann = pl.col(f"_{out_col}_end_ann")
        interp = start_ann + (end_ann - start_ann) * ts_progress / dur_total_secs
        annualised_cols.append(
            pl.when(start_ann.is_null()).then(pl.lit(None).cast(pl.Float64))
            .when(pl.col("timestamp") < pl.col("_start_ts")).then(pl.lit(0.0))
            .when(pl.col("timestamp") > pl.col("_end_ts")).then(end_ann)
            .when(pl.col("annualized")).then(interp)
            .otherwise(start_ann)
            .alias(f"_{out_col}_annualized")
        )

    result = expanded.with_columns(*annualised_cols).with_columns(
        (pl.col("_fair_annualized") * pl.col("dtte")).alias("fair"),
        (pl.col("_var_annualized") * pl.col("dtte")).alias("var"),
        (pl.col("_market_annualized") * pl.col("dtte")).alias("market"),
    )

    # Stable row order — the inner join above is deterministic per-run but
    # not insertion-ordered; downstream space-level aggregations sum over
    # blocks and are sensitive to accumulation order (floating-point
    # associativity). Sorting here pins the order so same inputs → same
    # bits downstream. See tasks/lessons.md "Polars group_by without
    # maintain_order is non-deterministic".
    output = result.select(
        *risk_dimension_cols,
        pl.col("timestamp"),
        pl.col("dtte"),
        pl.col("block_name"),
        pl.col("stream_name"),
        pl.col("space_id"),
        pl.col("var_fair_ratio").cast(pl.Float64),
        pl.col("market_value_source"),
        pl.col("fair"),
        pl.col("var"),
        pl.col("market"),
    ).sort([*risk_dimension_cols, "space_id", "block_name", "stream_name", "timestamp"])

    # Market override: passthrough → fair; aggregate → null; block → distributed market.
    return output.with_columns(
        pl.when(pl.col("market_value_source") == "passthrough").then(pl.col("fair"))
        .when(pl.col("market_value_source") == "aggregate").then(pl.lit(None).cast(pl.Float64))
        .otherwise(pl.col("market"))
        .alias("market"),
    )


# ---------------------------------------------------------------------------
# Registered transforms — thin mode-dispatch over ``_fair_value``
# ---------------------------------------------------------------------------

@transform("temporal_fair_value", "standard",
           description="Linear interpolation of annualised rate within the block's "
                       "live window. Applied to calc_fair / calc_var / calc_market "
                       "in one pass; market overridden by market_value_source.")
def fv_standard(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
) -> pl.DataFrame:
    return _fair_value(blocks_df, time_grid, risk_dimension_cols, now, mode="standard")


@transform("temporal_fair_value", "flat_forward",
           description="Constant annualised value throughout block lifetime (no decay shape). "
                       "Applied to calc_fair / calc_var / calc_market in one pass.")
def fv_flat_forward(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
) -> pl.DataFrame:
    return _fair_value(blocks_df, time_grid, risk_dimension_cols, now, mode="flat_forward")
