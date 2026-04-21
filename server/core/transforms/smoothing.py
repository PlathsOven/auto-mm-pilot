"""Smoothing transforms — forward-looking smoothing on aggregated edge / var.

Applied uniformly to ``edge``, ``var``, ``total_fair`` and ``total_market_fair``
so that by linearity of the smoother (EWM and rolling-mean are both linear
operators) the identity ``smoothed_edge == smoothed_total_fair -
smoothed_total_market_fair`` is preserved at every grid timestamp. The grid's
Smoothed/Instant toggle depends on this: flipping from Instant Edge to
Smoothed Edge must stay consistent with flipping Fair and Market (Calc).
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


# Columns carried through every smoothing transform. `edge` and `var` feed
# the Kelly position-sizing step; `total_fair` and `total_market_fair` feed
# the grid's Smoothed Fair / Smoothed Market (Calc) view modes.
_SMOOTHED_COLS: tuple[tuple[str, str], ...] = (
    ("edge", "smoothed_edge"),
    ("var", "smoothed_var"),
    ("total_fair", "smoothed_total_fair"),
    ("total_market_fair", "smoothed_total_market_fair"),
)


@transform("smoothing", "forward_ewm",
           description="Forward-looking EWM: reverse → ewm_mean_by → reverse",
           param_overrides={
               "half_life_secs": {"description": "EWM half-life in seconds", "min": 1},
           })
def smooth_forward_ewm(agg_df: pl.DataFrame, risk_dimension_cols: list[str],
                       half_life_secs: int = 1800) -> pl.DataFrame:
    hl = f"{half_life_secs}s"
    return agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(*[
        pl.col(src)
        .reverse().ewm_mean_by("timestamp", half_life=hl).reverse()
        .over(risk_dimension_cols).alias(dst)
        for src, dst in _SMOOTHED_COLS
    ])


@transform("smoothing", "no_smoothing",
           description="No smoothing: smoothed values equal raw values")
def smooth_none(agg_df: pl.DataFrame, risk_dimension_cols: list[str]) -> pl.DataFrame:
    return agg_df.with_columns(*[
        pl.col(src).alias(dst) for src, dst in _SMOOTHED_COLS
    ])


@transform("smoothing", "forward_rolling_mean",
           description="Forward-looking rolling mean: reverse → rolling_mean → reverse",
           param_overrides={
               "window_size": {"description": "Rolling window size (grid points)", "min": 2, "max": 500},
           })
def smooth_rolling(agg_df: pl.DataFrame, risk_dimension_cols: list[str],
                   window_size: int = 30) -> pl.DataFrame:
    return agg_df.sort(risk_dimension_cols + ["timestamp"]).with_columns(*[
        pl.col(src)
        .reverse().rolling_mean(window_size=window_size, min_periods=1).reverse()
        .over(risk_dimension_cols).alias(dst)
        for src, dst in _SMOOTHED_COLS
    ])
