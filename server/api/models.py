"""
Pydantic request / response models for the stream & snapshot ingestion API.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# LLM endpoints
# ---------------------------------------------------------------------------

class InvestigateRequest(BaseModel):
    conversation: list[dict[str, str]] = Field(
        ...,
        description="OpenAI-style message array: [{role, content}, ...]",
    )
    cell_context: dict[str, Any] | None = Field(
        default=None,
        description="Optional cell/card context clicked by the user",
    )


class JustifyRequest(BaseModel):
    asset: str
    expiry: str
    old_pos: float
    new_pos: float
    delta: float


class JustifyResponse(BaseModel):
    justification: str


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


# ---------------------------------------------------------------------------
# Snapshot ingestion
# ---------------------------------------------------------------------------

class SnapshotRequest(BaseModel):
    """Client pushes new snapshot rows for a READY stream."""
    stream_name: str = Field(..., min_length=1)
    rows: list[dict[str, Any]] = Field(
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
# Market pricing
# ---------------------------------------------------------------------------

class MarketPricingRequest(BaseModel):
    """Client supplies market-implied pricing keyed by space_id."""
    pricing: dict[str, float] = Field(
        ...,
        min_length=1,
        description="Market pricing per space_id, e.g. {'shifting': 0.55}",
    )


class MarketPricingResponse(BaseModel):
    spaces_updated: int
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
    snapshot_rows: list[dict[str, Any]] = Field(
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
    snapshot_rows: list[dict[str, Any]] | None = None


class ClientWsInboundFrame(BaseModel):
    """Text frame sent by the client over the /ws/client channel.

    The client sends snapshot rows for a named stream.  Each frame
    receives a JSON ACK so the client knows we processed it.
    """
    seq: int = Field(..., description="Sequence number — echoed back in ACK")
    stream_name: str = Field(..., min_length=1)
    rows: list[dict[str, Any]] = Field(
        ...,
        min_length=1,
        description=(
            "Snapshot rows. Each row must contain 'timestamp', 'raw_value', "
            "and all key_cols defined on the stream."
        ),
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


class TransformStepResponse(BaseModel):
    """A pipeline step with its available transforms and current selection."""
    label: str
    contract: str
    selected: str
    params: dict[str, Any]
    transforms: list[TransformResponse]


class TransformListResponse(BaseModel):
    """All pipeline steps with their transform libraries."""
    steps: dict[str, TransformStepResponse]


class TransformConfigRequest(BaseModel):
    """Update transform selections and/or parameter values."""
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
