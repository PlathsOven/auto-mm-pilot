"""
Pure helper functions for the pipeline.

Stateless math utilities used across pipeline steps.
"""

from __future__ import annotations

import polars as pl

from server.core.config import SECONDS_PER_YEAR


def annualize(value: float, seconds: float) -> float:
    """Convert a total value over ``seconds`` to an annualised rate."""
    return value * SECONDS_PER_YEAR / seconds


def deannualize(value: float, seconds: float) -> float:
    """Convert an annualised rate to a total value over ``seconds``."""
    return value / SECONDS_PER_YEAR * seconds


def raw_to_target_expr(col: str, scale: float, offset: float, exponent: float) -> pl.Expr:
    """Native Polars expression for target-space conversion (no map_elements)."""
    return (scale * pl.col(col) + offset).pow(exponent)
