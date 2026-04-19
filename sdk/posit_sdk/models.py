"""Wire-shape Pydantic models for the Posit SDK.

These mirror the server-side models in server/api/models.py.
When the server wire format changes, update here to match.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

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

    timestamp: str = Field(..., description="ISO 8601 or DDMMMYY timestamp")
    raw_value: float
    market_value: float | None = None

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
    """

    annualized: bool = True
    size_type: Literal["fixed", "relative"] = "fixed"
    aggregation_logic: Literal["average", "offset"] = "average"
    temporal_position: Literal["static", "shifting"] = "shifting"
    decay_end_size_mult: float = Field(1.0, ge=0)
    decay_rate_prop_per_min: float = Field(0.0, ge=0)
    decay_profile: Literal["linear"] = "linear"
    var_fair_ratio: float = 1.0

    @model_validator(mode="after")
    def _consistency(self) -> "BlockConfig":
        if self.size_type == "relative" and not self.annualized:
            raise ValueError("size_type='relative' requires annualized=True")
        if self.decay_end_size_mult != 0 and not self.annualized:
            raise ValueError(
                "decay_end_size_mult is only applicable for annualized streams "
                "(set annualized=True or decay_end_size_mult=0)"
            )
        return self


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
    """

    stream_name: str
    key_cols: list[str]
    status: Literal["PENDING", "READY"]
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfig | None = None


class SnapshotResponse(BaseModel):
    stream_name: str
    rows_accepted: int
    pipeline_rerun: bool


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


class WsAck(BaseModel):
    """ACK frame received after pushing a snapshot or market_value frame."""

    type: Literal["ack"]
    seq: int
    rows_accepted: int = 0
    pipeline_rerun: bool = False


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


class PositionPayload(_WireModel):
    """Pipeline broadcast payload received over WebSocket."""

    streams: list[DataStream]
    context: GlobalContext
    positions: list[DesiredPosition]
    updates: list[UpdateCard]
