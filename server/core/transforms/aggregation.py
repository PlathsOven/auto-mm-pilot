"""Aggregation transforms — sum across risk spaces within (symbol, expiry).

Stage D.2 of the 4-space pipeline. Input is ``space_series_df``
(per-``(risk_dim, space_id, timestamp)``, already mean'd across blocks
within each space by Stage C). Output is per-``(risk_dim, timestamp)`` in
CALCULATION space.

The only aggregation is a pure sum — independent risk spaces combine as
sum/sum for both fair and variance. The market_value_inference step has
already filled any nulls in ``space_market_fair`` by the time we get here,
so summing is unambiguous.

Edge is computed in TARGET space by Stage E (``calc_to_target``), not here.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("aggregation", "sum_spaces",
           description="Sum space_fair, space_market_fair, space_var across risk spaces "
                       "per (risk_dim, timestamp). Emits *_calc columns; target-space "
                       "conversion and edge happen in Stage E.")
def agg_sum_spaces(space_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    if space_df.is_empty():
        return pl.DataFrame()

    rd_ts = risk_dimension_cols + ["timestamp"]
    return space_df.group_by(rd_ts).agg(
        pl.col("space_fair").sum().alias("total_fair_calc"),
        pl.col("space_market_fair").sum().alias("total_market_fair_calc"),
        pl.col("space_var").sum().alias("total_var_calc"),
    ).sort(rd_ts)
