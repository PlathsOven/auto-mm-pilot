"""
server.core.transforms — Pluggable transform registry for the APT pipeline.

Defines 7 transformation steps, each with its own library of conforming
functions.  Import this module to ensure all steps are defined and all
built-in transforms are registered.

Public API:
    get_registry()          — singleton TransformRegistry
    TransformRegistry       — collection of step libraries
    StepLibrary             — per-step library
    TransformRegistration   — a registered function + param schema
    TransformParam          — metadata for one user-configurable param
"""

from server.core.transforms.registry import (
    TransformParam,
    TransformRegistration,
    TransformRegistry,
    StepLibrary,
    get_registry,
    transform,
)

# ---------------------------------------------------------------------------
# Define all pipeline steps (order matters: first registered = default)
# ---------------------------------------------------------------------------

_registry = get_registry()

_registry.define_step(
    "unit_conversion",
    contract_doc="(col: str, **params) -> pl.Expr",
    infrastructure_params=["col"],
)

_registry.define_step(
    "decay_profile",
    contract_doc="(progress: pl.Expr, end_mult: float, **params) -> pl.Expr",
    infrastructure_params=["progress", "end_mult"],
)

_registry.define_step(
    "temporal_fair_value",
    contract_doc="(blocks_df, time_grid, risk_dimension_cols, now, decay_fn, **params) -> pl.DataFrame",
    infrastructure_params=["blocks_df", "time_grid", "risk_dimension_cols", "now", "decay_fn"],
)

_registry.define_step(
    "variance",
    contract_doc="(block_fair_df: pl.DataFrame, **params) -> pl.DataFrame",
    infrastructure_params=["block_fair_df"],
)

_registry.define_step(
    "aggregation",
    contract_doc="(block_df, risk_dimension_cols, **params) -> pl.DataFrame",
    infrastructure_params=["block_df", "risk_dimension_cols"],
)

_registry.define_step(
    "position_sizing",
    contract_doc="(edge: pl.Expr, var: pl.Expr, bankroll: float, **params) -> pl.Expr",
    infrastructure_params=["edge", "var", "bankroll"],
)

_registry.define_step(
    "smoothing",
    contract_doc="(agg_df, risk_dimension_cols, **params) -> pl.DataFrame",
    infrastructure_params=["agg_df", "risk_dimension_cols"],
)

# ---------------------------------------------------------------------------
# Import transform modules to trigger @transform decorator registration.
# Order within each module determines which function is the default (first
# registered).
# ---------------------------------------------------------------------------

import server.core.transforms.unit_conversion  # noqa: F401, E402
import server.core.transforms.decay            # noqa: F401, E402
import server.core.transforms.fair_value       # noqa: F401, E402
import server.core.transforms.variance         # noqa: F401, E402
import server.core.transforms.aggregation      # noqa: F401, E402
import server.core.transforms.position_sizing  # noqa: F401, E402
import server.core.transforms.smoothing        # noqa: F401, E402


__all__ = [
    "TransformParam",
    "TransformRegistration",
    "TransformRegistry",
    "StepLibrary",
    "get_registry",
    "transform",
]
