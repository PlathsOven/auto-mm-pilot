"""
Pipeline transform configuration wire shapes.

Each pipeline step exposes a transform library at runtime; clients fetch
the catalog via ``GET /api/transforms`` and push selections + per-step
params with ``POST /api/transforms/config``. Param shapes stay
``dict[str, Any]`` because the key set is discovered at runtime from
``server/core/transforms`` introspection.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class TransformParamResponse(BaseModel):
    """Schema for one user-configurable parameter of a transform function."""
    name: str
    type: str
    default: Any
    description: str = ""
    min: float | None = None
    max: float | None = None
    options: list[str] | None = None


class TransformResponse(BaseModel):
    """A single registered transform function."""
    name: str
    description: str
    params: list[TransformParamResponse]
    # Optional symbolic form (e.g. "P = E·B / (γ·V)"). Used by the client's
    # LiveEquationStrip to render whichever transform is active without
    # hand-coding templates.
    formula: str = ""


class TransformStepResponse(BaseModel):
    """A pipeline step with its available transforms and current selection."""
    label: str
    contract: str
    selected: str
    # Dynamic shape discovered at runtime from server/core/transforms.py
    # parameter definitions; cannot be statically typed.
    params: dict[str, Any]
    transforms: list[TransformResponse]


class TransformListResponse(BaseModel):
    """All pipeline steps with their transform libraries."""
    steps: dict[str, TransformStepResponse]


class TransformConfigRequest(BaseModel):
    """Update transform selections and/or parameter values.

    The ``*_params`` fields stay as ``dict[str, Any]`` because the valid
    key set is discovered at runtime from ``server/core/transforms.py``
    introspection — each transform exposes its own ``params`` schema, and
    there is no static Python type that covers every possible shape. The
    runtime validation happens in ``TransformLibrary.set_param_values``.
    """
    unit_conversion: str | None = None
    unit_conversion_params: dict[str, Any] | None = None
    decay_profile: str | None = None
    decay_profile_params: dict[str, Any] | None = None
    temporal_fair_value: str | None = None
    temporal_fair_value_params: dict[str, Any] | None = None
    variance: str | None = None
    variance_params: dict[str, Any] | None = None
    risk_space_aggregation: str | None = None
    risk_space_aggregation_params: dict[str, Any] | None = None
    aggregation: str | None = None
    aggregation_params: dict[str, Any] | None = None
    calc_to_target: str | None = None
    calc_to_target_params: dict[str, Any] | None = None
    bankroll_scaling: str | None = None
    bankroll_scaling_params: dict[str, Any] | None = None
    position_sizing: str | None = None
    position_sizing_params: dict[str, Any] | None = None
    smoothing: str | None = None
    smoothing_params: dict[str, Any] | None = None
    market_value_inference: str | None = None
    market_value_inference_params: dict[str, Any] | None = None
