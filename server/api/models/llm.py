"""
LLM-orchestration wire shapes — the five-stage Build pipeline +
investigation / general endpoints + admin latency telemetry.

Covers the full surface of ``spec-llm-orchestration.md``:
Stages 1–3.5 (router → intent → synthesis → critique), preview / commit
/ stored intent triplets, and the ``llm_failures`` client signal. Imports
``_shared`` + stdlib + pydantic only — never reaches into ``streams`` or
``auth``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from server.api.models._shared import CellContext, ChatMode


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


class BuildConverseRequest(BaseModel):
    """Request body for ``POST /api/build/converse`` — the five-stage pipeline entry point."""
    conversation: list[dict[str, str]] = Field(
        ...,
        description="OpenAI-style message array: [{role, content}, ...]",
    )


# ---------------------------------------------------------------------------
# LLM orchestration — five-stage Build pipeline (spec-llm-orchestration.md §6)
#
# Seeded in Milestone 1. Only the audit-side shapes are consumed this
# milestone; Stage 1–3 outputs land when the Build orchestrator replaces
# the monolithic Build mode in Milestone 2. Pydantic is the upstream
# truth — keep ``client/ui/src/types.ts`` in lockstep.
# ---------------------------------------------------------------------------


IntentCategory = Literal["stream", "view", "headline", "question", "none"]
# The router's category is a HINT to Stage 2, not a constraint. If the
# router guesses "view" but Stage 2 cannot fit a DiscretionaryViewIntent,
# it falls back to RawIntent and Stage 3 proceeds in Mode B (custom
# derivation). No separate "novel" category — RawIntent is the catchall.


ConfidenceLevel = Literal["very_low", "low", "medium", "high", "very_high"]


class IntakeClassification(BaseModel):
    """Stage 1 router output — single classification + reasoning."""
    category: IntentCategory
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(max_length=500)


class DiscretionaryViewIntent(BaseModel):
    """The trader's own opinion about a market variable."""
    kind: Literal["view"] = "view"
    original_phrasing: str
    target_variable: str
    magnitude: float
    magnitude_unit: str
    time_horizon: Literal["ongoing", "event_window"]
    event_or_ongoing: Literal["event", "ongoing"]
    event_type: str | None = None
    start_timestamp: datetime | None = None
    symbols: list[str] = Field(min_length=1)
    expiries: list[str] = Field(min_length=1)
    confidence_relative: ConfidenceLevel = "medium"


class DataStreamIntent(BaseModel):
    """A live feed the trader wants to connect."""
    kind: Literal["stream"] = "stream"
    original_phrasing: str
    semantic_type: str
    units_in: str
    temporal_character: Literal["ongoing", "event_window"]
    key_cols: list[str] = Field(min_length=1)
    update_cadence: str
    confidence_relative: ConfidenceLevel = "medium"


class HeadlineIntent(BaseModel):
    """A raw headline classified as framework-relevant.

    Full flow deferred (spec §2). Reserved type so the router can route
    headline-like inputs back to the trader with "what do you think this
    means for vol?" before extracting a DiscretionaryViewIntent.
    """
    kind: Literal["headline"] = "headline"
    original_phrasing: str
    event_type: str
    market_variable_affected: str
    direction: Literal["bullish_vol", "bearish_vol", "ambiguous"]
    magnitude_language: str
    probable_timeframe: str


StructuredIntent = Annotated[
    Union[DiscretionaryViewIntent, DataStreamIntent, HeadlineIntent],
    Field(discriminator="kind"),
]


class RawIntent(BaseModel):
    """Fallback when no StructuredIntent schema fits cleanly.

    Stage 2 returns this when the input is framework-relevant but does
    not match one of the three structured schemas. Stage 3 proceeds on
    it under Mode B (custom derivation), not Mode A (preset selection).
    """
    kind: Literal["raw"] = "raw"
    original_phrasing: str
    llm_interpretation: str
    relevant_framework_concepts: list[str]
    unresolved_fields: list[str]


class IntentOutput(BaseModel):
    """Stage 2 top-level output — exactly one of structured/raw/clarifying_question is set."""
    classification: IntakeClassification
    structured: StructuredIntent | None = None
    raw: RawIntent | None = None
    clarifying_question: str | None = None

    def model_post_init(self, __context: Any) -> None:
        set_count = sum(
            x is not None
            for x in (self.structured, self.raw, self.clarifying_question)
        )
        if set_count != 1:
            raise ValueError(
                "Exactly one of structured / raw / clarifying_question "
                f"must be set (got {set_count})"
            )


class BlockConfigDict(BaseModel):
    """Wire shape for ``BlockConfig`` — Pydantic mirror of the frozen dataclass.

    ``BlockConfig`` is a frozen dataclass with its invariants enforced in
    ``__post_init__``; wire validation happens here (Pydantic), then
    ``to_block_config()`` constructs the dataclass (which re-enforces the
    framework invariants — e.g. ``decay_end_size_mult != 0`` requires
    ``annualized == True``).
    """

    annualized: bool
    temporal_position: Literal["static", "shifting"]
    decay_end_size_mult: float = Field(ge=0.0)
    decay_rate_prop_per_min: float = Field(ge=0.0)
    var_fair_ratio: float = Field(gt=0.0)

    def to_block_config(self) -> "BlockConfigRuntime":
        from server.core.config import BlockConfig
        return BlockConfig(**self.model_dump())


# Alias exposed purely so the ``BlockConfigDict.to_block_config`` return
# annotation can name the runtime ``BlockConfig`` without importing Polars
# at module load. Kept opaque; callers use the concrete type.
BlockConfigRuntime = Any


class UnitConversionDict(BaseModel):
    """Wire shape for ``server.api.llm.parameter_presets.UnitConversion``."""
    scale: float
    offset: float
    exponent: float
    annualized: bool


class CustomDerivationCritique(BaseModel):
    """Stage 3.5 output — LLM critique of a Mode B derivation."""
    passes: bool
    concerns: list[str]
    suggested_alternative_preset_id: str | None = None


class PresetSelection(BaseModel):
    """Stage 3 Mode A output — preset id + overrides."""
    mode: Literal["preset"] = "preset"
    preset_id: str
    var_fair_ratio_override: float | None = None
    reasoning: str = Field(max_length=1000)


class CustomDerivation(BaseModel):
    """Stage 3 Mode B output — LLM-authored block + conversion + derivation."""
    mode: Literal["custom"] = "custom"
    block: BlockConfigDict
    unit_conversion: UnitConversionDict
    reasoning: str = Field(min_length=40, max_length=2000)
    critique: CustomDerivationCritique | None = None


SynthesisChoice = Annotated[
    Union[PresetSelection, CustomDerivation],
    Field(discriminator="mode"),
]


class ProposalSnapshotRow(BaseModel):
    """Snapshot row shape for Stage 3 proposal payloads.

    Distinct from the ingest-side ``SnapshotRow`` in ``_shared``:
    proposals carry a tightly-typed, minimal shape (``timestamp``,
    ``symbol``, ``expiry``, ``raw_value`` plus optional ``start_timestamp``
    for events) rather than the extra-keys-permitted ingest shape.
    """
    timestamp: datetime
    symbol: str
    expiry: str
    raw_value: float
    start_timestamp: datetime | None = None


class ProposedBlockPayload(BaseModel):
    """Fully parameterised block proposal, pre-preview.

    Two shapes, discriminated on ``action``:
    - ``create_stream`` — configures a live-feed stream (no snapshot_rows)
    - ``create_manual_block`` — registers a discretionary-view snapshot
    """
    action: Literal["create_stream", "create_manual_block"]
    stream_name: str
    key_cols: list[str]
    scale: float
    offset: float
    exponent: float
    block: BlockConfigDict
    snapshot_rows: list[ProposalSnapshotRow] = Field(default_factory=list)

    def as_engine_command(self) -> dict[str, Any]:
        """Serialise to the legacy engine-command wire shape.

        Lets the Stage 5 client-side executor stay unchanged while we
        migrate the Build flow off fenced engine-command blocks.
        """
        payload: dict[str, Any] = {
            "stream_name": self.stream_name,
            "key_cols": self.key_cols,
            "scale": self.scale,
            "offset": self.offset,
            "exponent": self.exponent,
            "block": self.block.model_dump(),
        }
        if self.action == "create_manual_block":
            payload["snapshot_rows"] = [r.model_dump() for r in self.snapshot_rows]
        return {"action": self.action, "params": payload}


class SynthesisOutput(BaseModel):
    """Stage 3 top-level — exactly one of preset/custom is set."""
    choice: SynthesisChoice
    proposed_payload: ProposedBlockPayload


class PositionDiff(BaseModel):
    """One (symbol, expiry) row of a preview diff."""
    symbol: str
    expiry: str
    before: float
    after: float
    absolute_diff: float
    # ``None`` when ``before == 0`` — percent change is undefined.
    percent_change: float | None = None


class PreviewResponse(BaseModel):
    """Stage 4 output — position impact of applying the proposed block."""
    diffs: list[PositionDiff]
    total_bankroll_usage_before: float
    total_bankroll_usage_after: float
    notes: list[str] = Field(default_factory=list)


class StoredBlockIntent(BaseModel):
    """Persisted intent / params / preview triplet — one row of ``block_intents``.

    Written on every successful Stage 5 commit. Binds a created stream
    back to the natural-language intent that spawned it so the Inspector
    can answer "why does this block exist?" in the trader's own words.
    """
    id: str
    user_id: str
    stream_name: str
    action: Literal["create_stream", "create_manual_block"]
    original_phrasing: str
    intent: IntentOutput
    synthesis: SynthesisOutput
    preview: PreviewResponse
    created_at: datetime


class BlockPreviewRequest(BaseModel):
    """POST /api/blocks/preview — runs the pipeline on a cloned stream
    list plus the proposed payload; returns the desired-position diff."""
    payload: ProposedBlockPayload


class BlockCommitRequest(BaseModel):
    """POST /api/blocks/commit — finalises the proposal.

    Carries the full Stage 1–4 trace so the persisted ``block_intents``
    row reflects exactly what the trader confirmed.
    """
    payload: ProposedBlockPayload
    intent: IntentOutput
    synthesis: SynthesisOutput
    preview: PreviewResponse


class BlockCommitResponse(BaseModel):
    """Reply to a successful ``/api/blocks/commit``.

    ``new_desired_positions`` is the fresh desired-position map by
    (symbol, expiry) so the client can sanity-check the commit landed
    without waiting for the next WS broadcast.
    """
    stored_intent_id: str
    stream_name: str
    new_desired_positions: dict[str, dict[str, float]]


LlmFailureSignalType = Literal[
    "factual_correction",
    "discontent",
    "preview_rejection",
    "silent_rejection",
    "post_commit_edit",
]


class LlmFailureLogRequest(BaseModel):
    """Body for ``POST /api/llm/failures`` — client-emitted failure signal.

    In M4 only ``preview_rejection`` is emitted by the client (when the
    trader cancels the ProposalPreviewDrawer). Other signal types are
    reserved for future client-side emitters; the field enum stays
    aligned with ``llm_failures.signal_type`` values.
    """
    signal_type: LlmFailureSignalType
    conversation_turn_id: str | None = None
    llm_call_id: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class StreamIntentResponse(BaseModel):
    """``GET /api/streams/{name}/intent`` — "why does this block exist?".

    Returns the persisted ``StoredBlockIntent`` when the stream was
    created via the Build orchestrator. Streams that predate M3 (or
    that were created via the manual ``+ Manual block`` path) return
    404 — the Inspector surfaces a "no intent recorded" placeholder.
    """
    intent: StoredBlockIntent


# ---------------------------------------------------------------------------
# Admin latency telemetry (spec-llm-orchestration-housekeeping.md §3)
# ---------------------------------------------------------------------------

class LlmLatencySummaryStage(BaseModel):
    """Aggregated per-stage latency over the sampled Build turns."""
    stage: str
    count: int
    mean_ms: float
    p50_ms: float
    p95_ms: float


class LlmLatencySummaryResponse(BaseModel):
    """Response for ``GET /api/admin/llm-latency-summary``.

    Reads ``llm_calls`` rows for the last ``turns_analysed`` Build
    turns (router / intent / synthesis / critique stages) and returns
    per-stage mean / p50 / p95 plus the p95 of per-turn totals.

    Informs the spec §16.3 merge-decision: if ``p95_total_ms`` stays
    above ``end_to_end_latency_budget_secs * 1000`` across a rolling
    100-turn window, a follow-up spec merges Stages 1+2 into one
    structured-output call.
    """
    turns_analysed: int
    stages: list[LlmLatencySummaryStage]
    p95_total_ms: float
