"""Variance transforms — per-block variance from fair-value magnitude."""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("variance", "fair_proportional",
           description="var = |fair| * var_fair_ratio (proportional to fair value magnitude)")
def var_fair_proportional(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        (pl.col("fair").abs() * pl.col("var_fair_ratio")).alias("var"),
    )


@transform("variance", "constant",
           description="var = var_fair_ratio as absolute variance value (ignores fair magnitude)")
def var_constant(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(pl.col("var_fair_ratio").alias("var"))


@transform("variance", "squared_fair",
           description="var = fair² * var_fair_ratio (quadratic scaling with fair value)")
def var_squared_fair(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        (pl.col("fair").pow(2) * pl.col("var_fair_ratio")).alias("var"),
    )
