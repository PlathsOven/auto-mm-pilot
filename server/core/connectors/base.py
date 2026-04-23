"""Connector protocol + schema descriptors.

Connectors live behind the IP barrier — the client only ever sees the
catalog metadata produced from these descriptors, never the connector
implementation itself. The protocol declares two operations:

* ``initial_state(params)`` — build the opaque per-stream state object
  the connector needs to maintain across pushes.
* ``process(state, rows, params)`` — fold a batch of input rows into the
  state, returning the new state plus zero-or-more emitted snapshot rows
  (each one becomes a row in the connector-fed stream's ``snapshot_rows``
  and feeds the pipeline like any other ingest).

Each connector also exposes a small set of plain Python descriptors —
``ConnectorParamSchema`` / ``ConnectorInputFieldSchema`` /
``ConnectorRecommendation`` — that the API layer translates into the
Pydantic ``ConnectorSchema`` returned by ``GET /api/connectors``. Keeping
those descriptors in core (no Pydantic, no ``server.api.models`` import)
preserves the conventional core ↛ api direction.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeVar

from server.core.config import BlockConfig

State = TypeVar("State")


ParamType = Literal["int", "float", "list_int", "list_float"]
InputFieldType = Literal["float", "int", "str"]


@dataclass(frozen=True)
class ConnectorParamSchema:
    """One user-tunable parameter for a connector (validated at configure time)."""

    name: str
    type: ParamType
    default: Any
    description: str
    min: float | None = None
    max: float | None = None


@dataclass(frozen=True)
class ConnectorInputFieldSchema:
    """One non-key, non-timestamp field expected on every input row."""

    name: str
    type: InputFieldType
    description: str


@dataclass(frozen=True)
class ConnectorRecommendation:
    """Auto-fill values applied to the Stream Canvas when this connector is picked."""

    scale: float
    offset: float
    exponent: float
    block: BlockConfig


@dataclass(frozen=True)
class ConnectorStateSummary:
    """Lightweight per-stream state telemetry surfaced in the Inspector.

    All connectors emit the same two warmup-progress numbers so the UI can
    render a generic "warming up" badge without per-connector logic.
    """

    min_n_eff: float
    warmup_threshold: float
    symbols_tracked: int


# Snapshot rows emitted by ``Connector.process`` are plain dicts because the
# downstream consumer is ``StreamRegistration.snapshot_rows`` (also a list of
# dicts). Each dict must carry ``timestamp`` plus the stream's ``key_cols``
# and ``raw_value``.
EmittedRow = dict[str, Any]


class Connector(Protocol[State]):
    """Server-side pre-built input transform.

    Implementations are stateless singletons — the per-stream state lives in
    the value returned by ``initial_state`` and threaded through ``process``.
    The state shape is opaque to the API layer; only the connector itself
    interprets it.
    """

    name: str
    """Machine id (snake_case). Stored on the stream and matched in the registry."""

    display_name: str
    """Human-facing label for the catalog UI."""

    description: str
    """One-paragraph description shown next to the picker."""

    input_key_cols: list[str]
    """Key columns expected on every input row beyond ``timestamp``."""

    input_value_fields: list[ConnectorInputFieldSchema]
    """Non-key, non-timestamp fields expected on every input row."""

    output_unit_label: str
    """Human-readable label for the value carried into the stream's ``raw_value``."""

    params: list[ConnectorParamSchema]
    """User-configurable parameters validated at stream-configure time."""

    recommended: ConnectorRecommendation
    """Stream-config defaults the canvas auto-fills + locks when this connector is picked."""

    def initial_state(self, params: dict[str, Any]) -> State:
        """Build a fresh state object given the resolved parameter dict."""
        ...

    def process(
        self,
        state: State,
        rows: list[dict[str, Any]],
        params: dict[str, Any],
    ) -> tuple[State, list[EmittedRow]]:
        """Fold ``rows`` into ``state`` and emit zero-or-more snapshot rows.

        Implementations validate per-row inputs and raise ``ValueError`` on
        any malformed entry — the API layer translates those into 422
        responses for the caller.
        """
        ...

    def state_summary(self, state: State) -> ConnectorStateSummary:
        """Snapshot warmup-progress numbers for the Inspector badge."""
        ...


def resolve_params(
    schema: list[ConnectorParamSchema],
    user_params: dict[str, Any] | None,
) -> dict[str, Any]:
    """Apply user overrides on top of a connector's parameter defaults.

    Validation for type / min / max happens here so every connector — and
    the API endpoint that ingests the user's payload — pays one consistent
    rule set. Unknown parameter names raise ``ValueError`` rather than
    silently being ignored, which would make typos in stream configuration
    very hard to debug.
    """
    user_params = user_params or {}
    known = {p.name for p in schema}
    unknown = set(user_params) - known
    if unknown:
        raise ValueError(f"Unknown connector params: {sorted(unknown)}")

    resolved: dict[str, Any] = {}
    for p in schema:
        value = user_params.get(p.name, p.default)
        resolved[p.name] = _coerce_param(p, value)
    return resolved


def _coerce_param(schema: ConnectorParamSchema, value: Any) -> Any:
    """Type-check + range-check one parameter value."""
    if schema.type == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"Param {schema.name!r} must be int, got {type(value).__name__}")
        _check_range(schema, value)
        return value
    if schema.type == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Param {schema.name!r} must be float, got {type(value).__name__}")
        coerced = float(value)
        _check_range(schema, coerced)
        return coerced
    if schema.type == "list_int":
        if not isinstance(value, list) or not all(
            isinstance(v, int) and not isinstance(v, bool) for v in value
        ):
            raise ValueError(f"Param {schema.name!r} must be list[int]")
        for v in value:
            _check_range(schema, v)
        return list(value)
    if schema.type == "list_float":
        if not isinstance(value, list) or not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) for v in value
        ):
            raise ValueError(f"Param {schema.name!r} must be list[float]")
        coerced = [float(v) for v in value]
        for v in coerced:
            _check_range(schema, v)
        return coerced
    raise AssertionError(f"Unsupported param type {schema.type!r}")


def _check_range(schema: ConnectorParamSchema, value: float) -> None:
    if schema.min is not None and value < schema.min:
        raise ValueError(f"Param {schema.name!r}={value} < min {schema.min}")
    if schema.max is not None and value > schema.max:
        raise ValueError(f"Param {schema.name!r}={value} > max {schema.max}")
