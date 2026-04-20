"""
Transform registry — step libraries, introspection, ``@transform`` decorator.

Holds the module-level ``_steps`` dict.  Each transform implementation
module (``unit_conversion``, ``decay``, ``fair_value``, ``variance``,
``aggregation``, ``position_sizing``, ``smoothing``,
``market_value_inference``) imports the ``@transform`` decorator from
here and registers itself on import.  ``server.core.transforms.__init__``
imports every implementation module so all transforms are registered
whenever the package is imported.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Callable, Literal, get_args, get_origin


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TransformParam:
    """Schema for a single user-configurable parameter."""

    name: str
    type: Literal["float", "int", "bool", "str"]
    default: Any
    description: str = ""
    min: float | None = None
    max: float | None = None
    options: list[str] | None = None


@dataclass
class TransformRegistration:
    """A registered transform function with its parameter schema."""

    name: str
    step: str
    fn: Callable
    description: str
    params: list[TransformParam]
    # Optional symbolic form, e.g. "P = E·B / (γ·V)". Consumed by the UI's
    # LiveEquationStrip to render whichever position_sizing transform is
    # currently active without hand-coding templates on the client.
    formula: str = ""


# ---------------------------------------------------------------------------
# Param introspection
# ---------------------------------------------------------------------------

_PYTHON_TYPE_MAP: dict[type, str] = {
    float: "float", int: "int", bool: "bool", str: "str",
}


def _introspect_params(
    fn: Callable,
    infrastructure_params: list[str],
    param_overrides: dict[str, dict] | None = None,
) -> list[TransformParam]:
    """Build TransformParam list from a function's signature.

    Parameters in *infrastructure_params* are excluded (pipeline-provided).
    """
    sig = inspect.signature(fn)
    overrides = param_overrides or {}
    params: list[TransformParam] = []

    for pname, param in sig.parameters.items():
        if pname in infrastructure_params:
            continue
        annotation = param.annotation
        type_str = "float"
        if annotation is not inspect.Parameter.empty:
            if get_origin(annotation) is Literal:
                type_str = "str"
            elif annotation in _PYTHON_TYPE_MAP:
                type_str = _PYTHON_TYPE_MAP[annotation]

        default = param.default if param.default is not inspect.Parameter.empty else None
        options = list(get_args(annotation)) if get_origin(annotation) is Literal else None
        ov = overrides.get(pname, {})
        params.append(TransformParam(
            name=pname,
            type=ov.get("type", type_str),
            default=ov.get("default", default),
            description=ov.get("description", ""),
            min=ov.get("min"),
            max=ov.get("max"),
            options=ov.get("options", options),
        ))

    return params


# ---------------------------------------------------------------------------
# StepLibrary
# ---------------------------------------------------------------------------


class StepLibrary:
    """Library of transforms for a single pipeline step."""

    def __init__(self, step: str, contract_doc: str, infrastructure_params: list[str]) -> None:
        self.step = step
        self.contract_doc = contract_doc
        self.infrastructure_params = infrastructure_params
        self._transforms: dict[str, TransformRegistration] = {}
        self._selected: str | None = None
        self._param_values: dict[str, Any] = {}

    def register(self, name: str, fn: Callable, *, description: str = "",
                 formula: str = "",
                 param_overrides: dict[str, dict] | None = None) -> None:
        params = _introspect_params(fn, self.infrastructure_params, param_overrides)
        self._transforms[name] = TransformRegistration(
            name=name, step=self.step, fn=fn, description=description,
            params=params, formula=formula,
        )
        if self._selected is None:
            self._selected = name

    def select(self, name: str) -> None:
        if name not in self._transforms:
            raise ValueError(
                f"Step '{self.step}' has no transform '{name}'. "
                f"Available: {', '.join(self._transforms)}"
            )
        self._selected = name
        self._param_values = {}

    def get_selected(self) -> TransformRegistration:
        if self._selected is None:
            raise RuntimeError(f"Step '{self.step}' has no transforms registered")
        return self._transforms[self._selected]

    def get_param_values(self) -> dict[str, Any]:
        selected = self.get_selected()
        return {param.name: self._param_values.get(param.name, param.default) for param in selected.params}

    def set_param_values(self, params: dict[str, Any]) -> None:
        self._param_values.update(params)

    def list_transforms(self) -> list[TransformRegistration]:
        return list(self._transforms.values())


# ---------------------------------------------------------------------------
# Module-level registry
# ---------------------------------------------------------------------------

_steps: dict[str, StepLibrary] = {}


def _define_step(step: str, *, contract_doc: str, infrastructure_params: list[str]) -> StepLibrary:
    lib = StepLibrary(step, contract_doc, infrastructure_params)
    _steps[step] = lib
    return lib


def get_step(step: str) -> StepLibrary:
    if step not in _steps:
        raise KeyError(f"No step '{step}' defined")
    return _steps[step]


def list_steps() -> list[str]:
    return list(_steps.keys())


def to_dict() -> dict[str, Any]:
    """Serialize current selections + param overrides."""
    out: dict[str, Any] = {}
    for name, lib in _steps.items():
        if lib._selected is not None:
            out[name] = lib._selected
        if lib._param_values:
            out[f"{name}_params"] = dict(lib._param_values)
    return out


def from_dict(config: dict[str, Any]) -> None:
    """Restore selections + param overrides from a config dict.

    Always resets to defaults first, then applies overrides.
    """
    for name, lib in _steps.items():
        # Reset to default (first registered transform)
        first = next(iter(lib._transforms))
        lib._selected = first
        lib._param_values = {}
        # Apply overrides
        if name in config:
            lib.select(config[name])
        pk = f"{name}_params"
        if pk in config and config[pk]:
            lib.set_param_values(config[pk])


class _RegistryProxy:
    """Lightweight proxy so get_registry() returns an object with the expected API."""
    get_step = staticmethod(get_step)
    list_steps = staticmethod(list_steps)
    to_dict = staticmethod(to_dict)
    from_dict = staticmethod(from_dict)


_proxy = _RegistryProxy()


def get_registry() -> _RegistryProxy:
    """Return a proxy with the same interface as the old TransformRegistry."""
    return _proxy


# ---------------------------------------------------------------------------
# @transform decorator
# ---------------------------------------------------------------------------


def transform(step: str, name: str, *, description: str = "",
              formula: str = "",
              param_overrides: dict[str, dict] | None = None) -> Callable:
    """Register a function into a step's library.

    `formula` is an optional symbolic form (e.g. "P = E·B / V") that the UI
    renders when this transform is the active implementation.
    """
    def wrapper(fn: Callable) -> Callable:
        get_step(step).register(
            name, fn, description=description, formula=formula,
            param_overrides=param_overrides,
        )
        return fn
    return wrapper


# ---------------------------------------------------------------------------
# Step definitions (registered empty; implementation modules populate them)
# ---------------------------------------------------------------------------

_define_step("unit_conversion",
             contract_doc="(col: str, **params) -> pl.Expr",
             infrastructure_params=["col"])

_define_step("decay_profile",
             contract_doc="(progress: pl.Expr, end_mult: float, **params) -> pl.Expr",
             infrastructure_params=["progress", "end_mult"])

_define_step("temporal_fair_value",
             contract_doc="(blocks_df, time_grid, risk_dimension_cols, now, decay_fn, **params) -> pl.DataFrame",
             infrastructure_params=["blocks_df", "time_grid", "risk_dimension_cols", "now", "decay_fn"])

_define_step("variance",
             contract_doc="(block_fair_df: pl.DataFrame, **params) -> pl.DataFrame",
             infrastructure_params=["block_fair_df"])

_define_step("market_value_inference",
             contract_doc="(block_var_df, risk_dimension_cols, aggregate_market_values, space_market_values, now, **params) -> pl.DataFrame",
             infrastructure_params=[
                 "block_var_df", "risk_dimension_cols",
                 "aggregate_market_values", "space_market_values", "now",
             ])

_define_step("aggregation",
             contract_doc="(space_df, risk_dimension_cols, **params) -> pl.DataFrame",
             infrastructure_params=["space_df", "risk_dimension_cols"])

_define_step("position_sizing",
             contract_doc="(edge: pl.Expr, var: pl.Expr, bankroll: float, **params) -> pl.Expr",
             infrastructure_params=["edge", "var", "bankroll"])

_define_step("smoothing",
             contract_doc="(agg_df, risk_dimension_cols, **params) -> pl.DataFrame",
             infrastructure_params=["agg_df", "risk_dimension_cols"])
