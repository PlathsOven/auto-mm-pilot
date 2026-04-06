"""
Position smoothing transforms.

Contract: (agg_df: pl.DataFrame, risk_dimension_cols: list[str], **user_params) -> pl.DataFrame
  Must add smoothed_edge and smoothed_var columns.
  All implementations MUST be forward-looking (reverse-apply-reverse pattern)
  because smoothing anticipates future changes in raw desired position and
  bakes some of that into the current value due to liquidity constraints.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform(
    "smoothing",
    "forward_ewm",
    description="Forward-looking EWM: reverse → ewm_mean_by → reverse",
    param_overrides={
        "half_life_secs": {
            "description": "EWM half-life in seconds",
            "min": 1,
        },
    },
)
def forward_ewm(agg_df: pl.DataFrame, risk_dimension_cols: list[str], half_life_secs: int = 1800) -> pl.DataFrame:
    hl = f"{half_life_secs}s"
    return agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(
        pl.col("edge")
        .reverse()
        .ewm_mean_by("timestamp", half_life=hl)
        .reverse()
        .over(risk_dimension_cols)
        .alias("smoothed_edge"),
        pl.col("var")
        .reverse()
        .ewm_mean_by("timestamp", half_life=hl)
        .reverse()
        .over(risk_dimension_cols)
        .alias("smoothed_var"),
    )


@transform(
    "smoothing",
    "no_smoothing",
    description="No smoothing: smoothed values equal raw values",
)
def no_smoothing(agg_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    return agg_df.with_columns(
        pl.col("edge").alias("smoothed_edge"),
        pl.col("var").alias("smoothed_var"),
    )


@transform(
    "smoothing",
    "forward_rolling_mean",
    description="Forward-looking rolling mean: reverse → rolling_mean → reverse",
    param_overrides={
        "window_size": {
            "description": "Number of grid points in the rolling window",
            "min": 2,
            "max": 500,
        },
    },
)
def forward_rolling_mean(agg_df: pl.DataFrame, risk_dimension_cols: list[str], window_size: int = 30) -> pl.DataFrame:
    return agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(
        pl.col("edge")
        .reverse()
        .rolling_mean(window_size=window_size, min_periods=1)
        .reverse()
        .over(risk_dimension_cols)
        .alias("smoothed_edge"),
        pl.col("var")
        .reverse()
        .rolling_mean(window_size=window_size, min_periods=1)
        .reverse()
        .over(risk_dimension_cols)
        .alias("smoothed_var"),
    )
