"""
Transform registry — step-specific libraries of pluggable pipeline functions.

Each pipeline step (unit_conversion, decay_profile, etc.) has its own
``StepLibrary`` that enforces an input/output contract.  Transform functions
register into a step's library via the ``@transform`` decorator and expose
their user-configurable parameters automatically via ``inspect.signature``.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, get_args, get_origin


# ---------------------------------------------------------------------------
# Parameter metadata
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


# ---------------------------------------------------------------------------
# Registration record
# ---------------------------------------------------------------------------

@dataclass
class TransformRegistration:
    """A registered transform function with its parameter schema."""

    name: str
    step: str
    fn: Callable
    description: str
    params: list[TransformParam]


# ---------------------------------------------------------------------------
# Introspection helper
# ---------------------------------------------------------------------------

_PYTHON_TYPE_MAP: dict[type, str] = {
    float: "float",
    int: "int",
    bool: "bool",
    str: "str",
}


def _introspect_params(
    fn: Callable,
    infrastructure_params: list[str],
    param_overrides: dict[str, dict] | None = None,
) -> list[TransformParam]:
    """Build ``TransformParam`` list from a function's signature.

    Parameters whose names appear in *infrastructure_params* are excluded —
    they are pipeline-provided, not user-facing.
    """
    sig = inspect.signature(fn)
    overrides = param_overrides or {}
    params: list[TransformParam] = []

    for pname, p in sig.parameters.items():
        if pname in infrastructure_params:
            continue

        # Determine type string
        annotation = p.annotation
        type_str = "float"  # fallback
        if annotation is not inspect.Parameter.empty:
            # Handle Literal types → "str" with options
            if get_origin(annotation) is Literal:
                type_str = "str"
            elif annotation in _PYTHON_TYPE_MAP:
                type_str = _PYTHON_TYPE_MAP[annotation]

        # Default value
        default = p.default if p.default is not inspect.Parameter.empty else None

        # Options for Literal types
        options = None
        if get_origin(annotation) is Literal:
            options = list(get_args(annotation))

        # Merge explicit overrides
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
# Step library
# ---------------------------------------------------------------------------

class StepLibrary:
    """Library of transforms for a single pipeline step."""

    def __init__(
        self,
        step: str,
        contract_doc: str,
        infrastructure_params: list[str],
    ) -> None:
        self.step = step
        self.contract_doc = contract_doc
        self.infrastructure_params = infrastructure_params
        self._transforms: dict[str, TransformRegistration] = {}
        self._selected: str | None = None
        self._param_values: dict[str, Any] = {}

    # -- registration --------------------------------------------------------

    def register(
        self,
        name: str,
        fn: Callable,
        *,
        description: str = "",
        param_overrides: dict[str, dict] | None = None,
    ) -> None:
        params = _introspect_params(fn, self.infrastructure_params, param_overrides)
        reg = TransformRegistration(
            name=name,
            step=self.step,
            fn=fn,
            description=description,
            params=params,
        )
        self._transforms[name] = reg
        # First registration becomes the default selection
        if self._selected is None:
            self._selected = name

    # -- selection -----------------------------------------------------------

    def select(self, name: str) -> None:
        if name not in self._transforms:
            available = ", ".join(self._transforms)
            raise ValueError(
                f"Step '{self.step}' has no transform '{name}'. "
                f"Available: {available}"
            )
        self._selected = name
        # Reset param values to defaults when switching
        self._param_values = {}

    def get_selected(self) -> TransformRegistration:
        if self._selected is None:
            raise RuntimeError(f"Step '{self.step}' has no transforms registered")
        return self._transforms[self._selected]

    # -- parameter values ----------------------------------------------------

    def get_param_values(self) -> dict[str, Any]:
        """Return merged defaults + overrides for the selected transform."""
        selected = self.get_selected()
        merged: dict[str, Any] = {}
        for p in selected.params:
            merged[p.name] = self._param_values.get(p.name, p.default)
        return merged

    def set_param_values(self, params: dict[str, Any]) -> None:
        self._param_values.update(params)

    # -- listing -------------------------------------------------------------

    def list_transforms(self) -> list[TransformRegistration]:
        return list(self._transforms.values())


# ---------------------------------------------------------------------------
# Global registry
# ---------------------------------------------------------------------------

class TransformRegistry:
    """Collection of all step libraries."""

    def __init__(self) -> None:
        self._steps: dict[str, StepLibrary] = {}

    def define_step(
        self,
        step: str,
        *,
        contract_doc: str,
        infrastructure_params: list[str],
    ) -> StepLibrary:
        lib = StepLibrary(step, contract_doc, infrastructure_params)
        self._steps[step] = lib
        return lib

    def get_step(self, step: str) -> StepLibrary:
        if step not in self._steps:
            raise KeyError(f"No step '{step}' defined in registry")
        return self._steps[step]

    def list_steps(self) -> list[str]:
        return list(self._steps.keys())

    # -- serialization -------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Serialize current selections + param overrides."""
        out: dict[str, Any] = {}
        for step_name, lib in self._steps.items():
            if lib._selected is not None:
                out[step_name] = lib._selected
            if lib._param_values:
                out[f"{step_name}_params"] = dict(lib._param_values)
        return out

    def from_dict(self, config: dict[str, Any]) -> None:
        """Restore selections + param overrides from a config dict."""
        for step_name, lib in self._steps.items():
            if step_name in config:
                lib.select(config[step_name])
            params_key = f"{step_name}_params"
            if params_key in config and config[params_key]:
                lib.set_param_values(config[params_key])


# ---------------------------------------------------------------------------
# Singleton + decorator
# ---------------------------------------------------------------------------

_global_registry: TransformRegistry | None = None


def get_registry() -> TransformRegistry:
    """Return the global transform registry (created on first call)."""
    global _global_registry
    if _global_registry is None:
        _global_registry = TransformRegistry()
    return _global_registry


def transform(
    step: str,
    name: str,
    *,
    description: str = "",
    param_overrides: dict[str, dict] | None = None,
) -> Callable:
    """Decorator: register a function into a step's library."""
    def wrapper(fn: Callable) -> Callable:
        get_registry().get_step(step).register(
            name, fn, description=description, param_overrides=param_overrides,
        )
        return fn
    return wrapper
