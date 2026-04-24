"""
Stream + connector lifecycle wire shapes.

Everything that crosses the API boundary for stream CRUD, the connector
catalog, and connector-fed ingest.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


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


# ---------------------------------------------------------------------------
# Connector catalog + ingest
# ---------------------------------------------------------------------------

class ConnectorParamSchema(BaseModel):
    """One user-tunable parameter exposed by a connector.

    ``min`` / ``max`` are inclusive bounds — ``None`` means unbounded.
    The Stream Canvas renders the type-appropriate input + range hint;
    server-side validation enforces the same bounds before state is built.
    """
    name: str
    type: Literal["int", "float", "list_int", "list_float"]
    default: Any
    description: str
    min: float | None = None
    max: float | None = None


class ConnectorInputFieldSchema(BaseModel):
    """One non-key, non-timestamp field expected on every connector input row."""
    name: str
    type: Literal["float", "int", "str"]
    description: str


class ConnectorSchema(BaseModel):
    """Full catalog metadata for a single connector.

    The Stream Canvas uses ``recommended_*`` to auto-fill + lock sections
    3–6 when the connector is picked. ``params`` populates the inline
    parameter editor inside the canvas's identity section.
    """
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
    recommended_block: BlockConfigPayload


class ConnectorCatalogResponse(BaseModel):
    """Response for ``GET /api/connectors``."""
    connectors: list[ConnectorSchema]


class ConnectorInputRow(BaseModel):
    """One row of a connector input batch.

    Connectors expose their own input schemas (``input_key_cols`` +
    ``input_value_fields``) — extra fields are permitted on the wire and
    validated against that schema at ingest time, exactly mirroring how
    ``SnapshotRow`` handles per-stream key columns.
    """
    model_config = {"extra": "allow"}

    timestamp: str = Field(..., description="ISO 8601 timestamp")


class ConnectorInputRequest(BaseModel):
    """Client pushes a batch of connector input rows for a connector-fed stream."""
    stream_name: str = Field(..., min_length=1)
    rows: list[ConnectorInputRow] = Field(..., min_length=1)


class ConnectorInputResponse(BaseModel):
    """Response for ``POST /api/streams/{name}/connector-input``.

    ``rows_accepted`` is the count of inbound rows the connector consumed;
    ``rows_emitted`` is the count of ``SnapshotRow`` entries the connector
    wrote into the stream's ``snapshot_rows`` (zero or more — the connector
    only emits when its computed value crosses the change threshold).
    """
    stream_name: str
    rows_accepted: int
    rows_emitted: int
    pipeline_rerun: bool
    server_seq: int = 0


class ConnectorStateSummary(BaseModel):
    """Lightweight per-stream connector telemetry surfaced in the Inspector.

    All connectors emit the same warmup-progress numbers so the UI can
    render a generic "warming up" badge without per-connector logic.
    ``min_n_eff / warmup_threshold`` clamped to ``[0, 1]`` is the fill
    fraction for the badge.
    """
    min_n_eff: float
    warmup_threshold: float
    symbols_tracked: int


class AdminConfigureStreamRequest(BaseModel):
    """Admin fills in the pipeline-facing parameters to move stream → READY.

    ``scale`` / ``offset`` / ``exponent`` are the raw→calc conversion
    parameters (unit_conversion step). The final target-space map is a
    separate ``calc_to_target`` step configured globally via the transforms
    endpoint, not per stream.

    When ``connector_name`` is set the stream is connector-fed: snapshot
    pushes are rejected (use ``POST /api/streams/{name}/connector-input``
    instead) and the connector owns ``raw_value`` emission.
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
    connector_name: str | None = None
    connector_params: dict[str, Any] | None = None


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
    connector_name: str | None = None
    connector_params: dict[str, Any] | None = None


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
    connector_name: str | None = None
    connector_params: dict[str, Any] | None = None
    connector_state_summary: ConnectorStateSummary | None = None


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
