"""Wire-shape Pydantic models for the Posit SDK.

These mirror the server-side models in server/api/models.py.
When the server wire format changes, update here to match.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


def _parse_datetime_tolerant(raw: str) -> datetime:
    """Accept ISO 8601 (``2026-03-27T00:00:00``) or DDMMMYY (``27MAR26``).

    Mirrors ``server.api.stream_registry.parse_datetime_tolerant`` so the SDK
    can reject unparseable values up-front instead of round-tripping to a 422.
    """
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, "%d%b%y")


class SnapshotRow(BaseModel):
    """One row of snapshot data.  Extra keys are allowed for dynamic key_cols."""

    model_config = ConfigDict(extra="allow")

    timestamp: str = Field(
        ...,
        description=(
            "Canonical: ISO 8601 (e.g. '2026-03-27T00:00:00'). "
            "Also accepted for convenience: DDMMMYY (e.g. '27MAR26'). "
            "Prefer ISO in new feeds — mixing formats within a stream works "
            "but is a legacy accommodation."
        ),
    )
    raw_value: float = Field(..., description="Stream's natural measurement.")
    market_value: float | None = Field(
        None,
        description=(
            "Market-implied value in the same units as raw_value. Required "
            "to produce non-zero edge — omitting it makes the block's market "
            "default to its own fair and desired_pos collapse to 0. Supply "
            "per-row OR use the aggregate path (set_market_values / "
            "push_market_values) per (symbol, expiry)."
        ),
    )

    @field_validator("timestamp")
    @classmethod
    def _timestamp_parseable(cls, v: str) -> str:
        try:
            _parse_datetime_tolerant(v)
        except ValueError as exc:
            raise ValueError(
                f"timestamp must be ISO 8601 or DDMMMYY, got {v!r}: {exc}"
            ) from exc
        return v


class MarketValueEntry(BaseModel):
    symbol: str = Field(..., min_length=1)
    expiry: str = Field(..., min_length=1)
    total_vol: float = Field(..., ge=0)


class BlockConfig(BaseModel):
    """Block pipeline configuration parameters.

    The ``@model_validator`` below mirrors the server's ``__post_init__``
    checks in ``server/core/config.py`` — catching contradictions here avoids
    a 422 round-trip and gives a clearer stack frame at the SDK boundary.

    ``decay_end_size_mult`` is a *sentinel-resolved* default: leave it ``None``
    and the SDK picks ``1.0`` for annualized streams / ``0.0`` for discrete
    ones. Pass an explicit value only if you know why.
    """

    annualized: bool = Field(
        True,
        description=(
            "True when the stream measures an annualized quantity (e.g. "
            "annualized vol, IV). False for discrete/event streams whose "
            "values do not decay over calendar time."
        ),
    )
    size_type: Literal["fixed", "relative"] = Field(
        "fixed",
        description=(
            "'fixed' — block size is independent of the underlying variance. "
            "'relative' — block size scales with variance (annualized only). "
            "Use 'relative' when a market's confidence in a reading grows "
            "with its own level (rarely needed)."
        ),
    )
    aggregation_logic: Literal["average", "offset"] = Field(
        "average",
        description=(
            "How this block combines with peers on the same (symbol, expiry, "
            "space). 'average' — mean with peers (default, safe). 'offset' — "
            "adds on top of the peer mean. Switch to 'offset' when the block "
            "represents an additional adjustment rather than a competing view."
        ),
    )
    temporal_position: Literal["static", "shifting"] = Field(
        "shifting",
        description=(
            "'shifting' — block's time anchor advances with the tick "
            "(default, correct for live feeds). 'static' — block is pinned "
            "to its ingest time (use for one-off snapshots / opinions that "
            "should not follow the wall clock)."
        ),
    )
    decay_end_size_mult: float | None = Field(
        None,
        ge=0,
        description=(
            "Size multiplier at the end of the block's decay window, relative "
            "to start. Sentinel-resolved: None → 1.0 on annualized streams "
            "(no decay), 0.0 on discrete streams (full decay). Pass 0.5 to "
            "halve size over the window. Validator rejects non-zero values "
            "on annualized=False streams."
        ),
    )
    decay_rate_prop_per_min: float = Field(
        0.0,
        ge=0,
        description=(
            "Fractional decay rate per minute. 0.0 disables temporal decay. "
            "Typical values: 1e-4 for slow-moving RV, 1e-2 for event shocks. "
            "Tune upward if you observe stale readings dominating fresh ones."
        ),
    )
    decay_profile: Literal["linear"] = Field(
        "linear",
        description="Shape of the decay curve. Only 'linear' is implemented today.",
    )
    var_fair_ratio: float = Field(
        1.0,
        description=(
            "Confidence weight. Higher = tighter distribution around fair = "
            "larger position size from this block. 1.0 is the neutral default. "
            "Raise to ~2.0 for high-confidence views, lower to ~0.5 for "
            "speculative ones. Tune *after* observing real desired_pos output."
        ),
    )

    @model_validator(mode="after")
    def _consistency(self) -> "BlockConfig":
        if self.size_type == "relative" and not self.annualized:
            raise ValueError("size_type='relative' requires annualized=True")
        # Resolve the decay_end_size_mult sentinel: annualized → 1.0 (no
        # decay), discrete → 0.0 (full decay). Done here rather than via
        # a default_factory so the value is explicit in the serialized form.
        if self.decay_end_size_mult is None:
            object.__setattr__(
                self,
                "decay_end_size_mult",
                1.0 if self.annualized else 0.0,
            )
        if self.decay_end_size_mult != 0 and not self.annualized:
            raise ValueError(
                "decay_end_size_mult is only applicable for annualized streams "
                "(set annualized=True or decay_end_size_mult=0)"
            )
        return self


class StreamSpec(BaseModel):
    """Bundled arguments for ``PositClient.upsert_stream``.

    Lets callers describe a full stream (name + key_cols + conversion
    params + block) in one object so ``bootstrap_streams`` can take a list
    of them and set up an entire desk in one call.
    """

    stream_name: str = Field(..., min_length=1)
    key_cols: list[str] = Field(..., min_length=1)
    scale: float = 1.0
    offset: float = 0.0
    exponent: float = 1.0
    block: "BlockConfig | None" = None

    @model_validator(mode="after")
    def _no_duplicate_key_cols(self) -> "StreamSpec":
        if len(set(self.key_cols)) != len(self.key_cols):
            raise ValueError(f"key_cols contains duplicates: {self.key_cols}")
        return self


class ConnectorParamSchema(BaseModel):
    """One user-tunable parameter exposed by a server-side connector."""

    name: str
    type: Literal["int", "float", "list_int", "list_float"]
    default: Any
    description: str
    min: float | None = None
    max: float | None = None


class ConnectorInputFieldSchema(BaseModel):
    """One non-key, non-timestamp field on every connector input row."""

    name: str
    type: Literal["float", "int", "str"]
    description: str


class ConnectorSchema(BaseModel):
    """Full catalog metadata for a single connector."""

    name: str
    display_name: str
    description: str
    input_key_cols: list[str]
    input_value_fields: list[ConnectorInputFieldSchema]
    output_unit_label: str
    params: list[ConnectorParamSchema]
    recommended_scale: float
    recommended_offset: float
    recommended_exponent: float
    recommended_block: BlockConfig


class ConnectorCatalogResponse(BaseModel):
    """Response for ``PositClient.list_connectors()``."""

    connectors: list[ConnectorSchema]


class ConnectorInputRow(BaseModel):
    """One row of a connector input batch.

    Connector input schemas vary per connector — extra fields are allowed
    on the wire and validated server-side against the connector's
    ``input_key_cols`` + ``input_value_fields``.
    """

    model_config = ConfigDict(extra="allow")

    timestamp: str = Field(..., description="ISO 8601 timestamp")

    @field_validator("timestamp")
    @classmethod
    def _timestamp_parseable(cls, v: str) -> str:
        try:
            _parse_datetime_tolerant(v)
        except ValueError as exc:
            raise ValueError(
                f"timestamp must be ISO 8601 or DDMMMYY, got {v!r}: {exc}"
            ) from exc
        return v


class ConnectorInputResponse(BaseModel):
    """Response from ``PositClient.push_connector_input`` / REST ingest."""

    stream_name: str
    rows_accepted: int
    rows_emitted: int
    pipeline_rerun: bool
    server_seq: int = 0


class ConnectorStateSummary(BaseModel):
    """Per-stream warmup-progress numbers for a connector-fed stream."""

    min_n_eff: float
    warmup_threshold: float
    symbols_tracked: int


class StreamResponse(BaseModel):
    """Response for stream CRUD endpoints.

    Unit conventions on ``(scale, offset, exponent)``:

    - ``raw_value`` is the stream's natural measurement (whatever units the
      feed emits — e.g. annualised vol in decimal form, funding rate in bps).
    - ``target_value = (scale · raw_value + offset) ** exponent``. The target
      space is where the pipeline math happens (typically variance).
    - ``market_value`` must share units with ``raw_value``; the same
      transform is applied to produce ``target_market_value``.
    - ``fair`` values the pipeline emits downstream are always in target
      space, so ``exponent=2`` is the vol-to-variance convention.

    ``connector_name`` (when non-None) flags the stream as connector-fed —
    push connector inputs via ``PositClient.push_connector_input`` instead
    of ``push_snapshot``.
    """

    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfig | None = None
    connector_name: str | None = None
    connector_params: dict[str, Any] | None = None


class SnapshotResponse(BaseModel):
    stream_name: str
    rows_accepted: int
    pipeline_rerun: bool
    server_seq: int = 0


class StreamState(BaseModel):
    """Extended stream metadata returned by ``PositClient.describe_stream``.

    Configuration fields mirror ``StreamResponse``; the operational fields
    (``row_count``, ``last_ingest_ts``, ``connector_state_summary``)
    surface the view integrators previously had to curl for.
    """

    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfig | None = None
    row_count: int
    last_ingest_ts: str | None = None
    connector_name: str | None = None
    connector_params: dict[str, Any] | None = None
    connector_state_summary: ConnectorStateSummary | None = None


class HealthResponse(BaseModel):
    """Response for ``GET /api/health``."""
    status: str


class BankrollResponse(BaseModel):
    bankroll: float
    pipeline_rerun: bool


class BlockRowResponse(BaseModel):
    block_name: str
    stream_name: str
    symbol: str
    expiry: str
    space_id: str
    source: Literal["stream", "manual"]
    annualized: bool
    size_type: Literal["fixed", "relative"]
    aggregation_logic: Literal["average", "offset"]
    temporal_position: Literal["static", "shifting"]
    decay_end_size_mult: float
    decay_rate_prop_per_min: float
    var_fair_ratio: float
    scale: float
    offset: float
    exponent: float
    target_value: float
    raw_value: float
    market_value: float | None = None
    target_market_value: float | None = None
    fair: float | None = None
    market_fair: float | None = None
    var: float | None = None
    start_timestamp: str | None = None
    updated_at: str | None = None


ZeroPositionReason = Literal[
    "no_market_value",
    "zero_variance",
    "zero_bankroll",
    "no_active_blocks",
    "edge_coincidence",
    "unknown",
]


class ZeroPositionDiagnostic(BaseModel):
    """One (symbol, expiry) whose ``desired_pos`` is near-zero, with a reason.

    Mirrors the server's ``ZeroPositionDiagnostic`` (camelCase on the wire).
    ``aggregate_market_value`` is ``None`` when no aggregate is set for this
    pair in the user's market value store.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    symbol: str
    expiry: str
    raw_edge: float
    raw_variance: float
    desired_pos: float
    total_fair: float
    total_market_fair: float
    aggregate_market_value: float | None = None
    reason: ZeroPositionReason
    hint: str


class ZeroPositionDiagnosticsResponse(BaseModel):
    """Response from ``PositClient.diagnose_zero_positions()``."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    bankroll: float
    tick_timestamp: int | None = None
    diagnostics: list[ZeroPositionDiagnostic]


class WsAck(BaseModel):
    """ACK frame received after pushing a snapshot or market_value frame.

    ``seq`` is the client-assigned correlation ID (``-1`` when the WS is
    unavailable and the push fell back to REST). ``server_seq`` is the
    server-assigned monotonic sequence number — populated on both the WS
    and REST paths so consumers have a single reliable correlation key.
    """

    type: Literal["ack"]
    seq: int
    rows_accepted: int = 0
    pipeline_rerun: bool = False
    server_seq: int = 0


# --- Wire models (camelCase on the wire, snake_case in Python) ---

class _WireModel(BaseModel):
    """Base for models whose JSON uses camelCase keys (server _WireModel mirrors)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DataStream(_WireModel):
    id: str
    name: str
    status: Literal["ONLINE", "DEGRADED", "OFFLINE"]
    last_heartbeat: int


class GlobalContext(_WireModel):
    last_update_timestamp: int


class DesiredPosition(_WireModel):
    symbol: str
    expiry: str
    edge: float
    smoothed_edge: float
    variance: float
    smoothed_var: float
    desired_pos: float
    raw_desired_pos: float
    current_pos: float
    total_fair: float
    total_market_fair: float
    change_magnitude: float
    updated_at: int


class UpdateCard(_WireModel):
    id: str
    symbol: str
    expiry: str
    old_pos: float
    new_pos: float
    delta: float
    timestamp: int


PositionTransport = Literal["ws", "poll"]


IntegratorEventType = Literal[
    "market_value_missing",
    "ws_fallback",
    "ws_reconnected",
    "positions_degraded",
    "zero_edge_warning",
]


class IntegratorEvent(BaseModel):
    """Structured SDK-side event for a monitoring consumer.

    Every place that currently logs a ``WARNING`` also enqueues one of
    these. Consumers drain the queue via ``PositClient.events()`` and route
    to their own monitoring layer (Datadog / Slack / pager) without relying
    on Python ``logging`` being configured.

    ``stream_name`` is populated for events that involve a specific stream
    (market-value-missing, zero-edge-warning) and ``None`` for connection-
    level events (ws fallback / reconnect / positions degraded).
    """

    type: IntegratorEventType
    stream_name: str | None = None
    detail: str
    timestamp: float  # epoch seconds (time.time())


class PositionPayload(_WireModel):
    """Pipeline broadcast payload received over WebSocket or REST polling.

    The SDK sets ``transport`` on every yielded payload so consumers can
    render a freshness indicator: ``"ws"`` = streamed live from the socket,
    ``"poll"`` = fetched via ``/api/positions`` polling (latency = poll
    interval). Server payloads never include this field directly — the SDK
    stamps it before handing the payload to the caller.

    ``seq`` / ``prev_seq`` are per-user monotonic broadcast sequence numbers.
    A consumer that sees a gap (``seq != last_seen + 1``) can fetch missed
    payloads via ``positions_since(last_seen)``.
    """

    streams: list[DataStream]
    context: GlobalContext
    positions: list[DesiredPosition]
    updates: list[UpdateCard]
    transport: PositionTransport | None = None
    seq: int = 0
    prev_seq: int = 0


class PositionsSinceResponse(_WireModel):
    """Response from ``PositClient.positions_since()``."""

    payloads: list[PositionPayload]
    gap_detected: bool = False
    latest_seq: int
