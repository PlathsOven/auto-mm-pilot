"""Position-sizing transforms — map edge, variance, bankroll into a desired position."""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("position_sizing", "kelly",
           description="Kelly criterion (log utility): position = edge * bankroll / var",
           formula="P = E·B / V")
def ps_kelly(edge: pl.Expr, var: pl.Expr, bankroll: float) -> pl.Expr:
    return edge * bankroll / var


@transform("position_sizing", "power_utility",
           description="CRRA power utility: nonlinear position sizing for risk_aversion ≠ 1",
           formula="P = E·B / (γ·V)",
           param_overrides={
               "risk_aversion": {
                   "description": "CRRA risk aversion coefficient γ (γ=1 is Kelly/log utility)",
                   "min": 0.1,
               },
           })
def ps_power_utility(edge: pl.Expr, var: pl.Expr, bankroll: float,
                     risk_aversion: float = 2.0) -> pl.Expr:
    return edge * bankroll / (risk_aversion * var)
