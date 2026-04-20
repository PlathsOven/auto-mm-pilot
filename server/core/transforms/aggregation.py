"""Aggregation transforms — sum per-space fair / market_fair / var to per-risk-dimension totals.

Input: per-(risk_dim, space_id, timestamp) frame with ``space_fair``,
``space_var``, ``space_market_fair`` (from ``market_value_inference``).

Output: per-(risk_dim, timestamp) frame with ``total_fair``,
``total_market_fair``, ``edge``, ``var``.

There is only one aggregation — a pure sum across spaces within a risk
dimension. The old ``average`` vs ``offset`` distinction is gone: two
uncorrelated alphas on the same space combine as sum/sum, and the space
layer carries the shared market_fair that drives per-space edge.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("aggregation", "sum_spaces",
           description="Sum space_fair, space_market_fair, space_var across spaces "
                       "per (risk_dim, timestamp). edge = total_fair - total_market_fair.")
def agg_sum_spaces(space_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    if space_df.is_empty():
        return pl.DataFrame()

    rd_ts = risk_dimension_cols + ["timestamp"]
    return space_df.group_by(rd_ts).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_var").sum().alias("var"),
    ).with_columns(
        (pl.col("total_fair") - pl.col("total_market_fair")).alias("edge"),
    ).sort(rd_ts)
