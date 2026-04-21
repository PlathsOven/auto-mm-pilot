"""Calc→target forward map — Stage E of the 4-space pipeline.

Given a per-timestamp column in CALCULATION space (linear in what we price —
today, variance), map it to TARGET space (linear in PnL — today, annualised
vol in vol points).

Default ``annualised_sqrt``: forward-integrate the column within each risk
dimension, divide by year-fractions remaining to expiry, square-root, scale
to vol points. Numerically identical to the hardcoded VP block the pipeline
carried at ``pipeline.py:264-307`` for options (default exponent=2).

Alternatives:
- ``identity``: calc space already is target space (passthrough).
- ``annualise_only``: forward-integrate + divide by T_years, no sqrt. Useful
  for users who want a variance-point target rather than a vol-point one.

Contract: each transform takes ``(col, tte_years, risk_dim_cols)`` and
returns a ``pl.Expr`` applied within a ``with_columns(...)``. The input
frame must be sorted by ``(risk_dim_cols, timestamp)`` ascending — the
pipeline guarantees that before calling.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


VOL_POINTS_SCALE: float = 100.0


@transform("calc_to_target", "annualised_sqrt",
           description="sqrt(x_fwd(t) / T_years_remaining(t)) * 100. "
                       "Forward integrates within each risk dim, annualises, "
                       "sqrt'd, scaled to vol points.")
def ctt_annualised_sqrt(
    col: pl.Expr,
    tte_years: pl.Expr,
    risk_dim_cols: list[str],
) -> pl.Expr:
    # ``col.reverse().cum_sum().reverse().over(keys)`` yields the forward
    # integral ``Σ_{t' ≥ t} col(t')`` within each group, for frames sorted
    # ascending by timestamp per group.
    forward = col.reverse().cum_sum().reverse().over(risk_dim_cols)
    return (
        pl.when(tte_years <= 0.0)
        .then(0.0)
        .otherwise((forward / tte_years).sqrt() * VOL_POINTS_SCALE)
        .fill_null(0.0)
    )


@transform("calc_to_target", "identity",
           description="Calc space already is target space — passthrough.")
def ctt_identity(
    col: pl.Expr,
    tte_years: pl.Expr,
    risk_dim_cols: list[str],
) -> pl.Expr:
    return col


@transform("calc_to_target", "annualise_only",
           description="x_fwd(t) / T_years_remaining(t). Forward integrates and "
                       "annualises, no sqrt — variance-point target.")
def ctt_annualise_only(
    col: pl.Expr,
    tte_years: pl.Expr,
    risk_dim_cols: list[str],
) -> pl.Expr:
    forward = col.reverse().cum_sum().reverse().over(risk_dim_cols)
    return (
        pl.when(tte_years <= 0.0)
        .then(0.0)
        .otherwise(forward / tte_years)
        .fill_null(0.0)
    )
