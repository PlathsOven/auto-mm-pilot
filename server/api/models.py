"""
Pydantic request / response models for the stream & snapshot ingestion API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

# Single source of truth — imported by prompts/__init__.py and service.py.
ChatMode = Literal["investigate", "build", "general"]

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


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
    """
    model_config = {"extra": "allow"}

    timestamp: str = Field(..., description="ISO 8601 timestamp")
    raw_value: float = Field(..., description="Raw measurement value")
    market_value: float | None = Field(
        default=None,
        description="Market-implied value in same raw units as raw_value. Defaults to raw_value if omitted.",
    )


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
    size_type: Literal["fixed", "relative"] = "fixed"
    aggregation_logic: Literal["average", "offset"] = "average"
    temporal_position: Literal["static", "shifting"] = "shifting"
    decay_end_size_mult: float = 1.0
    decay_rate_prop_per_min: float = 0.0
    decay_profile: Literal["linear"] = "linear"
    var_fair_ratio: float = 1.0


class AdminConfigureStreamRequest(BaseModel):
    """Admin fills in the pipeline-facing parameters to move stream → READY."""
    scale: float = Field(..., description="Multiplicative scale for raw → target conversion")
    offset: float = Field(0.0, description="Additive offset for raw → target conversion")
    exponent: float = Field(1.0, description="Power exponent for raw → target conversion")
    block: BlockConfigPayload = Field(default_factory=BlockConfigPayload)


class StreamResponse(BaseModel):
    """Single stream in API responses."""
    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfigPayload | None = None


class StreamListResponse(BaseModel):
    streams: list[StreamResponse]


class StreamTimeseriesPoint(BaseModel):
    """One point in a single stream-key time series."""
    timestamp: str
    raw_value: float
    market_value: float | None = None


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


class SnapshotResponse(BaseModel):
    stream_name: str
    rows_accepted: int
    pipeline_rerun: bool


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
    size_type: Literal["fixed", "relative"]
    aggregation_logic: Literal["average", "offset"]
    temporal_position: Literal["static", "shifting"]
    decay_end_size_mult: float
    decay_rate_prop_per_min: float
    var_fair_ratio: float
    scale: float
    offset: float
    exponent: float
    # Output values
    target_value: float
    raw_value: float
    market_value: float | None = None
    target_market_value: float | None = None
    fair: float | None = None
    market_fair: float | None = None
    var: float | None = None
    # Timing
    start_timestamp: str | None = None
    updated_at: str | None = None


class BlockListResponse(BaseModel):
    blocks: list[BlockRowResponse]


class ManualBlockRequest(BaseModel):
    """User creates a manual block by specifying all input parameters."""
    stream_name: str = Field(..., min_length=1, description="Name for the manual stream")
    key_cols: list[str] = Field(default_factory=lambda: ["symbol", "expiry"], description="Index columns")
    scale: float = Field(1.0, description="Multiplicative scale for raw → target conversion")
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


class UpdateBlockRequest(BaseModel):
    """User updates an existing block's engine parameters and/or snapshot."""
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfigPayload | None = None
    snapshot_rows: list[SnapshotRow] | None = None


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
    aggregation: str | None = None
    aggregation_params: dict[str, Any] | None = None
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
    """One aggregate market value entry for a symbol/expiry pair."""
    symbol: str = Field(..., min_length=1)
    expiry: str = Field(..., min_length=1)
    total_vol: float = Field(..., ge=0, description="Annualized total vol (must be >= 0)")


class SetMarketValueRequest(BaseModel):
    """Batch-set aggregate market values."""
    entries: list[MarketValueEntry] = Field(..., min_length=1)


class MarketValueListResponse(BaseModel):
    """All aggregate market values currently stored."""
    entries: list[MarketValueEntry]


# ---------------------------------------------------------------------------
# Broadcast wire shapes (camelCase on the wire — see _WireModel)
# ---------------------------------------------------------------------------
# These models formalize the JSON shapes currently composed as raw dicts
# in ``ws_serializers.py`` (streams_from_blocks, context_at_tick,
# positions_at_tick, updates_from_diff) and in ``routers/pipeline.py``
# (block/aggregated/current-decomposition time series).  Wire shape is
# unchanged; the models add runtime contract validation + a single
# source of truth for the TS mirrors in ``client/ui/src/types.ts``.

class DataStream(_WireModel):
    """One data-stream entry in the pipeline broadcast."""
    id: str
    name: str
    status: Literal["ONLINE", "DEGRADED", "OFFLINE"]
    last_heartbeat: int


class GlobalContext(_WireModel):
    """Global context strip — shown in the top bar."""
    last_update_timestamp: int


class DesiredPosition(_WireModel):
    """One row of the desired-position grid."""
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
    """A position-change update card in the feed."""
    id: str
    symbol: str
    expiry: str
    old_pos: float
    new_pos: float
    delta: float
    timestamp: int


class ServerPayload(_WireModel):
    """Top-level payload broadcast on ``/ws`` each tick."""
    streams: list[DataStream]
    context: GlobalContext
    positions: list[DesiredPosition]
    updates: list[UpdateCard]


# ---------------------------------------------------------------------------
# Pipeline time-series wire shapes
# ---------------------------------------------------------------------------

class TimeSeriesDimension(_WireModel):
    """A single (symbol, expiry) pair from the pipeline dimensions list."""
    symbol: str
    expiry: str


class PipelineDimensionsResponse(_WireModel):
    """Response for ``GET /api/pipeline/dimensions``."""
    dimensions: list[TimeSeriesDimension]


class BlockTimeSeries(_WireModel):
    """Per-block time series for one block on one dimension.

    Pivoted onto a shared `blockTimestamps` axis at the response level so
    the chart can use one x-axis for all blocks. None values mark ticks
    where this particular block doesn't have data (different blocks can
    have different start_timestamps).
    """
    block_name: str
    space_id: str
    aggregation_logic: str
    timestamps: list[str]
    fair: list[float | None]
    market_fair: list[float | None]
    var: list[float | None]


class AggregatedTimeSeries(_WireModel):
    """Aggregated time series across all blocks on one dimension."""
    timestamps: list[str]
    total_fair: list[float]
    total_market_fair: list[float]
    edge: list[float]
    smoothed_edge: list[float]
    var: list[float]
    smoothed_var: list[float]
    raw_desired_position: list[float]
    smoothed_desired_position: list[float]


class CurrentBlockDecomposition(_WireModel):
    """Block decomposition snapshot at the current tick timestamp."""
    block_name: str
    space_id: str
    fair: float
    market_fair: float
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
