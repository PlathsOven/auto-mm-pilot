"""Temporal-fair-value transforms — per-timestamp fair value & market-fair for each block."""

from __future__ import annotations

import datetime as dt

import polars as pl

from server.core.helpers import annualize, deannualize
from server.core.transforms.registry import TransformRegistration, transform


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
    stream_value: float, market_value: float,
    start_ts: dt.datetime, end_ts: dt.datetime,
    is_annualized: bool, size_type: str,
) -> float:
    if is_annualized:
        ann_val = stream_value if size_type == "fixed" else stream_value - market_value
        return deannualize(ann_val, (end_ts - start_ts).total_seconds())
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


# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------

@transform("temporal_fair_value", "standard",
           description="Original analytical: linear interpolation of annualized rate, preserves total value integral")
def fv_standard(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
    decay_fn: TransformRegistration,
) -> pl.DataFrame:
    """Exact port of the original compute_block_fair_values logic."""
    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        block_name = row["block_name"]
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        end_ts = _get_end_timestamp(
            start_ts, expiry, row["decay_end_size_mult"], row["decay_rate_prop_per_min"],
        )

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


@transform("temporal_fair_value", "flat_forward",
           description="Constant annualized value throughout block lifetime (no decay shape)")
def fv_flat_forward(
    blocks_df: pl.DataFrame, time_grid: pl.DataFrame,
    risk_dimension_cols: list[str], now: dt.datetime,
    decay_fn: TransformRegistration,
) -> pl.DataFrame:
    parts: list[pl.DataFrame] = []

    for row in blocks_df.iter_rows(named=True):
        block_name = row["block_name"]
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        target_val = row["target_value"]
        target_mkt = row["target_market_value"]

        if is_ann:
            fair_ann = target_val if row["size_type"] == "fixed" else target_val - target_mkt
            mkt_fair_ann = target_mkt if row["size_type"] == "fixed" else 0.0
        else:
            remaining = (expiry - start_ts).total_seconds()
            fair_ann = annualize(target_val, remaining) if remaining > 0 else 0.0
            mkt_fair_ann = annualize(target_mkt, remaining) if remaining > 0 else 0.0

        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])

        block_df = grid_filter.select(risk_dimension_cols + ["timestamp", "dtte"]).with_columns(
            pl.when(pl.col("timestamp") < start_ts).then(0.0)
            .otherwise(fair_ann).alias("fair_annualized"),
            pl.when(pl.col("timestamp") < start_ts).then(0.0)
            .otherwise(mkt_fair_ann).alias("market_fair_annualized"),
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
