"""
Pure helper functions for the pipeline.

Stateless math utilities used across pipeline steps.
"""

from __future__ import annotations

from server.core.config import SECONDS_PER_YEAR


def annualize(value: float, seconds: float) -> float:
    """Convert a total value over ``seconds`` to an annualised rate."""
    return value * SECONDS_PER_YEAR / seconds


def deannualize(value: float, seconds: float) -> float:
    """Convert an annualised rate to a total value over ``seconds``."""
    return value / SECONDS_PER_YEAR * seconds
