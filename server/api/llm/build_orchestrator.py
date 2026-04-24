"""
Build orchestrator — glues Stages 1 → 2 → 3 (+3.5 on Mode B).

Each stage is a small async function; the orchestrator yields typed
events that the router serialises to SSE frames.

Event shapes (dict payloads so SSE serialisation is trivial):
- ``{"delta": "<text>"}`` — natural-language assistant message
- ``{"stage": "router"   | "intent" | "synthesis" | "critique", "output": {...}}``
- ``{"stage": "proposal", "payload": ProposedBlockPayload.model_dump()}``
- ``{"error": "<detail>"}`` — fatal stage failure; client should surface

Every LLM call is recorded to ``llm_calls`` via ``record_call`` under a
shared ``conversation_turn_id`` so the full turn is grouped in the audit.
The orchestrator also emits one structured log line per turn with
per-stage elapsed-ms — feeds the merge-decision on whether to collapse
Stages 1+2 into a single structured-output call (spec §16.3).
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from pydantic import ValidationError

from server.api.llm.client import OpenRouterClient
from server.api.llm.domain_kb import serialize_kb_section
from server.api.llm.orchestration_config import LlmOrchestrationConfig
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
from server.api.llm.stages import StageError, run_json_stage, run_tool_stage
from server.api.llm.synthesis_payload import (
    build_custom_synthesis,
    build_preset_synthesis,
)
from server.api.llm.user_context import serialize_for_prompt as serialize_user_context
from server.api.models import (
    CustomDerivation,
    CustomDerivationCritique,
    IntakeClassification,
    IntentOutput,
    SynthesisOutput,
)

log = logging.getLogger(__name__)

# Canned reply when the router classifies the input as conversational or
# a factual question — Build mode is the wrong mode for those.
_BUILD_FALLTHROUGH_MESSAGE = (
    "Build mode is for adding inputs to the pipeline. Describe a data "
    "stream, a discretionary view, or a headline — or switch to General "
    "mode to ask questions."
)


@asynccontextmanager
async def _record_stage(
    name: str,
    timings_ms: dict[str, float],
    executed: list[str],
):
    """Stamp elapsed ms + record the stage name on exit.

    Runs regardless of exception so a ``StageError`` propagated to the
    caller still leaves the timing / execution trace intact for the
    end-of-turn latency log.
    """
    t_start = time.perf_counter()
    try:
        yield
    finally:
        timings_ms[name] = (time.perf_counter() - t_start) * 1000
        executed.append(name)


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
    # Per-user factual corrections, appended verbatim to each stage's
    # system prompt. The router is excluded — classification doesn't
    # benefit from domain facts.
    kb_section = serialize_kb_section(user_id)

    turn_start = time.perf_counter()
    stage_timings_ms: dict[str, float] = {}
    stages_executed: list[str] = []

    try:
        # Stage 1: Router — also the first place the client learns the
        # conversation_turn_id so it can reference it in later failure
        # signals (e.g. preview_rejection).
        try:
            async with _record_stage("router", stage_timings_ms, stages_executed):
                classification = await _run_router(
                    client=client, orch_config=orch_config,
                    user_id=user_id, conversation_turn_id=conversation_turn_id,
                    conversation=conversation,
                )
        except StageError as exc:
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
            async with _record_stage("intent", stage_timings_ms, stages_executed):
                intent = await _run_intent_extractor(
                    client=client, orch_config=orch_config,
                    user_id=user_id, conversation_turn_id=conversation_turn_id,
                    conversation=conversation, engine_state=engine_state,
                    router_category=classification.category,
                    router_reason=classification.reason,
                    user_context_section=user_context_section,
                    kb_section=kb_section,
                )
        except StageError as exc:
            yield {"error": f"intent stage failed: {exc}"}
            return
        yield {"stage": "intent", "output": intent.model_dump()}

        if intent.clarifying_question:
            yield {"delta": intent.clarifying_question}
            return

        # Stage 3: Synthesiser
        try:
            async with _record_stage("synthesis", stage_timings_ms, stages_executed):
                synthesis = await _run_synthesiser(
                    client=client, orch_config=orch_config,
                    user_id=user_id, conversation_turn_id=conversation_turn_id,
                    intent=intent,
                    user_context_section=user_context_section,
                    kb_section=kb_section,
                )
        except StageError as exc:
            yield {"error": f"synthesis stage failed: {exc}"}
            return

        # Stage 3.5: Critique — Mode B only
        if synthesis.choice.mode == "custom":
            try:
                async with _record_stage("critique", stage_timings_ms, stages_executed):
                    critique = await _run_critique(
                        client=client, orch_config=orch_config,
                        user_id=user_id, conversation_turn_id=conversation_turn_id,
                        intent=intent, custom_derivation=synthesis.choice,
                        kb_section=kb_section,
                    )
            except StageError as exc:
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
    finally:
        total_ms = (time.perf_counter() - turn_start) * 1000
        budget_ms = orch_config.end_to_end_latency_budget_secs * 1000
        level = logging.WARNING if total_ms > budget_ms else logging.INFO
        log.log(
            level,
            "build.turn latency_total_ms=%.1f router_ms=%.1f intent_ms=%.1f "
            "synthesis_ms=%.1f critique_ms=%.1f stages=%s user_id=%s turn_id=%s",
            total_ms,
            stage_timings_ms.get("router", 0.0),
            stage_timings_ms.get("intent", 0.0),
            stage_timings_ms.get("synthesis", 0.0),
            stage_timings_ms.get("critique", 0.0),
            stages_executed,
            user_id,
            conversation_turn_id,
        )


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
    try:
        return IntakeClassification(**data)
    except ValidationError as exc:
        raise StageError(f"router output validation failed: {exc}") from exc


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
    kb_section: str,
) -> IntentOutput:
    system_prompt = build_intent_prompt(
        engine_state=engine_state,
        router_category=router_category,
        router_reason=router_reason,
        user_context_section=user_context_section,
    ) + kb_section
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *conversation,
    ]
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
    try:
        return IntentOutput(**data)
    except (ValidationError, ValueError) as exc:
        # ``ValueError`` covers IntentOutput's model_post_init — the
        # "exactly one of structured/raw/clarifying_question" check.
        raise StageError(f"intent output validation failed: {exc}") from exc


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
    kb_section: str,
) -> SynthesisOutput:
    system_prompt = build_synthesiser_prompt(
        intent.model_dump(),
        user_context_section=user_context_section,
    ) + kb_section
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
    if tool_name == "select_preset":
        return build_preset_synthesis(intent, tool_args)
    if tool_name == "derive_custom_block":
        return build_custom_synthesis(intent, tool_args)
    raise StageError(f"unknown synthesiser tool: {tool_name!r}")


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
    kb_section: str,
) -> CustomDerivationCritique:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": CRITIQUE_SYSTEM_PROMPT + kb_section},
        {
            "role": "user",
            "content": build_critique_user_message(
                intent.model_dump(),
                # Dump without the critique field to avoid a self-reference.
                custom_derivation.model_dump(exclude={"critique"}),
            ),
        },
    ]
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
    try:
        return CustomDerivationCritique(**data)
    except ValidationError as exc:
        raise StageError(f"critique output validation failed: {exc}") from exc


