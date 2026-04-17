"""Decay-profile transforms — shape of remaining fair value across a block's lifetime."""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("decay_profile", "linear",
           description="Linear remaining value: D(p) = 1 - p*(1 - end_mult) → constant annualized rate")
def decay_linear(progress: pl.Expr, end_mult: float) -> pl.Expr:
    return 1.0 - progress * (1.0 - end_mult)


@transform("decay_profile", "exponential",
           description="Exponential remaining value: D(p) = end_mult + (1-end_mult)*exp(-λp)",
           param_overrides={
               "lam": {"description": "Decay rate (higher = faster initial decay)", "min": 0.1},
           })
def decay_exponential(progress: pl.Expr, end_mult: float, lam: float = 3.0) -> pl.Expr:
    return end_mult + (1.0 - end_mult) * (-lam * progress).exp()


@transform("decay_profile", "sigmoid",
           description="Sigmoid remaining value: S-curve from 1 to end_mult",
           param_overrides={
               "midpoint": {"description": "Steepest transition point", "min": 0.01, "max": 0.99},
               "steepness": {"description": "Transition sharpness", "min": 1.0},
           })
def decay_sigmoid(progress: pl.Expr, end_mult: float,
                  midpoint: float = 0.5, steepness: float = 10.0) -> pl.Expr:
    raw_sig = 1.0 / (1.0 + (steepness * (progress - midpoint)).exp())
    sig_0 = 1.0 / (1.0 + pl.lit(-steepness * midpoint).exp())
    sig_1 = 1.0 / (1.0 + pl.lit(steepness * (1.0 - midpoint)).exp())
    normalized = (raw_sig - sig_1) / (sig_0 - sig_1)
    return end_mult + (1.0 - end_mult) * normalized


@transform("decay_profile", "step",
           description="Step function: instant drop from 1 to end_mult at threshold",
           param_overrides={
               "threshold": {"description": "Progress point for the drop", "min": 0.01, "max": 0.99},
           })
def decay_step(progress: pl.Expr, end_mult: float, threshold: float = 0.5) -> pl.Expr:
    return pl.when(progress < threshold).then(1.0).otherwise(end_mult)
