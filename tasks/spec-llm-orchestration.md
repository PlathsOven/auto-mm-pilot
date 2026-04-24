# Spec — LLM Orchestration Architecture for Natural-Language → Framework-Object Translation

**Status:** Approved for implementation. All open questions resolved 2026-04-23 (see §16).

**Author-agent session:** 2026-04-23 kickoff.

**Audience:** A new coding session that has read `CLAUDE.md`, `docs/architecture.md`, `docs/product.md`, and this spec. Everything below is self-contained enough that the implementer need not reconstruct context from the originating conversation.

---

## 1. Goals

Turn unstructured trader input — opinions, new data sources, headlines, novel situations — into a fully parameterised `StreamConfig` / `BlockConfig` that reflects the trader's intent with enough fidelity that the resulting desired position is the one they would have computed by hand, plus:

1. **Tell the trader explicitly whether their input warrants a framework object at all**, and if not, why.
2. **Deeply ground parameter derivation in the framework math**, with an escape hatch for situations no preset covers.
3. **Preserve the trader's original phrasing and reasoning as first-class data** persisted alongside every block — the shared-language primitive that lets a desk collaborate.
4. **Make the preset surface trivially extensible** — one declarative file, append-only.
5. **Log every LLM call, every trader disagreement, and every learnable preference** so the system improves over time rather than repeating the same mistakes.

## 2. Non-goals

- **Automating execution.** Posit still does not trade. The output is a desired position; the trader executes.
- **RAG over prior blocks (initial delivery).** Embedding-based retrieval of similar past intents is deferred — spec reserves a `similar_intents` field on the Stage 2 prompt but fills it with an empty list in v1.
- **Headline-as-first-class input (initial delivery).** The Stage 1 router reserves the `headline` category; the full headline-specific flow is deferred to a follow-on spec.
- **Re-authoring existing blocks.** This spec covers the create path only. Editing an existing block retains the current BlockDrawer-driven flow.
- **Alembic migrations.** The codebase's convention is `Base.metadata.create_all()` on boot; this spec follows that.

## 3. What exists today (2026-04-23)

### 3.1 LLM layer

- `server/api/llm/service.py`: single entry point `investigate_stream`, dispatches to one of three modes — `investigate`, `build`, `general` — via `build_system_prompt(mode, …)`.
- `server/api/llm/prompts/build.py`: monolithic Build mode prompt — classification + clarification + unit-conversion + parameter derivation + emission all in one LLM turn, ending with a fenced `engine-command` JSON block.
- `server/api/llm/prompts/core.py`: shared `UNIT_CONVERSION_REFERENCE`, `BLOCK_DECISION_FLOW`, `BASE_VS_EVENT_RULES` as prose in the system prompt.
- `server/api/llm/correction_detector.py`: async post-response detector that flags factual corrections and appends them to `domain_kb.json` (global, file-based, not per-user).
- `server/api/routers/llm.py`: `POST /api/investigate` SSE endpoint.
- `client/ui/src/services/engineCommands.ts`: client-side parser for the fenced `engine-command` JSON, executes `create_stream` immediately and routes `create_manual_block` to the BlockDrawer for trader review.

### 3.2 Persistence (from the explore survey)

- **SQLAlchemy + SQLite** (`server/api/db.py`) — engine at `posit.db`, sync ORM wrapped in `asyncio.to_thread` at router layer.
- **Existing tables:** `users`, `sessions`, `api_keys`, `usage_events` (`server/api/auth/models.py`).
- **No Alembic.** `Base.metadata.create_all()` runs on boot; idempotent.
- **Per-user in-memory stores:** `stream_registry`, `market_value_store`, `snapshot_buffer`, `position_history`, `bankroll` — all via the `UserRegistry[T]` pattern in `server/api/user_scope.py`. Lost on restart.
- **Global file store:** `domain_kb.json` (factual corrections).

### 3.3 Observations (the three databases this spec adds are net-new)

- No LLM call logging exists today beyond a `log.warning(...)` on OpenRouter fallback.
- No user-specific context / preferences store.
- No discontent / rejection capture — the correction detector handles factual corrections only.
- Block creation does not persist any reasoning or intent alongside the block; once a `StreamConfig` is in `stream_registry`, we cannot answer *"why does this block exist?"* without reading the chat log.

## 4. Architecture

Five stages. Stages 1–3 are LLM-mediated; Stage 4 is deterministic code; Stage 5 is code with async detector fanout.

```
┌─────────────────────────────────────────────────────────────┐
│  Trader message                                             │
└─────────────────┬───────────────────────────────────────────┘
                  ▼
      Stage 1 — Intake Router (LLM)
      classify intent ∈ {stream, view, headline, question, none}
      (category is a hint to Stage 2, not a constraint)
                  │
                  ▼
      Stage 2 — Intent Extractor (LLM, dual output)
      → StructuredIntent (fits a schema)   or
      → RawIntent       (does not fit; carries interpretation + open Qs)
                  │
                  ▼
      Stage 3 — Parameter Synthesiser (LLM + registry)
      Mode A: select_preset(preset_id, …) → deterministic params
      Mode B: derive_custom_block(BlockConfig, UnitConversion, reasoning)
                                         → critique pass (LLM)
                  │
                  ▼
      Stage 4 — Impact Preview (code)
      rerun pipeline with proposed block → desired-position diff
                  │
                  ▼
      Stage 5 — Confirm & Persist (code + async detector)
      create block → persist (intent + params + preview) → run detector
                  │
                  ▼
          Feedback loop writes to:
          • llm_calls     (every LLM call, every stage)
          • llm_failures  (discontent / disagreement / rejection)
          • user_context  (preferences, vocabulary, calibration)
          • domain_kb     (factual corrections — existing)
```

### 4.1 Design principles (locked)

1. **LLM does judgment; code does math.** The LLM picks "is this event vol or base vol?"; code turns that answer into `annualized=False, temporal_position="static", decay_end_size_mult=0.0`.
2. **Structured intent is the stable contract; parameters are derived.** If our unit-conversion improves, historical intents re-derive into corrected parameters.
3. **Every stage emits a typed Pydantic object.** No raw dicts between stages.
4. **Every LLM call is logged.** Full input, full output, latency, model.
5. **Every failure is captured.** The detector fans out to three destinations, not one.
6. **The trader sees position impact, not just parameters.** Preview is mandatory before commit.
7. **Original phrasing is sacred.** Every persisted block carries the trader's exact words.

### 4.2 Where the judgment-vs-math line lands

| Concern | Owner | Where it lives |
|---|---|---|
| Framework invariants (e.g. `decay_end_size_mult == 0` requires `annualized == False`) | Code | `BlockConfig.__post_init__` (existing) |
| Preset registry (data) | Shared | `server/api/llm/parameter_presets.py` (new, declarative) |
| Selecting a preset from the registry | LLM | Stage 3 Mode A |
| Recognising no preset fits | LLM | Stage 3 Mode A → Mode B transition |
| First-principles derivation of `scale, offset, exponent` | LLM | Stage 3 Mode B — given the framework math in the prompt |
| Arithmetic within a conversion (`(scale × raw + offset) ^ exponent`) | Code | Pipeline transforms (existing) |
| Critique of custom derivation | LLM (second pass) | Stage 3 Mode B only — not run on preset-matched paths |
| Pipeline rerun for preview | Code | `server/core/pipeline.py::run_pipeline` (existing) |
| Persistence of intent alongside block | Code | `block_intents` table (new) |

## 5. The preset registry

### 5.1 File: `server/api/llm/parameter_presets.py`

**Declarative Python, single file.** No nested modules, no dynamic loading. The file reads top-to-bottom like a lookup table. To add a preset, append one `ParameterPreset` entry and open a PR.

```python
"""
Parameter presets for LLM-guided block synthesis.

Each preset encodes a canonical (situation → BlockConfig + UnitConversion)
mapping so the Stage 3 synthesiser can pick a preset instead of deriving
parameters from first principles.

Two consumers:
1. The LLM's Stage 3 prompt — the registry is serialised in full into the
   system prompt, so the model sees every preset's `when_to_use` and
   `framework_reasoning` at decision time.
2. Deterministic code — `select_preset(preset_id, ...)` looks up by id
   and emits the block with the preset's params.

To extend: append one ParameterPreset entry below. Keep the list ordered
from most-common to most-specific so the LLM reads broad cases first.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from server.core.config import BlockConfig


@dataclass(frozen=True)
class UnitConversion:
    """Raw-value → calc-space (variance σ²) conversion parameters.

    The pipeline applies: target = (scale × raw + offset) ^ exponent.
    `annualized` tells the pipeline whether to distribute the result
    proportionally over time-to-expiry.
    """

    scale: float
    offset: float
    exponent: float
    annualized: bool


@dataclass(frozen=True)
class ParameterPreset:
    """One canonical situation → (BlockConfig + UnitConversion) mapping.

    Fields:
    - id: stable identifier, snake_case, referenced by stored intents.
    - description: short human label (≤ 1 line).
    - when_to_use: one paragraph shown verbatim to the LLM. Describe
        the trader's situation in the trader's terms.
    - framework_reasoning: why these parameters encode this situation.
        Grounds the LLM's choice in the framework math.
    - block: BlockConfig for every block produced by this preset.
    - unit_conversion: how raw_value maps to variance.
    """

    id: str
    description: str
    when_to_use: str
    framework_reasoning: str
    block: BlockConfig
    unit_conversion: UnitConversion


# ──────────────────────────────────────────────────────────────────
# PRESETS
#
# Add new entries below. Auto-serialised into the Stage 3 prompt.
# Order: broadest / most-common → narrowest / most-specific.
# ──────────────────────────────────────────────────────────────────

PRESETS: list[ParameterPreset] = [
    ParameterPreset(
        id="base_vol_shifting_pct",
        description="Ongoing vol level in % — 'vols will get bid to 50'",
        when_to_use=(
            "Trader expresses a view on the rolling/ongoing level of "
            "annualised volatility for an asset, stated as a percentage "
            "(e.g. '50 vol', 'IV will settle at 45'). Applies when there "
            "is no specific event; the view is about the base regime."
        ),
        framework_reasoning=(
            "Base vol shifts forward with current time (temporal_position="
            "'shifting'), is annualised (spread proportionally over "
            "time-to-expiry), and does not decay (end_size_mult=1.0, "
            "rate=0.0). Unit conversion: %-vol → decimal vol → variance, "
            "so scale=0.01, exponent=2."
        ),
        block=BlockConfig(
            annualized=True,
            temporal_position="shifting",
            decay_end_size_mult=1.0,
            decay_rate_prop_per_min=0.0,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=0.01, offset=0.0, exponent=2.0, annualized=True,
        ),
    ),

    ParameterPreset(
        id="base_vol_shifting_decimal",
        description="Ongoing vol level as decimal — stream: 0.50",
        when_to_use=(
            "Data stream emits annualised vol as a decimal (e.g. 0.50 "
            "for 50% vol). Same semantics as base_vol_shifting_pct but "
            "the raw value is already in decimal form."
        ),
        framework_reasoning=(
            "Same as base_vol_shifting_pct but scale=1.0 because raw is "
            "already a decimal. exponent=2 converts decimal vol to variance."
        ),
        block=BlockConfig(
            annualized=True,
            temporal_position="shifting",
            decay_end_size_mult=1.0,
            decay_rate_prop_per_min=0.0,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=1.0, offset=0.0, exponent=2.0, annualized=True,
        ),
    ),

    ParameterPreset(
        id="event_vol_fast_decay_pct_move",
        description="Fast macro event (FOMC, CPI, ECB) — expected % move",
        when_to_use=(
            "Trader describes a scheduled macroeconomic release with a "
            "specific release time, and expresses expected impact as an "
            "absolute percent move (e.g. 'I think FOMC will be a 2% "
            "upset'). Market typically prices in within ~30 minutes."
        ),
        framework_reasoning=(
            "Event vol is anchored to its release timestamp (temporal_"
            "position='static'), discrete rather than annualised "
            "(annualized=False), and decays to zero as the market "
            "digests (end_size_mult=0.0). Decay rate 0.03/min ≈ 30-min "
            "half-life. Unit conversion: user gives E[|ret|] in %, so "
            "scale = √(π/2)/100 (half-normal identity) and exponent=2."
        ),
        block=BlockConfig(
            annualized=False,
            temporal_position="static",
            decay_end_size_mult=0.0,
            decay_rate_prop_per_min=0.03,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=math.sqrt(math.pi / 2) / 100.0,
            offset=0.0,
            exponent=2.0,
            annualized=False,
        ),
    ),

    ParameterPreset(
        id="event_vol_protocol_upgrade_pct_move",
        description="Slow protocol event (hard fork, upgrade) — expected % move",
        when_to_use=(
            "Trader describes a crypto-specific protocol event (hard "
            "fork, chain upgrade, token migration) resolving over hours "
            "rather than minutes. Magnitude expressed as absolute % move."
        ),
        framework_reasoning=(
            "Same temporal shape as fast macro event (static, "
            "non-annualised, decays to zero) but decay rate is 0.005/min "
            "≈ 3-hour half-life because the market digests the outcome "
            "slowly. Unit conversion: E[|ret|]% → σ → variance."
        ),
        block=BlockConfig(
            annualized=False,
            temporal_position="static",
            decay_end_size_mult=0.0,
            decay_rate_prop_per_min=0.005,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=math.sqrt(math.pi / 2) / 100.0,
            offset=0.0,
            exponent=2.0,
            annualized=False,
        ),
    ),

    ParameterPreset(
        id="event_vol_flash_pct_move",
        description="Flash event (liquidation cascade, unscheduled news) — expected % move",
        when_to_use=(
            "Trader describes an unscheduled event or a flash risk with "
            "very fast resolution (liquidation cascades, breaking news "
            "hitting headlines). Market resolves within ~15 minutes."
        ),
        framework_reasoning=(
            "Same static/non-annualised/decay-to-zero shape, rate "
            "0.05/min ≈ 15-min half-life. Use for fast-resolving tail-risk "
            "style inputs."
        ),
        block=BlockConfig(
            annualized=False,
            temporal_position="static",
            decay_end_size_mult=0.0,
            decay_rate_prop_per_min=0.05,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=math.sqrt(math.pi / 2) / 100.0,
            offset=0.0,
            exponent=2.0,
            annualized=False,
        ),
    ),

    ParameterPreset(
        id="realised_variance_passthrough",
        description="Realised variance as decimal — passthrough stream",
        when_to_use=(
            "Data stream emits realised variance directly (σ² as decimal, "
            "e.g. 0.2025 for 45% vol). No transform needed — the raw "
            "value is already in variance units."
        ),
        framework_reasoning=(
            "Passthrough: exponent=1, scale=1. Variance shifts forward "
            "with current time (shifting), annualised across time-to-"
            "expiry, no decay."
        ),
        block=BlockConfig(
            annualized=True,
            temporal_position="shifting",
            decay_end_size_mult=1.0,
            decay_rate_prop_per_min=0.0,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=1.0, offset=0.0, exponent=1.0, annualized=True,
        ),
    ),

    # Append new presets below as the desk learns new canonical shapes.
]


def find_preset(preset_id: str) -> ParameterPreset | None:
    """Look up a preset by id. Returns None if not found."""
    return next((p for p in PRESETS if p.id == preset_id), None)


def serialize_presets_for_prompt() -> str:
    """Serialise every preset into a markdown block for Stage 3 prompt injection."""
    lines: list[str] = ["## PARAMETER PRESETS", ""]
    for p in PRESETS:
        lines.extend([
            f"### `{p.id}` — {p.description}",
            f"**When to use:** {p.when_to_use}",
            f"**Why these parameters:** {p.framework_reasoning}",
            f"**BlockConfig:** annualized={p.block.annualized}, "
            f"temporal_position={p.block.temporal_position!r}, "
            f"decay_end_size_mult={p.block.decay_end_size_mult}, "
            f"decay_rate_prop_per_min={p.block.decay_rate_prop_per_min}, "
            f"var_fair_ratio={p.block.var_fair_ratio}",
            f"**UnitConversion:** scale={p.unit_conversion.scale:.6f}, "
            f"offset={p.unit_conversion.offset}, "
            f"exponent={p.unit_conversion.exponent}, "
            f"annualized={p.unit_conversion.annualized}",
            "",
        ])
    return "\n".join(lines)
```

### 5.2 How the registry is used

- **Stage 3 prompt build:** `build_synthesise_prompt()` calls `serialize_presets_for_prompt()` and injects the result. No manual syncing between prompt and code.
- **Mode A emission:** the LLM calls a tool `select_preset(preset_id, symbols, expiries, raw_value, var_fair_ratio_override?)`. Server looks up the preset via `find_preset`, clones its `BlockConfig` with any overrides, and returns the fully-formed `create_stream` or `create_manual_block` payload.
- **Mode B emission:** the LLM calls `derive_custom_block(block_config_dict, unit_conversion_dict, reasoning)`. Server validates against `BlockConfig(**block_config_dict)` constructor (which enforces framework invariants) and stores `reasoning` verbatim.

### 5.3 Preset extension workflow

Adding a preset is one file edit:

```python
# Append to PRESETS list:
ParameterPreset(
    id="vol_of_vol_shifting_pct",
    description="Vol-of-vol proxy — skew-scaled vol adjustment",
    when_to_use="Trader has a view on vol-of-vol via observed skew …",
    framework_reasoning="…",
    block=BlockConfig(…),
    unit_conversion=UnitConversion(…),
),
```

No prompt edits. No helper function edits. The Stage 3 prompt regenerates on every request via `serialize_presets_for_prompt()`.

## 6. Pydantic schemas

All new schemas live in `server/api/models.py` (the canonical Pydantic file, per `docs/conventions.md`). TypeScript mirror in `client/ui/src/types.ts` updated in the same PR.

### 6.1 Intent classification (Stage 1 output)

```python
# server/api/models.py

from typing import Literal
from pydantic import BaseModel, Field

IntentCategory = Literal["stream", "view", "headline", "question", "none"]
# The router's category is a HINT to Stage 2, not a constraint. If the
# router guesses "view" but Stage 2 cannot fit a DiscretionaryViewIntent,
# it falls back to RawIntent and Stage 3 proceeds in Mode B (custom
# derivation). No separate "novel" category — the RawIntent fallback
# is the catchall for framework-relevant inputs that don't fit a schema.


class IntakeClassification(BaseModel):
    """Stage 1 router output — single classification + reasoning."""
    category: IntentCategory
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = Field(max_length=500)
```

### 6.2 Structured intents (Stage 2 output — schema-fit path)

```python
# server/api/models.py

from datetime import datetime
from typing import Literal, Annotated, Union
from pydantic import BaseModel, Field


class DiscretionaryViewIntent(BaseModel):
    """The trader's own opinion about a market variable."""
    kind: Literal["view"] = "view"
    original_phrasing: str
    target_variable: str          # e.g. "annualised vol", "event-day move"
    magnitude: float
    magnitude_unit: str           # e.g. "percent", "decimal", "vol_points"
    time_horizon: Literal["ongoing", "event_window"]
    event_or_ongoing: Literal["event", "ongoing"]
    event_type: str | None = None     # "FOMC", "protocol_upgrade", …; None if ongoing
    start_timestamp: datetime | None = None  # required iff event_or_ongoing == "event"
    symbols: list[str] = Field(min_length=1)
    expiries: list[str] = Field(min_length=1)
    confidence_relative: Literal["very_low", "low", "medium", "high", "very_high"] = "medium"


class DataStreamIntent(BaseModel):
    """A live feed the trader wants to connect."""
    kind: Literal["stream"] = "stream"
    original_phrasing: str
    semantic_type: str            # free-text: "realised vol", "funding rate", …
    units_in: str                 # free-text: "annualised vol as decimal", …
    temporal_character: Literal["ongoing", "event_window"]
    key_cols: list[str] = Field(min_length=1)
    update_cadence: str           # free-text: "per minute", "tick-by-tick", "hourly"
    confidence_relative: Literal["very_low", "low", "medium", "high", "very_high"] = "medium"


class HeadlineIntent(BaseModel):
    """A raw headline the LLM has classified as framework-relevant.

    Full flow deferred; v1 keeps the type reserved but routes the Build
    conversation back to "please describe what you think this means for
    vol" before extracting a DiscretionaryViewIntent.
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
```

### 6.3 Raw intent (Stage 2 output — fallback path)

```python
# server/api/models.py

class RawIntent(BaseModel):
    """Fallback when no StructuredIntent schema fits cleanly.

    The LLM tried to classify the input, could not, and returns its best
    natural-language interpretation plus any framework concepts it
    thinks are relevant. Stage 3 proceeds on this under Mode B (custom
    derivation), not Mode A (preset selection).
    """
    kind: Literal["raw"] = "raw"
    original_phrasing: str
    llm_interpretation: str        # one paragraph, the LLM's read of what the trader means
    relevant_framework_concepts: list[str]  # e.g. ["event vol", "cross-asset effect"]
    unresolved_fields: list[str]   # e.g. ["magnitude", "time_horizon"]


class IntentOutput(BaseModel):
    """Stage 2 top-level output — exactly one of structured/raw is set.

    If the LLM needs more information from the trader before proceeding,
    it returns with clarifying_question set and neither structured nor
    raw populated. The UI then loops the question back to the trader.
    """
    classification: IntakeClassification
    structured: StructuredIntent | None = None
    raw: RawIntent | None = None
    clarifying_question: str | None = None

    def model_post_init(self, __context) -> None:
        set_count = sum(x is not None for x in [self.structured, self.raw, self.clarifying_question])
        if set_count != 1:
            raise ValueError(
                "Exactly one of structured / raw / clarifying_question must be set "
                f"(got {set_count})"
            )
```

### 6.4 Synthesis output (Stage 3 output)

```python
# server/api/models.py

class PresetSelection(BaseModel):
    """Stage 3 Mode A output — preset id + overrides."""
    mode: Literal["preset"] = "preset"
    preset_id: str
    var_fair_ratio_override: float | None = None
    reasoning: str = Field(max_length=1000)


class CustomDerivation(BaseModel):
    """Stage 3 Mode B output — LLM-authored block + conversion + derivation."""
    mode: Literal["custom"] = "custom"
    block: "BlockConfigDict"             # see 6.5
    unit_conversion: "UnitConversionDict"
    reasoning: str = Field(min_length=40, max_length=2000)  # mandatory, multi-sentence
    critique: "CustomDerivationCritique | None" = None    # populated by Stage 3.5


class SynthesisOutput(BaseModel):
    """Stage 3 top-level — exactly one of preset/custom is set."""
    choice: PresetSelection | CustomDerivation
    proposed_payload: "ProposedBlockPayload"   # see 6.6
```

### 6.5 Wire shapes for `BlockConfig` / `UnitConversion`

These mirror `server/core/config.BlockConfig` and `parameter_presets.UnitConversion`. Separate Pydantic models because `BlockConfig` is a frozen dataclass (not a Pydantic model) and validation lives in `__post_init__`; wire validation happens via Pydantic and then `.to_block_config()` constructs the dataclass.

```python
# server/api/models.py

class BlockConfigDict(BaseModel):
    annualized: bool
    temporal_position: Literal["static", "shifting"]
    decay_end_size_mult: float = Field(ge=0.0)
    decay_rate_prop_per_min: float = Field(ge=0.0)
    var_fair_ratio: float = Field(gt=0.0)

    def to_block_config(self) -> "BlockConfig":
        from server.core.config import BlockConfig
        # BlockConfig.__post_init__ enforces the framework invariants:
        #   decay_end_size_mult != 0  implies  annualized == True
        return BlockConfig(**self.model_dump())


class UnitConversionDict(BaseModel):
    scale: float
    offset: float
    exponent: float
    annualized: bool


class CustomDerivationCritique(BaseModel):
    """Stage 3.5 output — LLM critique of a Mode B derivation."""
    passes: bool
    concerns: list[str]         # empty if passes
    suggested_alternative_preset_id: str | None = None
```

### 6.6 Proposed block payload

This is what Stage 3 hands off to Stage 4 / Stage 5.

```python
# server/api/models.py

class ProposedBlockPayload(BaseModel):
    """Fully parameterised block proposal, pre-preview.

    Two shapes, discriminated on `action`:
    - create_stream: configures a live-feed stream (no snapshot_rows)
    - create_manual_block: registers a discretionary-view snapshot
    """
    action: Literal["create_stream", "create_manual_block"]
    stream_name: str
    key_cols: list[str]
    scale: float
    offset: float
    exponent: float
    block: BlockConfigDict
    snapshot_rows: list["SnapshotRow"] = Field(default_factory=list)

    def as_engine_command(self) -> dict:
        """Serialise to the existing engine-command wire shape so the
        Stage 5 client-side executor is unchanged."""
        payload = {
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


class SnapshotRow(BaseModel):
    timestamp: datetime
    symbol: str
    expiry: str
    raw_value: float
    start_timestamp: datetime | None = None  # required iff event
```

### 6.7 Preview response (Stage 4 output)

```python
# server/api/models.py

class PositionDelta(BaseModel):
    symbol: str
    expiry: str
    before: float     # current desired position
    after: float      # desired position after the proposed block is applied
    absolute_change: float
    percent_change: float | None = None   # None when before == 0


class PreviewResponse(BaseModel):
    deltas: list[PositionDelta]
    total_bankroll_usage_before: float
    total_bankroll_usage_after: float
    notes: list[str] = Field(default_factory=list)  # e.g. "5 expiries unaffected"
```

### 6.8 Persisted intent (Stage 5 persistence)

```python
# server/api/models.py

class StoredBlockIntent(BaseModel):
    """Written to `block_intents` table on successful block creation."""
    id: str                  # uuid
    user_id: str
    stream_name: str
    action: Literal["create_stream", "create_manual_block"]
    original_phrasing: str
    intent: IntentOutput
    synthesis: SynthesisOutput
    preview: PreviewResponse
    created_at: datetime
```

## 7. API endpoints

All new endpoints under `server/api/routers/build.py` (new file), registered in `server/api/main.py`.

### 7.1 `POST /api/build/converse`

**Unified conversational endpoint** covering Stages 1–3. Streams SSE tokens like the existing `/api/investigate`.

**Request:**
```python
class BuildConverseRequest(BaseModel):
    conversation: list[ChatMessageIn]   # same shape as InvestigateRequest
```

**Streamed events:**
- `data: {"delta": "...tokens..."}` — model output tokens as they arrive
- `data: {"stage": "router", "output": IntakeClassification}` — Stage 1 complete
- `data: {"stage": "intent", "output": IntentOutput}` — Stage 2 complete
- `data: {"stage": "synthesis", "output": SynthesisOutput}` — Stage 3 complete
- `data: {"stage": "proposal", "payload": ProposedBlockPayload}` — ready for preview
- `data: [DONE]`
- `event: error\ndata: {...}` — on failure

**Behaviour:**

1. Run Stage 1 (router): LLM call with a tight router prompt (see §8.1). Write to `llm_calls`. If `category == "question" | "none"`, yield conversational response and `[DONE]`.

2. Run Stage 2 (intent extractor): LLM call with a structured-output prompt (see §8.2). Write to `llm_calls`. If `clarifying_question` is set, yield it as a plain assistant message and `[DONE]`.

3. Run Stage 3 (synthesis):
   - Build the Stage 3 prompt via `build_synthesise_prompt(intent_output)` — includes `serialize_presets_for_prompt()` and the framework math sections.
   - LLM call with two available tools: `select_preset(…)` and `derive_custom_block(…)`.
   - If `select_preset` is called → Mode A; emit `PresetSelection`, build `ProposedBlockPayload` from the preset.
   - If `derive_custom_block` is called → Mode B; emit `CustomDerivation`, then run Stage 3.5 critique (separate LLM call), attach critique to the `CustomDerivation`, build `ProposedBlockPayload`.
   - Write each Stage 3 and Stage 3.5 LLM call to `llm_calls`.

4. Yield `{"stage": "proposal", "payload": …}` and `[DONE]`.

5. After the response completes, fire the async feedback detector (§9.5) over the full conversation.

### 7.2 `POST /api/blocks/preview`

**Stage 4 endpoint.**

**Request:**
```python
class BlockPreviewRequest(BaseModel):
    payload: ProposedBlockPayload
```

**Response:** `PreviewResponse`.

**Behaviour:**
1. Clone the current user's stream list from `stream_registry`.
2. Apply the proposed payload to the clone (create / configure stream, apply snapshot rows if manual block).
3. Call `run_pipeline(...)` on the clone — pure, does not mutate live state.
4. Diff the resulting `desired_pos_df` against the live `position_history` / `state` → list of `PositionDelta`.
5. Return.

**Performance:** `run_pipeline` is already sub-second on modern hardware; no caching needed in v1. If preview feels slow, the first optimisation is re-using the cached `risk_dimension_cols` + `time_grid`.

### 7.3 `POST /api/blocks/commit`

**Stage 5 endpoint.**

**Request:**
```python
class BlockCommitRequest(BaseModel):
    payload: ProposedBlockPayload
    intent: IntentOutput
    synthesis: SynthesisOutput
    preview: PreviewResponse
```

**Response:**
```python
class BlockCommitResponse(BaseModel):
    stored_intent_id: str     # FK into block_intents
    stream_name: str
    new_desired_positions: dict[str, dict[str, float]]   # {symbol: {expiry: $vega}}
```

**Behaviour:**
1. Execute the `payload.action` (`create_stream` or `create_manual_block`) via the existing `stream_registry` helpers.
2. Rerun pipeline + broadcast (existing `rerun_and_broadcast`).
3. Write a `StoredBlockIntent` row to the `block_intents` table — binds the created stream to its original phrasing, structured intent, synthesis trace, and preview.
4. Fire the async feedback detector over the just-completed commit exchange.

### 7.4 Existing `POST /api/investigate` — no change

Investigate mode stays exactly as it is. The new endpoints replace only Build mode's single-shot flow. General mode also unchanged.

### 7.5 Endpoint removal

After migration is complete (§13), remove the `build` branch from `build_system_prompt` and delete `server/api/llm/prompts/build.py`. Investigate and General modes keep their own prompt modules.

## 8. Stage-by-stage LLM prompts

Prompts live in `server/api/llm/prompts/` as new modules. Each prompt is a `build_*_prompt(...)` function that composes `SHARED_CORE` (existing) with stage-specific content.

### 8.1 Stage 1 — router prompt

New file: `server/api/llm/prompts/router.py`.

```python
ROUTER_EXT = """\
## ROUTER MODE

Classify the trader's latest message into exactly one category, returning \
structured JSON. Do NOT perform any parameter work, unit conversion, or \
clarification — those belong downstream.

### Categories

- **stream** — trader is describing a live data feed they want to connect.
- **view** — trader is expressing their own discretionary opinion about \
a market variable.
- **headline** — trader has pasted or paraphrased a raw news headline \
and wants to know what to do with it.
- **question** — the trader is asking a factual question, not proposing \
an input. Route to General or Investigate.
- **none** — the message is conversational filler, an acknowledgement, \
or unrelated to framework configuration.

Your category is a hint to the next stage, not a hard label — if the \
input is framework-relevant but unusual, pick the closest of the three \
build categories (stream / view / headline); the next stage will handle \
inputs that don't fit a known schema via a fallback path.

### Output

Return ONLY a JSON object:
{
  "category": "<stream|view|headline|question|none>",
  "confidence": <float 0.0–1.0>,
  "reason": "<one sentence — why this category>"
}

No markdown, no prose, no code fences.\
"""
```

**LLM call params:** `max_tokens=200`, `temperature=0.0`, `response_format={"type": "json_object"}` (if the model supports it; otherwise parse defensively).

### 8.2 Stage 2 — intent extractor prompt

New file: `server/api/llm/prompts/intent_extractor.py`.

Prompt structure:
- `SHARED_CORE` (language rules, hard constraints)
- Category-specific section (view / stream / headline) telling the LLM which StructuredIntent variant to attempt first, given the router's hint
- Instructions for falling back to `RawIntent` if the input does not fit
- Instructions for emitting a `clarifying_question` if a required field is missing
- Current engine state (available symbols, expiries, existing streams — from `extract_risk_dims`)

**Output format:** JSON conforming to `IntentOutput`. Use the OpenAI-compatible function-calling / tool-use API if available; fall back to strict JSON otherwise.

**LLM call params:** `max_tokens=1500`, `temperature=0.2`.

### 8.3 Stage 3 — parameter synthesiser prompt

New file: `server/api/llm/prompts/synthesiser.py`.

Prompt structure:
- `SHARED_CORE`
- `FRAMEWORK_DETAIL` (existing — fair/variance/smoothing math)
- `PARAMETER_MAPPING` (existing)
- `UNIT_CONVERSION_REFERENCE` (existing)
- `BASE_VS_EVENT_RULES` (existing)
- `serialize_presets_for_prompt()` output
- Two tools exposed:

```python
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "select_preset",
            "description": (
                "Emit a block using one of the canonical presets. Call this "
                "when the trader's situation clearly matches a preset's "
                "when_to_use description."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset_id": {"type": "string"},
                    "symbols": {"type": "array", "items": {"type": "string"}},
                    "expiries": {"type": "array", "items": {"type": "string"}},
                    "raw_value": {"type": "number"},
                    "start_timestamp": {"type": "string", "nullable": True},
                    "var_fair_ratio_override": {"type": "number", "nullable": True},
                    "reasoning": {"type": "string"},
                },
                "required": ["preset_id", "symbols", "expiries", "raw_value", "reasoning"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "derive_custom_block",
            "description": (
                "Emit a block by deriving parameters from first principles. "
                "Call this only when no preset's when_to_use description "
                "fits the trader's situation. Reasoning is mandatory and "
                "must ground each parameter choice in the framework math."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {"type": "array", "items": {"type": "string"}},
                    "expiries": {"type": "array", "items": {"type": "string"}},
                    "raw_value": {"type": "number"},
                    "start_timestamp": {"type": "string", "nullable": True},
                    "block": {
                        "type": "object",
                        "properties": {
                            "annualized": {"type": "boolean"},
                            "temporal_position": {"type": "string", "enum": ["static", "shifting"]},
                            "decay_end_size_mult": {"type": "number", "minimum": 0.0},
                            "decay_rate_prop_per_min": {"type": "number", "minimum": 0.0},
                            "var_fair_ratio": {"type": "number", "exclusiveMinimum": 0.0},
                        },
                        "required": ["annualized", "temporal_position",
                                     "decay_end_size_mult", "decay_rate_prop_per_min",
                                     "var_fair_ratio"],
                    },
                    "unit_conversion": {
                        "type": "object",
                        "properties": {
                            "scale": {"type": "number"},
                            "offset": {"type": "number"},
                            "exponent": {"type": "number"},
                            "annualized": {"type": "boolean"},
                        },
                        "required": ["scale", "offset", "exponent", "annualized"],
                    },
                    "reasoning": {
                        "type": "string",
                        "description": (
                            "Multi-sentence derivation. Cover: why no "
                            "preset fits, the framework reasoning behind "
                            "each BlockConfig field, and the unit-conversion "
                            "derivation from first principles."
                        ),
                    },
                },
                "required": ["symbols", "expiries", "raw_value",
                             "block", "unit_conversion", "reasoning"],
            },
        },
    },
]
```

**LLM call params:** `max_tokens=2000`, `temperature=0.1`, tools enabled, `tool_choice="required"` (force the model to call one of the two).

### 8.4 Stage 3.5 — custom-derivation critique prompt

New file: `server/api/llm/prompts/critique.py`.

Runs only when Stage 3 emits `CustomDerivation`.

Prompt structure:
- Framework identity rules (copied inline for isolation — no SHARED_CORE dependencies)
- The trader's `IntentOutput` (what they said)
- The `CustomDerivation` output (what the LLM produced)
- Instruction: critique whether the derived parameters actually encode the trader's intent. Check:
  - Unit-conversion output has variance units
  - Temporal classification matches event vs ongoing
  - Decay rate matches expected resolution timeframe
  - BlockConfig invariants hold
  - No obvious alternative preset should have been used

Output: `CustomDerivationCritique` JSON.

**LLM call params:** `max_tokens=800`, `temperature=0.0`.

## 9. Databases

Three new tables + one new index. Add to `server/api/auth/models.py` (sibling to existing auth tables, all registered under the same `Base`). Or — more cleanly — create `server/api/llm/models.py` with a separate module and import it in `db.init_db()`.

**Decision:** use `server/api/llm/models.py`. Keeps LLM concerns isolated from auth concerns.

### 9.1 `llm_calls` — every LLM call, every stage

```python
# server/api/llm/models.py

from datetime import datetime
from typing import Any
from sqlalchemy import (
    DateTime, ForeignKey, Index, Integer, JSON, String, Text, Float,
)
from sqlalchemy.orm import Mapped, mapped_column
from server.api.db import Base


class LlmCall(Base):
    """Append-only audit log. One row per outbound LLM request."""
    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # Groups calls that belong to a single user turn (Stages 1–3 for one
    # Build converse → same conversation_turn_id).
    conversation_turn_id: Mapped[str] = mapped_column(String(36), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    # Stage values: "router", "intent", "synthesis", "critique",
    # "investigation", "general", "correction_detector", "feedback_detector"
    mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    request_messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    request_tools: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    request_temperature: Mapped[float] = mapped_column(Float, nullable=False)
    request_max_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    response_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_tool_calls: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    response_finish_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_llm_calls_user_stage", LlmCall.user_id, LlmCall.stage)
Index("ix_llm_calls_turn", LlmCall.conversation_turn_id)
```

**Write path:** wrap `OpenRouterClient.complete_with_fallback` and `stream_with_fallback` with a new helper that records the call. Do not add logging inside the HTTP client (keeps it stateless); instead, have `LlmService` call the helper.

**Design:** `LlmCallRecorder` context manager in `server/api/llm/audit.py`:

```python
@asynccontextmanager
async def record_call(
    user_id: str,
    conversation_turn_id: str,
    stage: str,
    mode: str | None,
    request: dict,
) -> AsyncIterator[LlmCallHandle]:
    started = time.perf_counter()
    handle = LlmCallHandle()
    try:
        yield handle
    finally:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        await asyncio.to_thread(
            _persist,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
            stage=stage, mode=mode,
            request=request,
            response_content=handle.content,
            response_tool_calls=handle.tool_calls,
            finish_reason=handle.finish_reason,
            prompt_tokens=handle.prompt_tokens,
            completion_tokens=handle.completion_tokens,
            latency_ms=elapsed_ms,
            error=handle.error,
        )
```

### 9.2 `llm_failures` — discontent, disagreement, rejection

```python
# server/api/llm/models.py

class LlmFailure(Base):
    """One row per detected signal that the LLM got it wrong — whether
    via explicit correction, preview rejection, silent abandonment, or
    post-commit edit. Studied offline to drive prompt / preset changes."""
    __tablename__ = "llm_failures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    conversation_turn_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    llm_call_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("llm_calls.id", ondelete="SET NULL"), nullable=True,
    )
    # Signal type values:
    #  - "factual_correction"   (detected by correction_detector, mirrored here)
    #  - "discontent"           (frustrated tone, doesn't match → doesn't fit pattern)
    #  - "preview_rejection"    (trader cancelled the preview)
    #  - "silent_rejection"     (proposal surfaced, conversation abandoned)
    #  - "post_commit_edit"     (block edited / deleted shortly after creation)
    signal_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # Trigger values:
    #  - "chat_message"     (detector flagged a trader message)
    #  - "preview_ui"       (UI posted an explicit cancel event)
    #  - "commit_followup"  (pipeline detected a rapid edit / delete)
    #  - "idle_timeout"     (detector flagged abandoned proposal)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    llm_output_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    trader_response_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    detector_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_llm_failures_user_signal", LlmFailure.user_id, LlmFailure.signal_type)
```

**Read path (v1):** admin-only endpoint `GET /api/admin/llm-failures` returns the rows filtered by user / signal_type / date range. No UI in v1; developers query SQLite directly for analysis.

### 9.3 `user_context` — per-user preferences + patterns

```python
# server/api/llm/models.py

class UserContextEntry(Base):
    """Sparse per-user key-value store — the LLM's evolving profile of
    the trader. Injected into every mode's prompt to personalise.

    Keys are a controlled vocabulary (see §9.3.1 below). Values are
    freeform JSON so each key can store whatever shape fits.
    """
    __tablename__ = "user_context_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)  # why the detector wrote this
    first_observed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    observation_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


Index(
    "ix_user_context_user_key",
    UserContextEntry.user_id,
    UserContextEntry.key,
    unique=True,
)
```

#### 9.3.1 Controlled `key` vocabulary (v1)

Only these keys are written by the detector. The prompt builder reads them in a known order. Expand by updating this list + the detector prompt.

| Key | Value shape | Meaning |
|---|---|---|
| `magnitude_vocabulary` | `{"phrase": "unit", …}` | Trader uses "50 vol" to mean 50% annualised (not 0.50) |
| `confidence_language` | `{"phrase": "level", …}` | Trader says "pretty confident" ≈ `confidence_relative=high` |
| `typical_expiries_of_interest` | `["YYYY-MM-DD", …]` | Expiries the trader frequently references |
| `typical_symbols_of_interest` | `["BTC", "ETH", …]` | Symbols frequently referenced |
| `preferred_decay_rates` | `{"event_type": rate, …}` | Trader uses a different decay rate than the preset default for a given event type |
| `calibration_notes` | `["free-text observation", …]` | "Trader's 'expected' move is usually the lower bound" — multi-observation patterns |
| `framework_mastery_level` | `"novice" | "intermediate" | "expert"` | How much explanation to include in responses |

### 9.4 `block_intents` — the persisted intent / params / preview triplet

```python
# server/api/llm/models.py

class BlockIntent(Base):
    """Binds a created block back to the natural-language intent that
    spawned it. Persisted on every successful Stage 5 commit."""
    __tablename__ = "block_intents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    stream_name: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    original_phrasing: Mapped[str] = mapped_column(Text, nullable=False)
    intent_output: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    synthesis_output: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    preview_response: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    preset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    custom_derivation_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_block_intents_user_stream", BlockIntent.user_id, BlockIntent.stream_name)
```

**Read paths:**
- `GET /api/streams/{name}/intent` — returns the StoredBlockIntent for that stream. Powers an Inspector panel showing *"why does this block exist?"* in the trader's own words.
- Analytics: Which presets are used most? Which custom derivations have similar shapes (candidates for future presets)?

### 9.5 `init_db` update

```python
# server/api/db.py — init_db()

def init_db() -> None:
    from server.api.auth import models  # noqa: F401
    from server.api.llm import models as llm_models  # noqa: F401  (new)
    Base.metadata.create_all(bind=engine)
    log.info("DB initialised (url=%s)", DATABASE_URL)
```

### 9.6 `domain_kb` migration (scope decision)

`domain_kb.json` today is file-based and global. Decision for this spec: **leave it as-is for v1.** Migrating to SQLite is a worthwhile follow-up (`domain_kb_entries` table keyed on user_id) but is out of scope here — it would broaden the blast radius of this spec without adding to the core goal. Note the follow-up in `tasks/todo.md` when this spec ships.

## 10. The feedback loop

### 10.1 Writes during a single trader turn

```
Trader message
   │
   ▼
POST /api/build/converse
   │
   ├─ Stage 1 LLM call        → insert llm_calls (stage=router)
   ├─ Stage 2 LLM call        → insert llm_calls (stage=intent)
   ├─ Stage 3 LLM call        → insert llm_calls (stage=synthesis)
   └─ Stage 3.5 critique call → insert llm_calls (stage=critique)   [Mode B only]
   │
   ▼  (UI receives proposal)

POST /api/blocks/preview      → no DB writes (pure compute)
   │
   ▼  (trader confirms)

POST /api/blocks/commit
   │
   ├─ Execute block creation
   ├─ Rerun pipeline
   ├─ Insert block_intents    (the persisted triplet)
   └─ Schedule async feedback detector over the full conversation
         │
         ▼
   detect_feedback_signals():
      ├─ factual correction? → append domain_kb.json (existing path)
      ├─ discontent / disagreement? → insert llm_failures
      ├─ preference signal?  → upsert user_context_entries
      └─ nothing detected    → no write
```

### 10.2 Writes driven by the UI (not the detector)

- **Preview rejection:** client calls `POST /api/llm/failures` with `{signal_type: "preview_rejection", conversation_turn_id, llm_call_id, metadata: {reason_provided_by_trader?: string}}`. Explicit signal, no detector LLM call needed.
- **Silent rejection / idle timeout:** a background sweep runs every N seconds and flags proposals that surfaced but were neither confirmed nor rejected within a threshold (default 120s). Writes `llm_failures` with `signal_type="silent_rejection"`.
- **Post-commit edit:** when a user edits or deletes a block within M minutes of creation (default 10), the block endpoint writes `llm_failures` with `signal_type="post_commit_edit"` and links the original `block_intents.id` in metadata.

### 10.3 Reads during a single trader turn

- **Stage 2 prompt:** fetch `user_context_entries` filtered by user_id; serialise non-empty keys into a `## USER CONTEXT` section prepended to the engine-state block. This personalises every prompt based on accumulated preferences.
- **Stage 3 prompt:** same user_context plus the preset registry.
- **Investigate mode:** already reads `domain_kb.json`; additionally reads `user_context_entries` once the personalisation layer is live (Milestone 4).

### 10.4 The feedback detector

New module: `server/api/llm/feedback_detector.py`. Replaces the narrow `correction_detector.py`; existing correction-detection logic subsumed.

```python
async def detect_and_store(
    client: OpenRouterClient,
    detector_models: tuple[str, ...],
    user_id: str,
    conversation_turn_id: str,
    conversation: list[dict[str, str]],
    assistant_response: str,
    latest_llm_call_id: int | None,
) -> None:
    """Run the unified feedback detector. Fans out to three destinations."""
```

Detector prompt (single call) asks for a JSON object with multiple fields:

```json
{
  "factual_correction": { ... existing shape ... } | null,
  "discontent_signals": [
    {
      "severity": "mild" | "strong",
      "llm_output_snippet": "...",
      "trader_response_snippet": "...",
      "reasoning": "..."
    }
  ],
  "preference_signals": [
    {
      "key": "<one of the controlled vocabulary>",
      "value": <JSON>,
      "reasoning": "..."
    }
  ]
}
```

**Write fanout:**
- `factual_correction` present → append to `domain_kb.json` (unchanged behaviour).
- Each entry in `discontent_signals` → insert one `llm_failures` row with `signal_type="discontent"`, `trigger="chat_message"`.
- Each entry in `preference_signals` → upsert `user_context_entries` (increment `observation_count` on conflict, update `value` if the detector returned a refined value, always update `updated_at`).

Detector LLM call is written to `llm_calls` with `stage="feedback_detector"`.

### 10.5 Why three writes instead of one catch-all

Each destination has different read patterns:
- `domain_kb.json`: prompt-injection for every LLM call across all users (factual corrections should propagate globally — they are framework facts, not per-user preferences).
- `llm_failures`: offline analysis, never read by a live prompt. Pure training signal for the product team.
- `user_context_entries`: prompt-injection for this user only. Personalises without leaking between accounts.

One unified table would force every read to filter by intent, losing this natural separation.

## 11. Configuration surface — all tunable knobs in one file

Every magic number the spec references is hoisted into a single frozen dataclass, following the existing `server/api/config.py` convention (env-var-backed defaults + factory function). This makes every threshold, temperature, and token budget developer-tunable in one place — no hunting through nine files, no prompt-file edits to change a temperature.

New module: `server/api/llm/orchestration_config.py`.

```python
"""
Configuration for the LLM orchestration layer.

Every threshold, timeout, temperature, and token budget the five-stage
Build pipeline uses lives here. Tune by editing the defaults below or by
setting the corresponding env var — no prompt or code edits required.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class LlmOrchestrationConfig:
    """All tunable knobs for the LLM orchestration layer."""

    # ── Stage 1: Router ─────────────────────────────────────────────────
    router_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_ROUTER_MAX_TOKENS", "200"))
    )
    router_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_ROUTER_TEMPERATURE", "0.0"))
    )

    # ── Stage 2: Intent extractor ───────────────────────────────────────
    intent_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_INTENT_MAX_TOKENS", "1500"))
    )
    intent_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_INTENT_TEMPERATURE", "0.2"))
    )

    # ── Stage 3: Synthesiser ────────────────────────────────────────────
    synthesis_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_SYNTHESIS_MAX_TOKENS", "2000"))
    )
    synthesis_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_SYNTHESIS_TEMPERATURE", "0.1"))
    )

    # ── Stage 3.5: Critique ─────────────────────────────────────────────
    critique_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_CRITIQUE_MAX_TOKENS", "800"))
    )
    critique_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_CRITIQUE_TEMPERATURE", "0.0"))
    )

    # ── Feedback loop thresholds ────────────────────────────────────────

    # Silent-rejection sweep — proposals that surface but are neither
    # confirmed nor explicitly rejected within this many seconds are logged
    # to llm_failures with signal_type="silent_rejection".
    silent_rejection_threshold_secs: int = field(
        default_factory=lambda: int(os.getenv(
            "LLM_SILENT_REJECTION_THRESHOLD_SECS", "120",
        ))
    )

    # How often the silent-rejection sweep runs. Shorter = faster signal
    # capture + more DB churn. Longer = lag between abandonment and flag.
    silent_rejection_sweep_interval_secs: int = field(
        default_factory=lambda: int(os.getenv(
            "LLM_SILENT_REJECTION_SWEEP_INTERVAL_SECS", "30",
        ))
    )

    # Post-commit edit threshold — if a trader edits or deletes a block
    # within this many seconds of creating it, the edit is flagged as an
    # LLM first-pass failure. Beyond this window, edits are assumed to
    # reflect new information rather than a correction.
    post_commit_edit_threshold_secs: int = field(
        default_factory=lambda: int(os.getenv(
            "LLM_POST_COMMIT_EDIT_THRESHOLD_SECS", "600",
        ))
    )

    # Feedback detector — how many recent messages of context to include
    # when asking the detector model whether the latest exchange contains
    # a correction / discontent / preference signal.
    detector_context_window: int = field(
        default_factory=lambda: int(os.getenv("LLM_DETECTOR_CONTEXT_WINDOW", "6"))
    )

    # ── Target budgets (design targets, not enforced at runtime) ─────────
    # End-to-end latency budget from trader submit to proposal visible.
    # Breaching this triggers the Milestone 2 follow-up: merge Stages 1 + 2
    # into a single structured-output LLM call. Not enforced at runtime.
    end_to_end_latency_budget_secs: float = field(
        default_factory=lambda: float(os.getenv(
            "LLM_END_TO_END_LATENCY_BUDGET_SECS", "5.0",
        ))
    )


def get_llm_orchestration_config() -> LlmOrchestrationConfig:
    """Return a fresh config reading current env vars."""
    return LlmOrchestrationConfig()
```

### 11.1 Env var cheat-sheet

| Knob | Env var | Default |
|---|---|---|
| Router max tokens | `LLM_ROUTER_MAX_TOKENS` | 200 |
| Router temperature | `LLM_ROUTER_TEMPERATURE` | 0.0 |
| Intent max tokens | `LLM_INTENT_MAX_TOKENS` | 1500 |
| Intent temperature | `LLM_INTENT_TEMPERATURE` | 0.2 |
| Synthesis max tokens | `LLM_SYNTHESIS_MAX_TOKENS` | 2000 |
| Synthesis temperature | `LLM_SYNTHESIS_TEMPERATURE` | 0.1 |
| Critique max tokens | `LLM_CRITIQUE_MAX_TOKENS` | 800 |
| Critique temperature | `LLM_CRITIQUE_TEMPERATURE` | 0.0 |
| Silent-rejection threshold | `LLM_SILENT_REJECTION_THRESHOLD_SECS` | 120 |
| Silent-rejection sweep interval | `LLM_SILENT_REJECTION_SWEEP_INTERVAL_SECS` | 30 |
| Post-commit edit threshold | `LLM_POST_COMMIT_EDIT_THRESHOLD_SECS` | 600 |
| Detector context window | `LLM_DETECTOR_CONTEXT_WINDOW` | 6 |
| End-to-end latency budget | `LLM_END_TO_END_LATENCY_BUDGET_SECS` | 5.0 |

### 11.2 What stays hard-coded (and why)

- **Preset registry** (`parameter_presets.py`) — presets are code, not configuration. Adding a preset is a PR appending one `ParameterPreset` entry, not an env-var change. See §5.
- **Controlled vocabulary for `user_context_entries.key`** — the keys are a finite set (§9.3.1) extended only by updating the detector prompt and the controlled list together. Not env-configurable.
- **Routing categories** (`IntentCategory` literal) — part of the schema, not a tunable. See §6.1.
- **Framework invariants** (`BlockConfig.__post_init__` assertions) — these are math, not configuration.
- **OpenRouter model fallback lists** — already env-configurable via `OPENROUTER_INVESTIGATION_MODELS` / `OPENROUTER_DETECTOR_MODELS` in the existing `OpenRouterConfig`. No new surface.

### 11.3 Where the config is read

Every site that consumes one of these knobs calls `get_llm_orchestration_config()` once at request start (or module load, for background sweeps) and threads the config object through. Keeps the config readable in a single glance, no env-var lookups sprinkled through the code.

- `server/api/llm/build_orchestrator.py` — reads every Stage 1–3.5 knob
- `server/api/llm/feedback_detector.py` — reads `detector_context_window`
- `server/api/llm/silent_rejection_sweep.py` — reads silent-rejection threshold + interval
- `server/api/routers/blocks.py` edit handler — reads `post_commit_edit_threshold_secs`
- `server/api/routers/build.py` — may inspect `end_to_end_latency_budget_secs` for observability emit (not enforcement)

### 11.4 Adding a new knob

1. Add a new field to `LlmOrchestrationConfig` with a `field(default_factory=lambda: ...)` reading the env var.
2. Add the row to the cheat-sheet table in §11.1.
3. Read the new field at the consuming site via `get_llm_orchestration_config()`.

No other edits required — no prompt-file changes, no schema changes.

---

## 12. File-by-file change list

### 12.1 New files

| File | Purpose |
|---|---|
| `server/api/llm/parameter_presets.py` | Preset registry + serializer (§5.1) |
| `server/api/llm/orchestration_config.py` | All tunable knobs — `LlmOrchestrationConfig` frozen dataclass + env-var-backed defaults (§11) |
| `server/api/llm/models.py` | ORM tables (`LlmCall`, `LlmFailure`, `UserContextEntry`, `BlockIntent`) |
| `server/api/llm/audit.py` | `record_call` context manager (§9.1 write path) |
| `server/api/llm/feedback_detector.py` | Unified detector replacing `correction_detector.py` |
| `server/api/llm/user_context.py` | Helpers: `get_user_context(user_id)`, `serialize_user_context_section(user_id)`, `upsert_entry(user_id, key, value, reasoning)` |
| `server/api/llm/block_intents.py` | Helpers: `save_block_intent(StoredBlockIntent)`, `get_block_intent_for_stream(user_id, stream_name)` |
| `server/api/llm/prompts/router.py` | Stage 1 system prompt |
| `server/api/llm/prompts/intent_extractor.py` | Stage 2 system prompt + helpers |
| `server/api/llm/prompts/synthesiser.py` | Stage 3 system prompt + tool schemas |
| `server/api/llm/prompts/critique.py` | Stage 3.5 critique prompt |
| `server/api/llm/build_orchestrator.py` | Glues Stages 1–3 together, called by the router |
| `server/api/routers/build.py` | New FastAPI router — `/api/build/converse`, `/api/blocks/preview`, `/api/blocks/commit`, `/api/llm/failures` |
| `server/api/routers/admin.py` (if not exists) | `/api/admin/llm-failures`, `/api/admin/llm-calls` (admin-only) |
| `client/ui/src/services/buildApi.ts` | New — HTTP + SSE clients for the three build endpoints |
| `client/ui/src/providers/BuildProvider.tsx` | Parallel to `ChatProvider` — state for the Build flow (conversation, proposal, preview, confirm) |
| `client/ui/src/components/build/BuildPanel.tsx` | New — the Build mode UI (replaces routing to LlmChat in Build mode) |
| `client/ui/src/components/build/ProposalPreview.tsx` | New — renders `PositionDelta[]` as a diff table with Confirm / Cancel |

### 12.2 Modified files

| File | Change |
|---|---|
| `server/api/models.py` | Add all Pydantic models from §6 |
| `server/api/main.py` | Register new routers (`build`, `admin`) |
| `server/api/db.py` | Import `server.api.llm.models` in `init_db` |
| `server/api/llm/service.py` | Delete `build` branch from `investigate_stream` after migration; keep investigate + general |
| `server/api/llm/client.py` | Wire through `LlmCallRecorder` context. Optional: move all call-sites to use the recorder. |
| `server/api/llm/prompts/__init__.py` | Remove Build mode dispatch; keep investigate + general |
| `server/api/llm/correction_detector.py` | Delete file — subsumed by `feedback_detector.py` |
| `server/api/routers/llm.py` | `POST /api/investigate` — wire through `LlmCallRecorder`; switch from `correction_detector.detect_and_store` to `feedback_detector.detect_and_store` |
| `client/ui/src/types.ts` | Mirror every new Pydantic shape |
| `client/ui/src/components/LlmChat.tsx` | When `chatMode === "build"`, render `<BuildPanel/>` instead of the generic chat view |
| `client/ui/src/providers/ChatProvider.tsx` | Route Build mode messages to `BuildProvider`; leave Investigate + General untouched |
| `client/ui/src/services/engineCommands.ts` | Delete — the Build path no longer emits fenced `engine-command` JSON. (Verify no other consumers exist before deletion.) |
| `docs/architecture.md` | Add Build subsystem to Key Files table; document the five-stage pipeline under Key Design Decisions |
| `docs/decisions.md` | Append 2026-XX-XX entry: "LLM orchestration redesign — preset registry + structured intent + impact preview" |
| `docs/stack-status.md` | Mark new tables + orchestration layer as PROD |

### 12.3 Deleted files

- `server/api/llm/prompts/build.py` — replaced by the four new prompt modules
- `server/api/llm/correction_detector.py` — replaced by `feedback_detector.py`
- `client/ui/src/services/engineCommands.ts` — replaced by `buildApi.ts` (assuming no other consumers; grep before deletion)

## 13. Implementation milestones

**Ordering rule:** each milestone lands its own PR, typechecks + compileall clean, user can test in isolation before the next milestone lands. No feature-flagged dark rollouts.

### Milestone 1 — Preset registry + Pydantic intent schemas + LLM logging (foundation)

Scope:
- Create `parameter_presets.py` with the six seed presets from §5.1.
- Create `server/api/llm/orchestration_config.py` with every knob from §11 (even though Milestone 1 only uses the investigation-adjacent ones; seed the full surface now so later milestones just read fields).
- Add all Pydantic models from §6 to `server/api/models.py` + TS mirror.
- Create `server/api/llm/models.py` with the `LlmCall` table only (not yet failures / user_context / block_intents).
- Create `server/api/llm/audit.py` with the `record_call` context manager.
- Wire `LlmCallRecorder` into the existing `POST /api/investigate` path — every Investigate LLM call is now logged.
- `init_db` imports the new llm.models module.

Verification: run investigate; confirm rows appear in `llm_calls`. Typecheck + compileall clean.

Out of scope: no Build mode changes yet. Build still uses the monolithic prompt.

### Milestone 2 — Build orchestrator (Stages 1–3 + critique) replacing monolithic Build mode

Scope:
- Create the four new prompt modules (router, intent_extractor, synthesiser, critique).
- Create `build_orchestrator.py` wiring Stages 1–3 + 3.5.
- Create `routers/build.py` with `POST /api/build/converse` streaming SSE.
- Update `LlmChat.tsx` + `ChatProvider.tsx` to route Build mode through the new endpoint; keep the conversational UX identical (user does not see the stage decomposition — it is internal).
- Register new router in `main.py`.
- Delete `build.py` prompt and `engineCommands.ts` (assuming no other consumers).
- Every Build stage LLM call is logged to `llm_calls` via `record_call`.

Verification: register a data stream through Build mode end-to-end; register a discretionary view; observe an unusual input (e.g. a cross-asset correlation opinion) produces a `RawIntent` via Stage 2's fallback, and then Stage 3 emits a custom derivation with critique. Typecheck + compileall clean.

Out of scope: no preview yet. Build still commits directly at the end of the conversation, preserving existing behaviour.

### Milestone 3 — Impact preview + block_intents persistence

Scope:
- Add `BlockIntent` table to `server/api/llm/models.py`.
- Implement `POST /api/blocks/preview` (§7.2).
- Implement `POST /api/blocks/commit` (§7.3).
- Update Build mode UX: after Stage 3 emits a proposal, client calls preview, shows `ProposalPreview` with the diff, trader confirms → client calls commit.
- Implement `GET /api/streams/{name}/intent` and a small Inspector addition that surfaces "why does this block exist?" when a stream with a stored intent is focused.

Verification: create a block via Build; verify the preview diff matches the post-commit state; query `block_intents` and confirm the row includes the original phrasing, intent, synthesis, and preview. Typecheck + compileall clean.

### Milestone 4 — Feedback detector + llm_failures + user_context

Scope:
- Add `LlmFailure` and `UserContextEntry` tables.
- Create `feedback_detector.py` — replaces `correction_detector.py`.
- Wire the unified detector into `POST /api/investigate` and `POST /api/build/converse` (fires post-response).
- Implement `POST /api/llm/failures` for UI-driven signals (preview_rejection, silent_rejection).
- Implement the background sweep for silent_rejection (§10.2).
- Implement post_commit_edit detection (§10.2).
- Create `user_context.py` helpers; wire into the prompt builder for all three modes. Every prompt now carries the user-context section.
- Delete `correction_detector.py`.

Verification:
- Say something contrarian to the LLM in Investigate; verify a row lands in `domain_kb.json` and (optionally) `llm_failures` with signal_type=factual_correction.
- Express frustration; verify `llm_failures` captures `discontent`.
- Cancel a preview; verify `llm_failures` captures `preview_rejection`.
- Over multiple turns, verify `user_context_entries` accumulates (e.g. consistently saying "50 vol" → `magnitude_vocabulary` entry).

### Milestone 5 (follow-up, outside this spec's required delivery) — RAG over prior intents

Sketch (for completeness, not scoped into the delivery):
- Embed every new `BlockIntent.original_phrasing` at write time.
- Stage 2 prompt reads the top-K most-similar prior intents for the current user and includes them for conflict detection and consistency.
- Stage 1 can also use embeddings to sharpen the schema-fit-vs-fallback boundary in Stage 2.

Defer until the core five-stage pipeline has shipped and the preset registry has matured.

## 14. Testing strategy

No full unit-test suite exists for the LLM layer today (OpenRouter calls are not mocked). Strategy:

### 14.1 Unit tests — pure code paths

- `test_parameter_presets.py` — every preset's `BlockConfig.__post_init__` invariants hold; `find_preset` roundtrips by id; `serialize_presets_for_prompt` includes every entry.
- `test_intent_output_validation.py` — `IntentOutput` rejects multiple-fields-set, accepts exactly one.
- `test_block_config_dict_roundtrip.py` — `BlockConfigDict.to_block_config()` enforces framework invariants (e.g. rejects `decay_end_size_mult=0.5` with `annualized=False`).
- `test_preview_endpoint.py` — apply a known-good proposal against a mock stream registry and assert the returned deltas match a hand-computed baseline.

### 14.2 Integration tests — DB writes

- `test_llm_call_logging.py` — mock `OpenRouterClient.complete_with_fallback` to return a fixed response; assert one `llm_calls` row with expected fields.
- `test_feedback_detector_fanout.py` — mock detector LLM response; assert correct rows land in `llm_failures` and `user_context_entries`.
- `test_block_intent_persistence.py` — run a commit end-to-end (with mocked LLM and a live `run_pipeline`); assert `block_intents` has the full triplet.

### 14.3 Manual regression (end-to-end Build flows)

Scripted scenarios the implementer should walk through before declaring M2 / M3 / M4 done:

1. **Canonical base-vol view:** "I think ETH vols will get bid to 60 on Dec expiries." → matches `base_vol_shifting_pct`, commits, preview shows ETH-only deltas.
2. **Canonical event view:** "FOMC next Wednesday is going to be a 3% move on BTC." → matches `event_vol_fast_decay_pct_move`, commits with `start_timestamp` set.
3. **Unusual input requiring custom derivation:** "I want to register a view on realised-to-implied skew for SOL perps." → Stage 1 routes to `view` (closest hint), Stage 2 cannot fit `DiscretionaryViewIntent`, emits `RawIntent`, Stage 3 Mode B derives a block + critique runs.
4. **Rejection path:** "I have a feed of BTC spot prices." → Stage 3 detects no conversion-to-variance path exists; LLM returns an explanation instead of a proposal.
5. **Discontent capture:** LLM proposes FOMC with a 0.03 decay; trader says "no, CPI is always faster, use 0.05." → `llm_failures` row with `discontent`; `user_context_entries` upserts `preferred_decay_rates`.
6. **Preview rejection:** trader sees a diff that would blow out BTC 27MAR position and clicks Cancel → `llm_failures` row with `preview_rejection`.

### 14.4 No tests that hit real OpenRouter

Always mock the HTTP client in tests. Keep wall-clock latency out of CI.

## 15. Migration + backward compatibility

### 15.1 Chat transcripts

Existing chat transcripts live client-side in React state (`ChatProvider.messages`). Not persisted. No migration needed — existing users' open sessions continue using the old Build mode until page reload, after which the new flow is active.

### 15.2 Existing blocks without `block_intents` rows

Blocks created before Milestone 3 ships will not have a `block_intents` row. UI must tolerate this gracefully:
- `GET /api/streams/{name}/intent` returns 404.
- Inspector "Why does this block exist?" surface shows a "Pre-v2 block — no intent recorded" placeholder.

Do not backfill. The stored intents accumulate going forward.

### 15.3 `domain_kb.json`

No migration. Remains file-based, global, unchanged.

### 15.4 Feature flag / rollout

None. Each milestone is all-users-all-at-once. The spec is small enough that partial rollouts are more risky than a surgical PR per milestone.

## 16. Resolved design decisions

All eight open questions resolved 2026-04-23.

1. **Presets are code-owned.** Adding a preset requires a PR appending one `ParameterPreset` entry to `parameter_presets.py`. No runtime preset creation by users, even via `user_context`. Rationale: the product should "work like magic" — a carefully curated preset registry is part of the magic; user-defined presets would fork that consistency.

2. **Stage 3 Mode B critique failure → surface to trader.** When the critique pass flags concerns and the model cannot fix them, the trader sees the critique's `concerns` list and decides: adjust the input and retry, or abandon. No auto-retry loop.

3. **Latency budget: 5 seconds end-to-end from trader submit to proposal visible.** If M2 benchmarks breach this, the first optimisation is merging Stages 1 + 2 into a single structured-output LLM call (the router's classification becomes one field of the `IntentOutput` schema). Model selection (favour `-haiku`-class models for the router and intent extractor) is the second lever. Do NOT sacrifice the critique pass for latency — it earns its cost by catching silent errors in custom derivations.

4. **Critique pass runs on Mode B only, stays as specified.** Preset-matched paths skip the critique because the preset itself is an already-reviewed artefact.

5. **No `novel` category at the router.** The router has five categories: `stream | view | headline | question | none`. Framework-relevant inputs that don't fit a `StructuredIntent` schema flow through Stage 2's `RawIntent` fallback and into Stage 3 Mode B — no separate router category is needed. Router categories for Build inputs (`stream`, `view`, `headline`) become *hints* to Stage 2, not constraints.

6. **Silent rejection threshold: 120s.** Confirmed. Calibrate post-M4.

7. **Post-commit edit threshold: 10 minutes.** This is the window during which an edit / delete of a freshly-created block is logged to `llm_failures` as `signal_type="post_commit_edit"`. Premise: an edit within 10 minutes of creation is most likely a correction of the original proposal, not a response to new information; beyond 10 minutes, the edit is more likely substantive and not worth flagging as an LLM failure. Confirmed. Calibrate post-M4.

8. **No admin UI for failures.** `llm_failures` rows are inspected by developers directly against SQLite (or whichever DATABASE_URL is configured). Admin endpoint `GET /api/admin/llm-failures` remains in the spec as a programmatic read path, but no UI is built.

## 17. What the implementer should do first

Read (in order):
1. `CLAUDE.md`
2. `docs/architecture.md` — Key Files table
3. `docs/product.md` — framework math
4. `server/core/config.py` — `BlockConfig` / `StreamConfig` definitions
5. `server/api/llm/prompts/core.py` — existing framework sections
6. `server/api/llm/prompts/build.py` — the monolithic prompt being replaced
7. `server/api/auth/models.py` — SQLAlchemy conventions
8. `server/api/llm/correction_detector.py` — detector pattern to generalise
9. This spec, top to bottom.

Then start on Milestone 1. Do not skip ahead — the LLM logging foundation needs to exist before any of Milestones 2–4 is trustable.

---

**Spec ends.**
