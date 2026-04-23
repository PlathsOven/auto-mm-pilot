"""
Build orchestrator — glues Stages 1 → 2 → 3 (+3.5 on Mode B).

Replaces the monolithic Build mode from ``prompts/build.py``. Each
stage is a small async function; the orchestrator yields typed events
that the router serialises to SSE frames.

Event shapes (dict payloads so SSE serialisation is trivial):
- ``{"delta": "<text>"}`` — natural-language assistant message
- ``{"stage": "router"   | "intent" | "synthesis" | "critique", "output": {...}}``
- ``{"stage": "proposal", "payload": ProposedBlockPayload.model_dump()}``
- ``{"error": "<detail>"}`` — fatal stage failure; client should surface

Every LLM call is recorded to ``llm_calls`` via ``record_call`` under a
shared ``conversation_turn_id`` so the full turn is grouped in the audit.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from pydantic import ValidationError

from server.api.llm.client import OpenRouterClient
from server.api.llm.orchestration_config import LlmOrchestrationConfig
from server.api.llm.parameter_presets import find_preset
from server.api.llm.prompts.critique import (
    CRITIQUE_SYSTEM_PROMPT,
    build_critique_user_message,
)
from server.api.llm.prompts.intent_extractor import build_intent_prompt
from server.api.llm.prompts.router import ROUTER_SYSTEM_PROMPT
from server.api.llm.prompts.synthesiser import (
    SYNTHESISER_TOOLS,
    build_synthesiser_prompt,
)
from server.api.llm.stages import run_json_stage, run_tool_stage
from server.api.llm.user_context import serialize_for_prompt as serialize_user_context
from server.api.models import (
    BlockConfigDict,
    CustomDerivation,
    CustomDerivationCritique,
    DataStreamIntent,
    DiscretionaryViewIntent,
    IntakeClassification,
    IntentOutput,
    PresetSelection,
    ProposalSnapshotRow,
    ProposedBlockPayload,
    SynthesisOutput,
    UnitConversionDict,
)

log = logging.getLogger(__name__)

# Canned reply when the router classifies the input as conversational or
# a factual question — Build mode is the wrong mode for those.
_BUILD_FALLTHROUGH_MESSAGE = (
    "Build mode is for adding inputs to the pipeline. Describe a data "
    "stream, a discretionary view, or a headline — or switch to General "
    "mode to ask questions."
)


# ──────────────────────────────────────────────────────────────────
# Orchestrator entry point
# ──────────────────────────────────────────────────────────────────

async def run_build_pipeline(
    *,
    client: OpenRouterClient,
    orch_config: LlmOrchestrationConfig,
    user_id: str,
    conversation_turn_id: str,
    conversation: list[dict[str, str]],
    engine_state: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    """Run Stages 1–3(+3.5) for one Build-mode trader turn.

    Yields SSE-ready dict events. Does not raise on stage failures —
    they become ``{"error": ...}`` events. Host exceptions (DB down,
    network down) still propagate so the router can 500.
    """
    # Fetch the user's learned vocabulary / preferences once and thread
    # it through the prompt-building stages. Empty string when the user
    # has no entries — callers pass it through unconditionally.
    user_context_section = serialize_user_context(user_id)

    # Stage 1: Router — also the first place the client learns the
    # conversation_turn_id so it can reference it in later failure
    # signals (e.g. preview_rejection).
    try:
        classification = await _run_router(
            client=client, orch_config=orch_config,
            user_id=user_id, conversation_turn_id=conversation_turn_id,
            conversation=conversation,
        )
    except _StageError as exc:
        yield {"error": f"router stage failed: {exc}"}
        return
    yield {
        "stage": "router",
        "output": classification.model_dump(),
        "conversation_turn_id": conversation_turn_id,
    }

    if classification.category in ("question", "none"):
        yield {"delta": _BUILD_FALLTHROUGH_MESSAGE}
        return

    # Stage 2: Intent extractor
    try:
        intent = await _run_intent_extractor(
            client=client, orch_config=orch_config,
            user_id=user_id, conversation_turn_id=conversation_turn_id,
            conversation=conversation, engine_state=engine_state,
            router_category=classification.category,
            router_reason=classification.reason,
            user_context_section=user_context_section,
        )
    except _StageError as exc:
        yield {"error": f"intent stage failed: {exc}"}
        return
    yield {"stage": "intent", "output": intent.model_dump()}

    if intent.clarifying_question:
        yield {"delta": intent.clarifying_question}
        return

    # Stage 3: Synthesiser
    try:
        synthesis = await _run_synthesiser(
            client=client, orch_config=orch_config,
            user_id=user_id, conversation_turn_id=conversation_turn_id,
            intent=intent,
            user_context_section=user_context_section,
        )
    except _StageError as exc:
        yield {"error": f"synthesis stage failed: {exc}"}
        return

    # Stage 3.5: Critique — Mode B only
    if synthesis.choice.mode == "custom":
        try:
            critique = await _run_critique(
                client=client, orch_config=orch_config,
                user_id=user_id, conversation_turn_id=conversation_turn_id,
                intent=intent, custom_derivation=synthesis.choice,
            )
        except _StageError as exc:
            yield {"error": f"critique stage failed: {exc}"}
            return
        synthesis.choice.critique = critique
        yield {"stage": "critique", "output": critique.model_dump()}
        if not critique.passes:
            concerns = "\n".join(f"- {c}" for c in critique.concerns)
            yield {
                "delta": (
                    "I'm not confident in that derivation yet. The review "
                    f"raised these concerns:\n{concerns}\n\n"
                    "Rephrase or add detail so I can try again."
                ),
            }
            return

    yield {"stage": "synthesis", "output": synthesis.model_dump()}
    yield {"stage": "proposal", "payload": synthesis.proposed_payload.model_dump(mode="json")}


# ──────────────────────────────────────────────────────────────────
# Stage 1 — Router
# ──────────────────────────────────────────────────────────────────

async def _run_router(
    *,
    client: OpenRouterClient,
    orch_config: LlmOrchestrationConfig,
    user_id: str,
    conversation_turn_id: str,
    conversation: list[dict[str, str]],
) -> IntakeClassification:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
        *conversation,
    ]
    try:
        data = await run_json_stage(
            client=client,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
            stage="router",
            mode="build",
            messages=messages,
            models=orch_config.router_models,
            temperature=orch_config.router_temperature,
            max_tokens=orch_config.router_max_tokens,
        )
        return IntakeClassification(**data)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise _StageError(f"router output parse failed: {exc}") from exc


# ──────────────────────────────────────────────────────────────────
# Stage 2 — Intent extractor
# ──────────────────────────────────────────────────────────────────

async def _run_intent_extractor(
    *,
    client: OpenRouterClient,
    orch_config: LlmOrchestrationConfig,
    user_id: str,
    conversation_turn_id: str,
    conversation: list[dict[str, str]],
    engine_state: dict[str, Any],
    router_category: str,
    router_reason: str,
    user_context_section: str,
) -> IntentOutput:
    system_prompt = build_intent_prompt(
        engine_state=engine_state,
        router_category=router_category,
        router_reason=router_reason,
        user_context_section=user_context_section,
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *conversation,
    ]
    try:
        data = await run_json_stage(
            client=client,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
            stage="intent",
            mode="build",
            messages=messages,
            models=orch_config.intent_models,
            temperature=orch_config.intent_temperature,
            max_tokens=orch_config.intent_max_tokens,
        )
        return IntentOutput(**data)
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        raise _StageError(f"intent output parse failed: {exc}") from exc


# ──────────────────────────────────────────────────────────────────
# Stage 3 — Synthesiser
# ──────────────────────────────────────────────────────────────────

async def _run_synthesiser(
    *,
    client: OpenRouterClient,
    orch_config: LlmOrchestrationConfig,
    user_id: str,
    conversation_turn_id: str,
    intent: IntentOutput,
    user_context_section: str,
) -> SynthesisOutput:
    system_prompt = build_synthesiser_prompt(
        intent.model_dump(),
        user_context_section=user_context_section,
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                "Emit the correct tool call for the Stage 2 intent above. "
                "Prefer `select_preset` when a preset matches; use "
                "`derive_custom_block` only if none fit."
            ),
        },
    ]
    try:
        tool_name, tool_args = await run_tool_stage(
            client=client,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
            stage="synthesis",
            mode="build",
            messages=messages,
            models=orch_config.synthesis_models,
            tools=SYNTHESISER_TOOLS,
            temperature=orch_config.synthesis_temperature,
            max_tokens=orch_config.synthesis_max_tokens,
        )
    except ValueError as exc:
        raise _StageError(f"synthesiser tool call failed: {exc}") from exc
    if tool_name == "select_preset":
        return _build_preset_synthesis(intent, tool_args)
    if tool_name == "derive_custom_block":
        return _build_custom_synthesis(intent, tool_args)
    raise _StageError(f"unknown synthesiser tool: {tool_name!r}")


# ──────────────────────────────────────────────────────────────────
# Stage 3.5 — Critique
# ──────────────────────────────────────────────────────────────────

async def _run_critique(
    *,
    client: OpenRouterClient,
    orch_config: LlmOrchestrationConfig,
    user_id: str,
    conversation_turn_id: str,
    intent: IntentOutput,
    custom_derivation: CustomDerivation,
) -> CustomDerivationCritique:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": CRITIQUE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": build_critique_user_message(
                intent.model_dump(),
                # Dump without the critique field to avoid a self-reference.
                custom_derivation.model_dump(exclude={"critique"}),
            ),
        },
    ]
    try:
        data = await run_json_stage(
            client=client,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
            stage="critique",
            mode="build",
            messages=messages,
            models=orch_config.critique_models,
            temperature=orch_config.critique_temperature,
            max_tokens=orch_config.critique_max_tokens,
        )
        return CustomDerivationCritique(**data)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise _StageError(f"critique output parse failed: {exc}") from exc


# ──────────────────────────────────────────────────────────────────
# Synthesis → ProposedBlockPayload conversion
# ──────────────────────────────────────────────────────────────────

def _build_preset_synthesis(
    intent: IntentOutput,
    args: dict[str, Any],
) -> SynthesisOutput:
    preset_id = args.get("preset_id", "")
    preset = find_preset(preset_id)
    if preset is None:
        raise _StageError(f"synthesiser referenced unknown preset: {preset_id!r}")

    symbols = _require_str_list(args, "symbols")
    expiries = _require_str_list(args, "expiries")
    raw_value = _require_number(args, "raw_value")
    start_timestamp = _optional_datetime(args.get("start_timestamp"))
    override = args.get("var_fair_ratio_override")
    reasoning = args.get("reasoning") or "matched preset."

    # Clone the preset's BlockConfig with optional var_fair_ratio override.
    var_fair_ratio = (
        float(override) if isinstance(override, (int, float)) and override is not None
        else preset.block.var_fair_ratio
    )
    block = BlockConfigDict(
        annualized=preset.block.annualized,
        temporal_position=preset.block.temporal_position,
        decay_end_size_mult=preset.block.decay_end_size_mult,
        decay_rate_prop_per_min=preset.block.decay_rate_prop_per_min,
        var_fair_ratio=var_fair_ratio,
    )
    conv = preset.unit_conversion

    payload = _assemble_payload(
        intent=intent, symbols=symbols, expiries=expiries,
        raw_value=raw_value, start_timestamp=start_timestamp,
        scale=conv.scale, offset=conv.offset, exponent=conv.exponent,
        block=block,
    )
    choice = PresetSelection(
        preset_id=preset_id,
        var_fair_ratio_override=override,
        reasoning=reasoning,
    )
    return SynthesisOutput(choice=choice, proposed_payload=payload)


def _build_custom_synthesis(
    intent: IntentOutput,
    args: dict[str, Any],
) -> SynthesisOutput:
    symbols = _require_str_list(args, "symbols")
    expiries = _require_str_list(args, "expiries")
    raw_value = _require_number(args, "raw_value")
    start_timestamp = _optional_datetime(args.get("start_timestamp"))
    block_raw = args.get("block") or {}
    conv_raw = args.get("unit_conversion") or {}
    reasoning = args.get("reasoning") or ""

    try:
        block = BlockConfigDict(**block_raw)
        block.to_block_config()  # enforces framework invariants
        conv = UnitConversionDict(**conv_raw)
    except (ValidationError, ValueError) as exc:
        raise _StageError(f"custom derivation failed validation: {exc}") from exc

    payload = _assemble_payload(
        intent=intent, symbols=symbols, expiries=expiries,
        raw_value=raw_value, start_timestamp=start_timestamp,
        scale=conv.scale, offset=conv.offset, exponent=conv.exponent,
        block=block,
    )
    choice = CustomDerivation(
        block=block, unit_conversion=conv, reasoning=reasoning,
    )
    return SynthesisOutput(choice=choice, proposed_payload=payload)


def _assemble_payload(
    *,
    intent: IntentOutput,
    symbols: list[str],
    expiries: list[str],
    raw_value: float,
    start_timestamp: datetime | None,
    scale: float,
    offset: float,
    exponent: float,
    block: BlockConfigDict,
) -> ProposedBlockPayload:
    """Convert a tool call + intent into a ``ProposedBlockPayload``."""
    is_stream = isinstance(intent.structured, DataStreamIntent)
    action = "create_stream" if is_stream else "create_manual_block"
    key_cols = (
        intent.structured.key_cols if is_stream else ["symbol", "expiry"]
    )

    snapshot_rows: list[ProposalSnapshotRow] = []
    if action == "create_manual_block":
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        snapshot_rows = [
            ProposalSnapshotRow(
                timestamp=now,
                symbol=sym,
                expiry=exp,
                raw_value=raw_value,
                start_timestamp=start_timestamp,
            )
            for sym in symbols for exp in expiries
        ]

    return ProposedBlockPayload(
        action=action,
        stream_name=_derive_stream_name(intent, symbols),
        key_cols=key_cols,
        scale=scale,
        offset=offset,
        exponent=exponent,
        block=block,
        snapshot_rows=snapshot_rows,
    )


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

class _StageError(Exception):
    """Recoverable per-stage failure — surfaced to the client as an error event."""


def _require_str_list(args: dict[str, Any], key: str) -> list[str]:
    val = args.get(key)
    if not isinstance(val, list) or not all(isinstance(v, str) for v in val):
        raise _StageError(f"tool call missing or malformed {key!r} (expected list[str])")
    if not val:
        raise _StageError(f"tool call {key!r} cannot be empty")
    return val


def _require_number(args: dict[str, Any], key: str) -> float:
    val = args.get(key)
    if not isinstance(val, (int, float)):
        raise _StageError(f"tool call missing or malformed {key!r} (expected number)")
    return float(val)


def _optional_datetime(val: Any) -> datetime | None:
    if val in (None, ""):
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        # Accept both "...Z" and "+00:00"; store naive UTC to match the
        # codebase convention (see server/api/auth/models.py docstring).
        s = val.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    raise _StageError(f"tool call start_timestamp malformed: {val!r}")


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(text: str) -> str:
    return _SLUG_RE.sub("_", text.lower()).strip("_") or "x"


def _derive_stream_name(intent: IntentOutput, symbols: list[str]) -> str:
    """Build a deterministic, readable stream name from the structured intent.

    The trader can rename the stream in the BlockDrawer before committing.
    Falls back to a timestamped generic name if the intent doesn't carry
    enough identity for a descriptive slug.
    """
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    first_sym = symbols[0].lower() if symbols else "x"

    s = intent.structured
    if isinstance(s, DiscretionaryViewIntent):
        topic = s.event_type or s.target_variable or "view"
        return f"opinion_{_slug(topic)}_{first_sym}_{today}"
    if isinstance(s, DataStreamIntent):
        return f"feed_{_slug(s.semantic_type)}"

    # RawIntent or HeadlineIntent → generic
    return f"custom_{first_sym}_{today}"
