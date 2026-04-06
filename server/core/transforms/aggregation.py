"""
Block aggregation transforms: block-level → risk-dimension-level.

Contract: (block_df: pl.DataFrame, risk_dimension_cols: list[str], **user_params) -> pl.DataFrame
  Input: block-level DataFrame with fair, market_fair, var, space_id, aggregation_logic
  Output: risk_dimension_cols + timestamp + total_fair + total_market_fair + edge + var
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform(
    "aggregation",
    "average_offset",
    description="'average' blocks → mean fair, 'offset' blocks → sum fair, variances always sum",
)
def average_offset(block_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
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


@transform(
    "aggregation",
    "weighted",
    description="Inverse-variance weighted combination of blocks within each space",
)
def weighted(block_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    group_keys = risk_dimension_cols + ["timestamp", "space_id"]

    # Compute inverse-variance weights per block (within each group)
    weighted_df = block_df.with_columns(
        pl.when(pl.col("var") > 0)
        .then(1.0 / pl.col("var"))
        .otherwise(1.0)
        .alias("_inv_var_weight"),
    )

    space_agg = weighted_df.group_by(group_keys).agg(
        # Weighted fair: sum(fair * w) / sum(w)
        (pl.col("fair") * pl.col("_inv_var_weight")).sum().alias("_wf"),
        (pl.col("market_fair") * pl.col("_inv_var_weight")).sum().alias("_wmf"),
        pl.col("_inv_var_weight").sum().alias("_tw"),
        pl.col("var").sum().alias("space_var"),
    ).with_columns(
        (pl.col("_wf") / pl.col("_tw")).alias("space_fair"),
        (pl.col("_wmf") / pl.col("_tw")).alias("space_market_fair"),
    ).with_columns(
        (pl.col("space_fair") - pl.col("space_market_fair")).alias("space_edge"),
    )

    rd_ts_keys = risk_dimension_cols + ["timestamp"]
    total = space_agg.group_by(rd_ts_keys).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_edge").sum().alias("edge"),
        pl.col("space_var").sum().alias("var"),
    ).sort(rd_ts_keys)

    return total


@transform(
    "aggregation",
    "sum_all",
    description="Sum all blocks regardless of aggregation_logic",
)
def sum_all(block_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    group_keys = risk_dimension_cols + ["timestamp", "space_id"]

    space_agg = block_df.group_by(group_keys).agg(
        pl.col("fair").sum().alias("space_fair"),
        pl.col("market_fair").sum().alias("space_market_fair"),
        pl.col("var").sum().alias("space_var"),
    ).with_columns(
        (pl.col("space_fair") - pl.col("space_market_fair")).alias("space_edge"),
    )

    rd_ts_keys = risk_dimension_cols + ["timestamp"]
    total = space_agg.group_by(rd_ts_keys).agg(
        pl.col("space_fair").sum().alias("total_fair"),
        pl.col("space_market_fair").sum().alias("total_market_fair"),
        pl.col("space_edge").sum().alias("edge"),
        pl.col("space_var").sum().alias("var"),
    ).sort(rd_ts_keys)

    return total
