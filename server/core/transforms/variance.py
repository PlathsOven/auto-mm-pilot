"""Variance transforms — per-block raw variance from raw fair value.

Stage A.4 of the 4-space pipeline. Operates on ``blocks_df`` in raw space
(before ``unit_conversion`` has mapped to calculation space). Each transform
adds a scalar ``raw_var`` column per block row.

The epistemic claim each transform encodes:
- ``fair_proportional`` (default): risk scales linearly with the magnitude
  of the raw fair estimate — bigger alphas carry proportionally bigger
  uncertainty.
- ``constant``: each block carries a fixed variance set by ``var_fair_ratio``
  directly, independent of the fair magnitude.
- ``squared_fair``: risk scales with the squared magnitude of the raw fair —
  appropriate for sources where noise amplifies super-linearly.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("variance", "fair_proportional",
           description="raw_var = |raw_fair| * var_fair_ratio "
                       "(proportional to raw fair magnitude)")
def var_fair_proportional(blocks_df: pl.DataFrame) -> pl.DataFrame:
    return blocks_df.with_columns(
        (pl.col("raw_fair").abs() * pl.col("var_fair_ratio")).alias("raw_var"),
    )


@transform("variance", "constant",
           description="raw_var = var_fair_ratio (constant, ignores raw_fair magnitude)")
def var_constant(blocks_df: pl.DataFrame) -> pl.DataFrame:
    return blocks_df.with_columns(pl.col("var_fair_ratio").alias("raw_var"))


@transform("variance", "squared_fair",
           description="raw_var = raw_fair² * var_fair_ratio "
                       "(quadratic scaling with raw fair magnitude)")
def var_squared_fair(blocks_df: pl.DataFrame) -> pl.DataFrame:
    return blocks_df.with_columns(
        (pl.col("raw_fair").pow(2) * pl.col("var_fair_ratio")).alias("raw_var"),
    )
