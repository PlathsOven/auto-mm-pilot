"""Unit-conversion transforms — map raw data to target (variance) space."""

from __future__ import annotations

import polars as pl

from server.core.transforms.registry import transform


@transform("unit_conversion", "affine_power",
           description="(scale * raw + offset) ^ exponent",
           param_overrides={
               "scale": {"description": "Multiplicative scale factor"},
               "offset": {"description": "Additive offset before exponentiation"},
               "exponent": {"description": "Power exponent"},
           })
def affine_power(col: str, scale: float = 1.0, offset: float = 0.0, exponent: float = 1.0) -> pl.Expr:
    return (scale * pl.col(col) + offset).pow(exponent)


@transform("unit_conversion", "log_scale",
           description="scale * ln(raw + shift) + offset",
           param_overrides={
               "scale": {"description": "Multiplicative scale factor"},
               "offset": {"description": "Additive offset after log"},
               "shift": {"description": "Additive shift before log (must be > 0)", "min": 0.001},
           })
def log_scale(col: str, scale: float = 1.0, offset: float = 0.0, shift: float = 1.0) -> pl.Expr:
    return scale * (pl.col(col) + shift).log() + offset
