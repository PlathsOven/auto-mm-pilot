"""
Variance calculation transforms.

Contract: (block_fair_df: pl.DataFrame, **user_params) -> pl.DataFrame
  Input must have "fair" and "var_fair_ratio" columns.
  Must add a non-negative "var" column.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform(
    "variance",
    "fair_proportional",
    description="var = |fair| * var_fair_ratio (proportional to fair value magnitude)",
)
def fair_proportional(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        (pl.col("fair").abs() * pl.col("var_fair_ratio")).alias("var"),
    )


@transform(
    "variance",
    "constant",
    description="var = var_fair_ratio as absolute variance value (ignores fair magnitude)",
)
def constant(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        pl.col("var_fair_ratio").alias("var"),
    )


@transform(
    "variance",
    "squared_fair",
    description="var = fair^2 * var_fair_ratio (quadratic scaling with fair value)",
)
def squared_fair(block_fair_df: pl.DataFrame) -> pl.DataFrame:
    return block_fair_df.with_columns(
        (pl.col("fair").pow(2) * pl.col("var_fair_ratio")).alias("var"),
    )
