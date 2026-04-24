"""
Block table + opinion aggregation + manual-block ingest shapes.

An "opinion" is the trader-facing unified view: a data-driven belief (a live
stream) or a discretionary view (a manual block). Both manifest as one entry
in the stream registry, so Opinion is an aggregation layer over
(StreamRegistration + BlockIntent + derived block count) — not a new store.

description is mutable (persists in StreamRegistration.description) and is
what the trader edits inline; original_phrasing is the immutable audit
phrasing captured by the Build orchestrator in BlockIntent, kept read-only
so the feedback loop in tasks/lessons.md ("Ground domain knowledge in
prompts") still has a frozen reference point.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from server.api.models._shared import SnapshotRow
from server.api.models.streams.crud import BlockConfigPayload


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


# ---------------------------------------------------------------------------
# Opinions — the unified trader-facing view over streams + manual blocks.
# ---------------------------------------------------------------------------

OpinionKind = Literal["stream", "manual"]


class Opinion(BaseModel):
    """One row in the Opinions panel — aggregated view, not a stored entity."""
    name: str
    kind: OpinionKind
    description: str | None = None
    original_phrasing: str | None = None
    last_update: str | None = None
    active: bool
    block_count: int
    has_concerns: bool = False


class OpinionsListResponse(BaseModel):
    opinions: list[Opinion]


class OpinionDescriptionPatch(BaseModel):
    """PATCH /api/opinions/{name}/description body — pass null to clear."""
    description: str | None = None


class OpinionActivePatch(BaseModel):
    """PATCH /api/opinions/{name}/active body — toggles pipeline contribution."""
    active: bool


# ---------------------------------------------------------------------------
# Manual block ingest
# ---------------------------------------------------------------------------

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
