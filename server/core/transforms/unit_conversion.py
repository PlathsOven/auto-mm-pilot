"""Unit-conversion transforms — Stage A/B raw → calculation space map.

These functions convert each stream's raw authoring units (percent, SD,
variance points, annualised vol, etc.) into the pipeline's calculation
space — whatever is linear in what we price. For options today that's
variance units; `affine_power(x; scale=1, offset=0, exponent=2)` with
raw_fair in vol takes that to variance.

The raw → target map is now a two-step chain: unit_conversion (here)
followed by calc_to_target (Stage E). Users pick both independently.
"""

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
