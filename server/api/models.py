"""
Pydantic request / response models for the stream & snapshot ingestion API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

# Single source of truth — imported by prompts/__init__.py and service.py.
ChatMode = Literal["investigate", "build", "general"]

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from server.api.expiry import canonical_expiry_key


# ---------------------------------------------------------------------------
# Shared submodels (used across endpoints)
# ---------------------------------------------------------------------------

class _WireModel(BaseModel):
    """Base for outbound wire-shape models.

    Emits camelCase JSON via an alias generator but accepts either
    camelCase or snake_case on input.  Use for models whose JSON
    representation must be camelCase (pipeline time-series endpoints,
    WebSocket broadcast payloads).  Endpoints whose wire format is
    already snake_case (``BlockRowResponse``, ``StreamResponse``, etc.)
    stay on plain ``BaseModel``.
    """
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SnapshotRow(BaseModel):
    """One row of a snapshot ingestion payload.

    Extra keys are permitted because the set of ``key_cols`` varies per
    stream — the server validates the required set at ingestion time in
    ``stream_registry.ingest_snapshot``. Everything else (timestamp,
    raw_value) is statically required.

    Empty strings on any field are canonicalised to ``None`` before field
    validation so downstream Polars casts (e.g. ``market_value`` → Float64
    in the pipeline) don't see ``""`` in a numeric column. This is the
    single canonical point every ingest path (HTTP POST, /ws/client, and
    ManualBlockRequest.snapshot_rows) passes through.
    """
    model_config = {"extra": "allow"}

    timestamp: str = Field(..., description="ISO 8601 timestamp")
    raw_value: float = Field(..., description="Raw measurement value")

    @model_validator(mode="before")
    @classmethod
    def _empty_strings_to_none(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        return {k: (None if isinstance(v, str) and v == "" else v) for k, v in data.items()}


class CellContext(BaseModel):
    """Cell context forwarded to the LLM investigation endpoint.

    Mirrors ``InvestigationContext`` in ``client/ui/src/types.ts``. The
    discriminated ``type`` field distinguishes between a card click and a
    cell click; the remaining shape is passed through unchanged because
    it duplicates fields already validated on the client side.
    """
    model_config = {"extra": "allow"}

    type: Literal["update", "position"]


# ---------------------------------------------------------------------------
# LLM endpoints
# ---------------------------------------------------------------------------

class InvestigateRequest(BaseModel):
    conversation: list[dict[str, str]] = Field(
        ...,
        description="OpenAI-style message array: [{role, content}, ...]",
    )
    cell_context: CellContext | None = Field(
        default=None,
        description="Optional cell/card context clicked by the user",
    )
    mode: ChatMode = Field(
        default="investigate",
        description="Chat mode — controls which prompt modules the server uses",
    )


# ---------------------------------------------------------------------------
# Stream management
# ---------------------------------------------------------------------------

class CreateStreamRequest(BaseModel):
    """User creates a new data stream (enters PENDING status)."""
    stream_name: str = Field(..., min_length=1, description="Unique stream identifier")
    key_cols: list[str] = Field(..., min_length=1, description="Index columns for deduplication")


class UpdateStreamRequest(BaseModel):
    """User updates mutable fields on an existing stream."""
    stream_name: str | None = Field(default=None, min_length=1, description="New stream name (rename)")
    key_cols: list[str] | None = Field(default=None, min_length=1, description="Updated key columns")


class BlockConfigPayload(BaseModel):
    """JSON-friendly representation of BlockConfig fields."""
    annualized: bool = True
    temporal_position: Literal["static", "shifting"] = "shifting"
    decay_end_size_mult: float = 1.0
    decay_rate_prop_per_min: float = 0.0
    decay_profile: Literal["linear"] = "linear"
    var_fair_ratio: float = 1.0


class AdminConfigureStreamRequest(BaseModel):
    """Admin fills in the pipeline-facing parameters to move stream → READY.

    ``scale`` / ``offset`` / ``exponent`` are the raw→calc conversion
    parameters (unit_conversion step). The final target-space map is a
    separate ``calc_to_target`` step configured globally via the transforms
    endpoint, not per stream.
    """
    scale: float = Field(..., description="Multiplicative scale for raw → calc conversion")
    offset: float = Field(0.0, description="Additive offset for raw → calc conversion")
    exponent: float = Field(1.0, description="Power exponent for raw → calc conversion")
    block: BlockConfigPayload = Field(default_factory=BlockConfigPayload)
    # None → fan this stream's blocks out to every (symbol, expiry) in the
    # dim universe at Stage A. A list → exactly those pairs; ingest raises
    # HTTP 400 if any pair isn't in the current dim universe.
    applies_to: list[tuple[str, str]] | None = None
    # Authoring-only fields — not consumed by the pipeline, stored so the
    # Stream Canvas can re-hydrate the exact draft the user last activated.
    description: str | None = None
    sample_csv: str | None = None
    value_column: str | None = None


class StreamResponse(BaseModel):
    """Single stream in API responses."""
    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    active: bool = True
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfigPayload | None = None
    description: str | None = None
    sample_csv: str | None = None
    value_column: str | None = None


class StreamListResponse(BaseModel):
    streams: list[StreamResponse]


class StreamStateResponse(BaseModel):
    """Extended stream metadata — configuration plus ingestion state.

    Returned from ``GET /api/streams/{name}``. A superset of ``StreamResponse``
    with the operational fields integrators need when debugging ("is data
    arriving? how many rows? when was the last push?") — the subset that
    was only observable via `curl` + manual header juggling before.
    """
    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    active: bool = True
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfigPayload | None = None
    description: str | None = None
    sample_csv: str | None = None
    value_column: str | None = None
    row_count: int
    last_ingest_ts: str | None = None


class SetStreamActiveRequest(BaseModel):
    """Flip a stream's active flag without touching any other field."""
    active: bool


class StreamTimeseriesPoint(BaseModel):
    """One point in a single stream-key time series."""
    timestamp: str
    raw_value: float


class StreamKeyTimeseries(BaseModel):
    """Time series for one unique key-column combination within a stream."""
    key: dict[str, str]
    points: list[StreamTimeseriesPoint]


class StreamTimeseriesResponse(BaseModel):
    """Response for ``GET /api/streams/{stream_name}/timeseries``.

    Groups the stream's snapshot rows by key-column combination so each unique
    key (e.g. ``{symbol: BTC, expiry: 27MAR26}``) gets its own value series.

    `status` + `row_count` let the client distinguish between "stream missing"
    (404), "stream registered but no rows yet" (empty series), and the
    healthy case (populated series).
    """
    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    row_count: int
    series: list[StreamKeyTimeseries]


# ---------------------------------------------------------------------------
# Snapshot ingestion
# ---------------------------------------------------------------------------

class SnapshotRequest(BaseModel):
    """Client pushes new snapshot rows for a READY stream."""
    stream_name: str = Field(..., min_length=1)
    rows: list[SnapshotRow] = Field(
        ...,
        min_length=1,
        description=(
            "Snapshot rows. Each row must contain 'timestamp', 'raw_value', "
            "and all key_cols defined on the stream."
        ),
    )
    allow_zero_edge: bool = Field(
        False,
        description=(
            "Acknowledge that the first push on a freshly-configured stream "
            "may produce zero positions because no market_value is carried "
            "(per-row or aggregate). Default False fails closed — see the "
            "zero-edge guard for the contract."
        ),
    )


class SnapshotResponse(BaseModel):
    stream_name: str
    rows_accepted: int
    pipeline_rerun: bool
    server_seq: int = Field(
        0,
        description=(
            "Server-assigned monotonic sequence number for this ingest. "
            "Paired with the WS ACK's server_seq so consumers have a single "
            "correlation key regardless of transport."
        ),
    )


# ---------------------------------------------------------------------------
# Bankroll
# ---------------------------------------------------------------------------

class BankrollRequest(BaseModel):
    bankroll: float = Field(..., gt=0, description="Portfolio bankroll")


class BankrollResponse(BaseModel):
    bankroll: float
    pipeline_rerun: bool


# ---------------------------------------------------------------------------
# Client-facing WebSocket frames
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Block table
# ---------------------------------------------------------------------------

class BlockRowResponse(BaseModel):
    """A single block row in the block configuration table."""
    block_name: str
    stream_name: str
    symbol: str
    expiry: str
    space_id: str
    source: Literal["stream", "manual"]
    # Engine parameters
    annualized: bool
    temporal_position: Literal["static", "shifting"]
    decay_end_size_mult: float
    decay_rate_prop_per_min: float
    var_fair_ratio: float
    scale: float
    offset: float
    exponent: float
    # Which (symbol, expiry) pairs this block fans out to — None means "every
    # pair in the dim universe" (default behaviour).
    applies_to: list[tuple[str, str]] | None = None
    # Output values
    raw_value: float
    fair: float | None = None
    var: float | None = None
    market_value_source: Literal["block", "aggregate", "passthrough"] | None = None
    # Timing
    start_timestamp: str | None = None
    updated_at: str | None = None


class BlockListResponse(BaseModel):
    blocks: list[BlockRowResponse]


class ManualBlockRequest(BaseModel):
    """User creates a manual block by specifying all input parameters."""
    stream_name: str = Field(..., min_length=1, description="Name for the manual stream")
    key_cols: list[str] = Field(default_factory=lambda: ["symbol", "expiry"], description="Index columns")
    scale: float = Field(1.0, description="Multiplicative scale for raw → calc conversion")
    offset: float = Field(0.0, description="Additive offset")
    exponent: float = Field(1.0, description="Power exponent")
    block: BlockConfigPayload = Field(default_factory=BlockConfigPayload)
    snapshot_rows: list[SnapshotRow] = Field(
        ...,
        min_length=1,
        description="Snapshot rows with timestamp, raw_value, and all key_cols",
    )
    space_id: str | None = Field(
        default=None,
        description="Optional custom space_id (overrides auto-computed value from temporal_position).",
    )
    applies_to: list[tuple[str, str]] | None = Field(
        default=None,
        description="(symbol, expiry) pairs this block fans out to. None = every pair in the dim universe.",
    )


class UpdateBlockRequest(BaseModel):
    """User updates an existing block's engine parameters and/or snapshot."""
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfigPayload | None = None
    snapshot_rows: list[SnapshotRow] | None = None
    applies_to: list[tuple[str, str]] | None = None


class ClientWsInboundFrame(BaseModel):
    """Text frame sent by the client over the /ws/client channel.

    The client sends snapshot rows for a named stream.  Each frame
    receives a JSON ACK so the client knows we processed it.
    """
    seq: int = Field(..., description="Sequence number — echoed back in ACK")
    stream_name: str = Field(..., min_length=1)
    rows: list[SnapshotRow] = Field(
        ...,
        min_length=1,
        description=(
            "Snapshot rows. Each row must contain 'timestamp', 'raw_value', "
            "and all key_cols defined on the stream."
        ),
    )
    allow_zero_edge: bool = Field(
        False,
        description=(
            "Acknowledge that the first push on a freshly-configured stream "
            "may produce zero positions because no market_value is carried. "
            "See SnapshotRequest.allow_zero_edge."
        ),
    )


class ClientWsMarketValueFrame(BaseModel):
    """Market value frame sent by the client over /ws/client.

    Carries aggregate market vol entries that are written to the
    MarketValueStore.  No immediate pipeline rerun — the dirty-flag
    coalescing in the WS ticker picks it up on the next tick.
    """
    type: Literal["market_value"] = "market_value"
    seq: int = Field(..., description="Sequence number — echoed back in ACK")
    entries: list[MarketValueEntry] = Field(
        ...,
        min_length=1,
        description="Aggregate market value entries to store",
    )


class ClientWsAck(BaseModel):
    """ACK response sent back for every inbound frame."""
    type: Literal["ack"] = "ack"
    seq: int = Field(..., description="Echoed sequence number from the inbound frame")
    rows_accepted: int = 0
    pipeline_rerun: bool = False
    server_seq: int = Field(
        0,
        description=(
            "Server-assigned monotonic sequence number — matches the value "
            "`SnapshotResponse.server_seq` returns for the REST ingest path."
        ),
    )


class ClientWsError(BaseModel):
    """Error response sent when an inbound frame fails validation/processing."""
    type: Literal["error"] = "error"
    seq: int | None = Field(None, description="Sequence number if parseable, else null")
    detail: str


# Discriminated union for everything the server can send back on /ws/client.
# The ``type`` literal on each member doubles as the runtime discriminator
# for any parser that wants to decode an outbound frame without trial-and-
# error matching (e.g. the client-side adapter, for future use).
ClientWsOutboundFrame = Annotated[
    Union[ClientWsAck, ClientWsError],
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------
# Transform configuration
# ---------------------------------------------------------------------------

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
    position_sizing: str | None = None
    position_sizing_params: dict[str, Any] | None = None
    smoothing: str | None = None
    smoothing_params: dict[str, Any] | None = None
    market_value_inference: str | None = None
    market_value_inference_params: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Aggregate market values
# ---------------------------------------------------------------------------

class MarketValueEntry(BaseModel):
    """One aggregate market value entry for a symbol/expiry pair.

    ``expiry`` is normalised to the canonical naive-ISO key on ingest so the
    store holds the same form the Polars pipeline looks up with — see
    ``server/api/expiry.py``.
    """
    symbol: str = Field(..., min_length=1)
    expiry: str = Field(..., min_length=1)
    total_vol: float = Field(..., ge=0, description="Annualized total vol (must be >= 0)")

    @field_validator("expiry")
    @classmethod
    def _canonicalise_expiry(cls, v: str) -> str:
        return canonical_expiry_key(v)


class SetMarketValueRequest(BaseModel):
    """Batch-set aggregate market values."""
    entries: list[MarketValueEntry] = Field(..., min_length=1)


class MarketValueListResponse(BaseModel):
    """All aggregate market values currently stored."""
    entries: list[MarketValueEntry]


class DeleteMarketValueResponse(BaseModel):
    """Response for ``DELETE /api/market-values/{symbol}/{expiry}``."""
    deleted: bool
    symbol: str
    expiry: str


# ---------------------------------------------------------------------------
# Broadcast wire shapes (camelCase on the wire — see _WireModel)
# ---------------------------------------------------------------------------
# These models formalize the JSON shapes currently composed as raw dicts
# in ``ws_serializers.py`` (streams_from_registry, context_at_tick,
# positions_at_tick, updates_from_diff) and in ``routers/pipeline.py``
# (block/aggregated/current-decomposition time series).  Wire shape is
# unchanged; the models add runtime contract validation + a single
# source of truth for the TS mirrors in ``client/ui/src/types.ts``.

class DataStream(_WireModel):
    """One data-stream entry in the pipeline broadcast.

    ``active`` mirrors the registry flag — inactive streams are still emitted
    on the WS payload (so the UI can render them dimmed and offer a
    reactivate affordance) but their blocks don't appear in the pipeline
    output for this tick.
    """
    id: str
    name: str
    status: Literal["ONLINE", "DEGRADED", "OFFLINE"]
    last_heartbeat: int
    active: bool = True


class GlobalContext(_WireModel):
    """Global context strip — shown in the top bar."""
    last_update_timestamp: int


class DesiredPosition(_WireModel):
    """One row of the desired-position grid.

    Variance-space scalars (``edge`` / ``variance`` / ``total_fair`` / …) are
    kept for the math-facing surfaces (``LiveEquationStrip``, pipeline chart).
    The ``*_vol`` fields lift those back into annualised vol points via the
    inverse of ``total_vol ** 2 → aggregate_var`` — sum the per-grid-cell
    variance-unit value from the current tick to expiry, divide by T in
    years, sign-preserving sqrt. That's the number an options trader reads.
    """
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
    smoothed_total_fair: float
    total_market_fair: float
    smoothed_total_market_fair: float
    edge_vol: float
    smoothed_edge_vol: float
    variance_vol: float
    smoothed_var_vol: float
    total_fair_vol: float
    smoothed_total_fair_vol: float
    total_market_fair_vol: float
    smoothed_total_market_fair_vol: float
    market_vol: float
    change_magnitude: float
    updated_at: int


class UpdateCard(_WireModel):
    """A position-change update card in the feed."""
    id: str
    symbol: str
    expiry: str
    old_pos: float
    new_pos: float
    delta: float
    timestamp: int


class UnregisteredPushAttempt(_WireModel):
    """One entry in the unregistered-stream push notification list.

    Populated by the snapshots router / client WS when a caller pushes to
    a ``stream_name`` the server does not know, so the UI can render a
    notification with an example row and a "Register this stream" CTA that
    deep-links into Anatomy with the stream form pre-filled. The caller
    itself still receives 409 ``STREAM_NOT_REGISTERED`` — this model is the
    operator-side surface, not an ingest path.
    """
    stream_name: str
    example_row: dict[str, Any]
    attempt_count: int
    first_seen: str  # ISO 8601 UTC
    last_seen: str  # ISO 8601 UTC


class MarketValueMismatchAlert(_WireModel):
    """Per-(symbol, expiry) alert when per-block market values don't reconcile
    to the user's aggregate marketVol.

    The market-value-inference step is built so that the forward-integrated
    per-block ``target_market_value`` equals the aggregate variance — i.e.
    ``totalMarketFairVol`` (what the pipeline implies) equals ``marketVol``
    (what the user set). When the two visibly disagree, it's a real
    inconsistency: either the user overrode per-block values past what the
    inferred blocks can absorb, or no inferred blocks have forward coverage,
    or no aggregate was set at all but per-block values are non-zero.

    All three fields are in vol points (annualised vol × 100) so the card can
    render them directly alongside the CellInspector reading.
    """
    symbol: str
    expiry: str  # wire format (DDMMMYY), matches DesiredPosition.expiry
    aggregate_vol: float  # user-set marketVol, 0 if unset
    implied_vol: float  # totalMarketFairVol from the pipeline
    diff: float  # implied - aggregate


class SilentStreamAlert(_WireModel):
    """A READY stream whose recent snapshots carried no ``market_value``.

    When a stream emits only ``raw_value``, the pipeline defaults
    market-implied value to match fair — edge collapses to zero and every
    desired position reads zero with no explanation. Surfacing the alert
    lets the trader see the cause. Threshold is ``SILENT_STREAM_THRESHOLD``
    in ``config.py``; the counter resets the moment a row with a non-None
    ``market_value`` arrives.
    """
    stream_name: str
    rows_seen: int
    first_seen: str  # ISO 8601 UTC
    last_seen: str  # ISO 8601 UTC


ZeroPositionReason = Literal[
    "no_market_value",
    "zero_variance",
    "zero_bankroll",
    "no_active_blocks",
    "edge_coincidence",
    "unknown",
]


class ZeroPositionDiagnostic(_WireModel):
    """One (symbol, expiry) whose desired_pos is (near-)zero, with a reason.

    Returned from ``GET /api/diagnostics/zero-positions``. Surfaces the single
    most common integrator failure ("my positions are zero and there's no
    error") with a closed-enum reason + the scalars to verify.

    ``aggregate_market_value`` is ``None`` when no aggregate has been set for
    this (symbol, expiry); a concrete value means an entry exists in the
    user's ``MarketValueStore``.
    """
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


class ZeroPositionDiagnosticsResponse(_WireModel):
    """Response for ``GET /api/diagnostics/zero-positions``."""
    bankroll: float
    tick_timestamp: int | None = None
    diagnostics: list[ZeroPositionDiagnostic]


class ServerPayload(_WireModel):
    """Top-level payload broadcast on ``/ws`` each tick.

    ``seq`` / ``prev_seq`` are per-user monotonic broadcast sequence numbers;
    together they let a reconnecting consumer detect gaps and fetch missed
    payloads via ``GET /api/positions/since/{seq}``.
    """
    streams: list[DataStream]
    context: GlobalContext
    positions: list[DesiredPosition]
    updates: list[UpdateCard]
    unregistered_pushes: list[UnregisteredPushAttempt] = Field(default_factory=list)
    silent_streams: list[SilentStreamAlert] = Field(default_factory=list)
    market_value_mismatches: list[MarketValueMismatchAlert] = Field(default_factory=list)
    seq: int = 0
    prev_seq: int = 0


class PositionsSinceResponse(_WireModel):
    """Response for ``GET /api/positions/since/{seq}``.

    ``payloads`` are full ServerPayloads with monotonically increasing
    ``seq``. ``gap_detected`` is True if the caller asked for a seq older
    than the server's replay buffer holds — in that case ``payloads`` is
    the oldest N, and the caller should assume state is stale.
    """
    payloads: list[ServerPayload]
    gap_detected: bool = False
    latest_seq: int


# ---------------------------------------------------------------------------
# Pipeline time-series wire shapes
# ---------------------------------------------------------------------------

class TimeSeriesDimension(_WireModel):
    """A single (symbol, expiry) pair from the pipeline dimensions list."""
    symbol: str
    expiry: str


class PipelineDimensionsResponse(_WireModel):
    """Response for ``GET /api/pipeline/dimensions``.

    ``dimension_cols`` names the server-wide risk-dimension column set
    (``RISK_DIMENSION_COLS``) that every stream's ``key_cols`` must be a
    superset of. Clients fetch this once to validate ``create_stream``
    arguments up-front — the field is stable server configuration, not
    derived from the pipeline, so it's populated even when ``dimensions``
    is empty (fresh account, no streams yet).
    """
    dimensions: list[TimeSeriesDimension]
    dimension_cols: list[str] = Field(default_factory=list)


class BlockTimeSeries(_WireModel):
    """Per-block time series for one block on one dimension.

    Pivoted onto a shared `blockTimestamps` axis at the response level so
    the chart can use one x-axis for all blocks. None values mark ticks
    where this particular block doesn't have data (different blocks can
    have different start_timestamps).

    ``stream_name`` and ``start_timestamp`` are carried so the client can
    reconstruct the full composite block identity from a chart series — on
    the same (symbol, expiry), ``block_name`` alone can collide across
    streams.
    """
    block_name: str
    stream_name: str
    space_id: str
    start_timestamp: str | None = None
    timestamps: list[str]
    fair: list[float | None]
    var: list[float | None]


class SpaceSeries(_WireModel):
    """Per-space calc-space contribution lines, aligned with
    ``AggregatedTimeSeries.timestamps``.

    Spaces combine by a pure sum in calc space (Stage D.2 ``aggregation``),
    so these arrays are linearly additive across ``space_id`` at any
    timestamp — the Pipeline chart's decomposition view stacks them. Values
    are in **calc space** (variance-linear), not the display's target-space
    (vol-points) units — the chart labels the y-axis accordingly.
    """
    fair: list[float]
    var: list[float]
    market_fair: list[float]


class AggregatedTimeSeries(_WireModel):
    """Aggregated time series across all blocks on one dimension.

    ``market_vol`` is the user-entered aggregate market vol — same source
    as the grid's Market tab and the WS ticker's ``marketVol`` field —
    emitted as a parallel vol-points series so the Pipeline chart's Market
    view reads identically to the grid cell.

    ``per_space`` carries the calc-space decomposition keyed by
    ``space_id``; empty when the payload comes from the historical ring
    buffer (no per-space history captured there yet).
    """
    timestamps: list[str]
    total_fair: list[float]
    smoothed_total_fair: list[float]
    total_market_fair: list[float]
    smoothed_total_market_fair: list[float]
    edge: list[float]
    smoothed_edge: list[float]
    var: list[float]
    smoothed_var: list[float]
    raw_desired_position: list[float]
    smoothed_desired_position: list[float]
    market_vol: list[float]
    per_space: dict[str, SpaceSeries] = Field(default_factory=dict)


class CurrentBlockDecomposition(_WireModel):
    """Block decomposition snapshot at the current tick timestamp."""
    block_name: str
    stream_name: str
    space_id: str
    start_timestamp: str | None = None
    fair: float
    var: float


class CurrentAggregatedDecomposition(_WireModel):
    """Aggregated decomposition snapshot at the current tick timestamp."""
    total_fair: float
    total_market_fair: float
    edge: float
    smoothed_edge: float
    var: float
    smoothed_var: float
    raw_desired_position: float
    smoothed_desired_position: float


class AggregateMarketValue(_WireModel):
    """The user's set total vol for a (symbol, expiry), if any."""
    total_vol: float


class CurrentDecomposition(_WireModel):
    """Everything the client needs to render the decomposition panel at
    the current tick: per-block + aggregated + the user's set total vol.
    """
    blocks: list[CurrentBlockDecomposition]
    aggregated: CurrentAggregatedDecomposition | None = None
    aggregate_market_value: AggregateMarketValue | None = None


class PipelineTimeSeriesResponse(_WireModel):
    """Response for ``GET /api/pipeline/timeseries``.

    `aggregated.timestamps` is the historical position axis (used by the
    Position view); `block_timestamps` is the forward-looking axis
    spanning current_ts → expiry (used by the Fair / Variance views).
    The two axes are independent on purpose — positions are
    backward-looking and block fair/var curves project forward to expiry.
    """
    symbol: str
    expiry: str
    blocks: list[BlockTimeSeries]
    block_timestamps: list[str]
    aggregated: AggregatedTimeSeries
    current_decomposition: CurrentDecomposition


# ---------------------------------------------------------------------------
# Multi-user auth + account + admin
# ---------------------------------------------------------------------------

# Charset + length rules match the spec: case-insensitive, 3–32 chars, [a-zA-Z0-9_-].
USERNAME_PATTERN = r"^[A-Za-z0-9_-]{3,32}$"
PASSWORD_MIN_LENGTH = 8


class UserPublic(BaseModel):
    """Non-secret user profile — safe to return anywhere in the API."""
    id: str
    username: str  # display form (original casing)
    created_at: datetime
    is_admin: bool


class SignupRequest(BaseModel):
    """Fully-open signup payload. Charset/length validated by the pattern + min_length."""
    username: str = Field(..., pattern=USERNAME_PATTERN)
    password: str = Field(..., min_length=PASSWORD_MIN_LENGTH)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    session_token: str
    user: UserPublic


class ApiKeyResponse(BaseModel):
    """Returned only on ``GET /api/account/key`` and the regenerate endpoint."""
    api_key: str


class UsageEventRequest(BaseModel):
    type: Literal[
        "panel_open",
        "panel_close",
        "manual_block_create",
        "cell_click",
        "app_focus",
        "app_blur",
    ]
    # Metadata is intentionally low-cardinality + non-PII — enforced at the
    # type level so a client accidentally stuffing a user message / raw row
    # into it fails validation rather than silently leaking to storage.
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)


class AdminUserSummary(BaseModel):
    """One row of the admin usage dashboard."""
    id: str
    username: str
    created_at: datetime
    last_login_at: datetime | None
    active_ws_connections: int
    manual_block_count: int
    total_sessions: int
    total_time_seconds: int


class AdminUserListResponse(BaseModel):
    users: list[AdminUserSummary]
