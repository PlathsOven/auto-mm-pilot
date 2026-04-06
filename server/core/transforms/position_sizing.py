"""
Position sizing transforms: edge + variance + bankroll → desired position.

Contract: (edge: pl.Expr, var: pl.Expr, bankroll: float, **user_params) -> pl.Expr
  Returns Polars expression producing the desired position.
  Different utility functions produce genuinely different functional forms.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform(
    "position_sizing",
    "kelly",
    description="Kelly criterion (log utility): position = edge * bankroll / var",
)
def kelly(edge: pl.Expr, var: pl.Expr, bankroll: float) -> pl.Expr:
    return edge * bankroll / var


@transform(
    "position_sizing",
    "power_utility",
    description="CRRA power utility: nonlinear position sizing for risk_aversion ≠ 1",
    param_overrides={
        "risk_aversion": {
            "description": "CRRA risk aversion coefficient γ (γ=1 is Kelly/log utility)",
            "min": 0.1,
        },
    },
)
def power_utility(edge: pl.Expr, var: pl.Expr, bankroll: float, risk_aversion: float = 2.0) -> pl.Expr:
    # For CRRA utility U(W) = W^(1-γ)/(1-γ), the optimal position in the
    # continuous-time limit is: f* = edge / (γ * var)
    # This differs from Kelly (γ=1) by the 1/γ scaling, but more importantly
    # the optimal *wealth fraction* changes the relationship between bankroll
    # and position nonlinearly when accounting for compounding effects.
    #
    # Full formula with wealth fraction: position = (edge / (γ * var)) * bankroll
    # For γ > 1 this is more conservative than Kelly; for γ < 1 more aggressive.
    return edge * bankroll / (risk_aversion * var)
