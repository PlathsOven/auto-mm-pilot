"""Bankroll-scaling transforms — shape the configured bankroll scalar into a
per-row column before it enters position sizing.

The pipeline's variance lives in annualized vol² (vega²) units. The standard
deviation of an annualized-vol estimate scales with 1/√TTE, so a bankroll
that's appropriate for a long-dated expiry over-sizes positions at short
expiries and under-sizes them at long expiries when applied uniformly.
Scaling bankroll by √TTE (relative to a user-defined reference TTE) keeps
the realised dispersion of `edge / var` consistent across the expiry curve.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


# Days per year used to convert pipeline-native TTE-in-years to TTE-in-days.
# Matches `SECONDS_PER_YEAR / 86_400` rounded to the conventional 365.25.
_DAYS_PER_YEAR: float = 365.25


@transform("bankroll_scaling", "root_tte",
           description="Scale bankroll by √(TTE_days / ref_tte_days) — keeps "
                       "dispersion of edge/var roughly consistent across expiries.",
           formula="B(t) = B · √(TTE_days / TTE_ref)",
           param_overrides={
               "ref_tte_days": {
                   "description": "Reference TTE in days where scaled = configured bankroll.",
                   "min": 0.1,
               },
           })
def bs_root_tte(bankroll: pl.Expr, tte_years: pl.Expr,
                ref_tte_days: float = 30.0) -> pl.Expr:
    return bankroll * (tte_years * _DAYS_PER_YEAR / ref_tte_days).sqrt()
