"""
Decay profile transforms: shape of cumulative remaining value over a block's lifetime.

Contract: (progress: pl.Expr, end_mult: float, **user_params) -> pl.Expr
  progress: expression in [0, 1] where 0 = block start, 1 = block end
  end_mult: decay_end_size_mult from BlockConfig (remaining fraction at end)
  Returns: expression giving remaining fraction of total value at each point

Critical math: the temporal_fair_value step derives the per-timestamp
annualized rate from the *derivative* of this curve.  "Linear" remaining
value → constant annualized rate.  "Exponential" remaining value →
exponential annualized rate.
"""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform(
    "decay_profile",
    "linear",
    description="Linear remaining value: D(p) = 1 - p*(1 - end_mult) → constant annualized rate",
)
def linear(progress: pl.Expr, end_mult: float) -> pl.Expr:
    return 1.0 - progress * (1.0 - end_mult)


@transform(
    "decay_profile",
    "exponential",
    description="Exponential remaining value: D(p) = end_mult + (1-end_mult)*exp(-λp) → exponential annualized rate",
    param_overrides={
        "lam": {"description": "Decay rate parameter (higher = faster initial decay)", "min": 0.1},
    },
)
def exponential(progress: pl.Expr, end_mult: float, lam: float = 3.0) -> pl.Expr:
    return end_mult + (1.0 - end_mult) * (-lam * progress).exp()


@transform(
    "decay_profile",
    "sigmoid",
    description="Sigmoid remaining value: S-curve transition from 1 to end_mult",
    param_overrides={
        "midpoint": {"description": "Progress point where transition is steepest", "min": 0.01, "max": 0.99},
        "steepness": {"description": "How sharp the transition is", "min": 1.0},
    },
)
def sigmoid(progress: pl.Expr, end_mult: float, midpoint: float = 0.5, steepness: float = 10.0) -> pl.Expr:
    # Sigmoid: 1 / (1 + exp(steepness * (progress - midpoint)))
    # Normalized so D(0) ≈ 1 and D(1) ≈ end_mult
    raw_sig = 1.0 / (1.0 + (steepness * (progress - midpoint)).exp())
    # Normalize: at p=0 sig≈1, at p=1 sig≈0; scale to [end_mult, 1]
    sig_at_0 = 1.0 / (1.0 + float.__truediv__(-steepness * midpoint, 1) and 1.0)  # approximate
    # Simpler: use the raw sigmoid and linearly rescale
    sig_0 = 1.0 / (1.0 + pl.lit(-steepness * midpoint).exp())
    sig_1 = 1.0 / (1.0 + pl.lit(steepness * (1.0 - midpoint)).exp())
    normalized = (raw_sig - sig_1) / (sig_0 - sig_1)
    return end_mult + (1.0 - end_mult) * normalized


@transform(
    "decay_profile",
    "step",
    description="Step function: instant drop from 1 to end_mult at threshold",
    param_overrides={
        "threshold": {"description": "Progress point where the drop occurs", "min": 0.01, "max": 0.99},
    },
)
def step(progress: pl.Expr, end_mult: float, threshold: float = 0.5) -> pl.Expr:
    return pl.when(progress < threshold).then(1.0).otherwise(end_mult)
