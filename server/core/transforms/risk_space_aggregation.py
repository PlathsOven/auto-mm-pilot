"""Risk-space aggregation transforms — per-timestamp mean over blocks within a space.

Stage C of the 4-space pipeline. Blocks sharing a ``(symbol, expiry, space_id)``
are treated as estimators of the same underlying risk; their per-timestamp
fair / var / market values are averaged, not summed. Sum across *spaces*
happens later in Stage D.

Market handling: if every block in a space at timestamp t is market-known
(source ∈ {"block", "passthrough"}), ``space_market_fair`` is the mean of
their markets. If any block at that t is still waiting on aggregate
inference (source == "aggregate"), ``space_market_fair`` is left null —
the ``market_value_inference`` step fills it downstream.

Zero-block rows are omitted by construction: the groupby only emits keys
that exist in the input, and Stage B omits rows outside a block's live
window.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("risk_space_aggregation", "arithmetic_mean",
           description="Per-timestamp arithmetic mean of fair/var/market over blocks "
                       "within each (risk_dim, space_id).")
def rsa_arithmetic_mean(
    block_series_df: pl.DataFrame,
    risk_dimension_cols: list[str],
) -> pl.DataFrame:
    if block_series_df.is_empty():
        return pl.DataFrame()

    space_group_keys = risk_dimension_cols + ["space_id", "timestamp"]

    return (
        block_series_df
        .group_by(space_group_keys)
        .agg(
            pl.col("fair").mean().alias("space_fair"),
            pl.col("var").mean().alias("space_var"),
            (pl.col("market_value_source") == "aggregate").any().alias("_has_aggregate"),
            pl.col("market").mean().alias("_market_mean"),
        )
        .with_columns(
            pl.when(pl.col("_has_aggregate"))
              .then(None)
              .otherwise(pl.col("_market_mean"))
              .alias("space_market_fair"),
        )
        .drop(["_has_aggregate", "_market_mean"])
        .sort(space_group_keys)
    )
