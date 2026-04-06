"""
Temporal fair value transforms: block configs → per-timestamp fair values.

Contract: (blocks_df, time_grid, risk_dimension_cols, now, decay_fn, **user_params) -> pl.DataFrame
  blocks_df: one row per block with target_value, target_market_value, block config fields
  time_grid: timestamp grid per risk dimension with dtte column
  decay_fn: TransformRegistration for the selected decay_profile function
  Output columns: risk_dimension_cols + timestamp + block_name + stream_name +
                   space_id + aggregation_logic + fair_annualized + fair +
                   market_fair_annualized + market_fair + var_fair_ratio
"""

from __future__ import annotations

import datetime as dt

import polars as pl

from server.core.config import SECONDS_PER_YEAR
from server.core.helpers import annualize, deannualize
from server.core.transforms.registry import TransformRegistration, transform


# ---------------------------------------------------------------------------
# Shared helpers (used by multiple fair_value implementations)
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


# ---------------------------------------------------------------------------
# Standard temporal fair value (current pipeline logic)
# ---------------------------------------------------------------------------

@transform(
    "temporal_fair_value",
    "standard",
    description="Standard: annualized/discrete handling, decay via decay_fn, dtte multiplication",
)
def standard(
    blocks_df: pl.DataFrame,
    time_grid: pl.DataFrame,
    risk_dimension_cols: list[str],
    now: dt.datetime,
    decay_fn: TransformRegistration,
) -> pl.DataFrame:
    parts: list[pl.DataFrame] = []
    # Get decay_fn params from its step library
    from server.core.transforms.registry import get_registry
    decay_params = get_registry().get_step("decay_profile").get_param_values()

    for row in blocks_df.iter_rows(named=True):
        block_name = row["block_name"]
        is_ann = row["annualized"]
        expiry = row["expiry"]
        start_ts = now if row["temporal_position"] == "shifting" else row["start_timestamp"]
        end_ts = _get_end_timestamp(start_ts, expiry, row["decay_end_size_mult"], row["decay_rate_prop_per_min"])

        target_val = row["target_value"]
        target_mkt = row["target_market_value"]
        end_mult = row["decay_end_size_mult"]

        total_val = _get_total_value(target_val, target_mkt, start_ts, end_ts, is_ann, row["size_type"])
        dur_secs = (end_ts - start_ts).total_seconds()

        # Market fair: same block shape but with target_market_value as input
        mkt_total = _get_total_value(target_mkt, target_mkt, start_ts, end_ts, is_ann, row["size_type"])

        # Filter the time grid to this block's risk dimension
        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])

        block_df = grid_filter.select(risk_dimension_cols + ["timestamp", "dtte"])

        # Compute progress: fraction of decay window elapsed
        # progress = 0 at start_ts, 1 at end_ts
        if dur_secs > 0:
            progress_expr = (
                pl.when(pl.col("timestamp") <= start_ts).then(0.0)
                .when(pl.col("timestamp") >= end_ts).then(1.0)
                .otherwise(
                    (pl.col("timestamp") - start_ts).dt.total_seconds() / dur_secs
                )
            )
        else:
            progress_expr = pl.lit(1.0)

        # Apply decay profile to get remaining fraction at each timestamp
        remaining_fraction = decay_fn.fn(progress_expr, end_mult, **decay_params)

        # For annualized blocks, the annualized rate at each timestamp is
        # derived from the decay profile.  The decay profile D(progress)
        # defines the cumulative remaining fraction.  The instantaneous
        # annualized rate is proportional to -D'(progress).
        #
        # We normalize so that the integral of fair_annualized * dt over the
        # block's lifetime equals total_val.
        #
        # For the standard transform we use a pragmatic approach:
        # fair_annualized(t) = ann_rate * (D(p(t-ε)) - D(p(t+ε))) / (2ε)
        # normalized to preserve total_val.
        #
        # Simpler equivalent: we compute the annualized value at each point
        # as proportional to -D'(progress), scaled to match the total value.
        # Since the integral of -D'(p) from 0 to 1 = D(0) - D(1) = 1 - end_mult,
        # we scale by total_ann / (1 - end_mult) when end_mult < 1.

        if is_ann and dur_secs > 0:
            total_ann = annualize(total_val, dur_secs)
            start_to_expiry_secs = (expiry - start_ts).total_seconds()
            decay_window_fraction = min(dur_secs, start_to_expiry_secs) / start_to_expiry_secs

            # Use the numerical derivative of the decay profile
            # D'(p) ≈ (D(p) - D(p + dp)) / dp  (rate of value consumption)
            dp = 0.001
            progress_plus = (
                pl.when(pl.col("timestamp") <= start_ts).then(dp)
                .when(pl.col("timestamp") >= end_ts).then(1.0)
                .otherwise(
                    (pl.col("timestamp") - start_ts).dt.total_seconds() / dur_secs + dp
                )
            ).clip(0.0, 1.0)

            remaining_plus = decay_fn.fn(progress_plus, end_mult, **decay_params)
            # Rate of consumption (positive when value is being consumed)
            consumption_rate = (remaining_fraction - remaining_plus) / dp

            # Normalize: integral of consumption_rate over [0,1] should = 1-end_mult
            # The annualized rate = total_ann * consumption_rate / (1 - end_mult)
            # when end_mult < 1, else just use total_ann (no decay)
            if end_mult < 1.0:
                fair_ann_expr = (
                    pl.when(pl.col("timestamp") < start_ts).then(0.0)
                    .when(pl.col("timestamp") > end_ts).then(total_ann * end_mult)
                    .otherwise(total_ann * consumption_rate / (1.0 - end_mult))
                )
                # Market fair uses same shape
                mkt_total_ann = annualize(mkt_total, dur_secs)
                mkt_fair_ann_expr = (
                    pl.when(pl.col("timestamp") < start_ts).then(0.0)
                    .when(pl.col("timestamp") > end_ts).then(mkt_total_ann * end_mult)
                    .otherwise(mkt_total_ann * consumption_rate / (1.0 - end_mult))
                )
            else:
                # No decay: constant annualized rate
                fair_ann_expr = (
                    pl.when(pl.col("timestamp") < start_ts).then(0.0)
                    .otherwise(total_ann)
                )
                mkt_total_ann = annualize(mkt_total, dur_secs)
                mkt_fair_ann_expr = (
                    pl.when(pl.col("timestamp") < start_ts).then(0.0)
                    .otherwise(mkt_total_ann)
                )
        else:
            # Non-annualized (discrete) blocks: constant annualized rate
            if dur_secs > 0:
                fair_ann = annualize(total_val, dur_secs)
                mkt_fair_ann = annualize(mkt_total, dur_secs)
            else:
                fair_ann = 0.0
                mkt_fair_ann = 0.0

            fair_ann_expr = (
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .otherwise(fair_ann)
            )
            mkt_fair_ann_expr = (
                pl.when(pl.col("timestamp") < start_ts).then(0.0)
                .otherwise(mkt_fair_ann)
            )

        block_df = block_df.with_columns(
            fair_ann_expr.alias("fair_annualized"),
            mkt_fair_ann_expr.alias("market_fair_annualized"),
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


# ---------------------------------------------------------------------------
# Flat forward: constant annualized value throughout
# ---------------------------------------------------------------------------

@transform(
    "temporal_fair_value",
    "flat_forward",
    description="Constant annualized value throughout the block's lifetime (no decay shape)",
)
def flat_forward(
    blocks_df: pl.DataFrame,
    time_grid: pl.DataFrame,
    risk_dimension_cols: list[str],
    now: dt.datetime,
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

        # Simple: use the target value directly as annualized rate
        if is_ann:
            fair_ann = target_val if row["size_type"] == "fixed" else target_val - target_mkt
            mkt_fair_ann = target_mkt if row["size_type"] == "fixed" else 0.0
        else:
            # For discrete values, spread evenly over remaining time
            remaining_secs = (expiry - start_ts).total_seconds()
            if remaining_secs > 0:
                fair_ann = annualize(target_val, remaining_secs)
                mkt_fair_ann = annualize(target_mkt, remaining_secs)
            else:
                fair_ann = 0.0
                mkt_fair_ann = 0.0

        # Filter grid to this block's risk dimension
        grid_filter = time_grid
        for rdc in risk_dimension_cols:
            grid_filter = grid_filter.filter(pl.col(rdc) == row[rdc])

        block_df = grid_filter.select(risk_dimension_cols + ["timestamp", "dtte"]).with_columns(
            pl.when(pl.col("timestamp") < start_ts).then(0.0)
            .otherwise(fair_ann)
            .alias("fair_annualized"),
            pl.when(pl.col("timestamp") < start_ts).then(0.0)
            .otherwise(mkt_fair_ann)
            .alias("market_fair_annualized"),
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
