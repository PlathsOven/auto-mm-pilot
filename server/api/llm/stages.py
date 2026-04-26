"""
Stage-runner helpers for LLM orchestration.

Wrap the repeating boilerplate: ``record_call`` → ``complete_with_fallback``
→ capture model + response → extract. Two variants cover every caller:

- ``run_json_stage`` — response_format=json_object, returns
  ``(parsed_dict, StageTelemetry)``.
- ``run_tool_stage`` — forced tool_choice, returns
  ``(tool_name, args, StageTelemetry)``.

``StageTelemetry`` is the tuple ``(model_used, tokens_in, tokens_out)``
and is always populated — callers can thread it through to the SSE
event stream so the UI can show per-stage latency / model / cost at a
glance.

Each stage-specific prompt / message builder / post-validation lives in
the caller (build orchestrator, feedback detector). The helpers own only
the LLM-call glue.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from server.api.llm.audit import record_call
from server.api.llm.client import OpenRouterClient
from server.api.llm.openrouter_parse import get_tool_call, parse_json_content


class StageError(Exception):
    """Recoverable per-stage failure — surfaced to the client as an error event."""


@dataclass(frozen=True)
class StageTelemetry:
    """Per-stage LLM metadata forwarded to the client for debug visibility."""
    model_used: str
    tokens_in: int
    tokens_out: int


def _extract_telemetry(
    resp: dict[str, Any], model_used: str,
) -> StageTelemetry:
    """Pull ``usage.prompt_tokens`` / ``usage.completion_tokens`` out of the response.

    OpenRouter normalises the usage block across providers; missing fields
    default to 0 so the helper never raises on a malformed response.
    """
    usage = resp.get("usage") or {}
    return StageTelemetry(
        model_used=model_used,
        tokens_in=int(usage.get("prompt_tokens") or 0),
        tokens_out=int(usage.get("completion_tokens") or 0),
    )


async def run_json_stage(
    *,
    client: OpenRouterClient,
    user_id: str,
    conversation_turn_id: str,
    stage: str,
    mode: str | None,
    messages: list[dict[str, Any]],
    models: tuple[str, ...],
    temperature: float,
    max_tokens: int,
) -> tuple[dict[str, Any], StageTelemetry]:
    """Run a JSON-shaped LLM call and return the parsed content + telemetry.

    Records the call to ``llm_calls`` and extracts the JSON dict from
    ``choices[0].message.content``. A malformed JSON body surfaces as
    ``StageError`` with the stage name attached; downstream Pydantic
    validation is still the caller's responsibility.
    """
    async with record_call(
        user_id=user_id,
        conversation_turn_id=conversation_turn_id,
        stage=stage,
        mode=mode,
        model=models[0],
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    ) as handle:
        resp, model_used = await client.complete_with_fallback(
            models=models,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )
        handle.record_model_used(model_used)
        handle.capture_openrouter_response(resp)
    try:
        return parse_json_content(resp), _extract_telemetry(resp, model_used)
    except json.JSONDecodeError as exc:
        raise StageError(f"{stage} response was not valid JSON: {exc}") from exc


async def run_tool_stage(
    *,
    client: OpenRouterClient,
    user_id: str,
    conversation_turn_id: str,
    stage: str,
    mode: str | None,
    messages: list[dict[str, Any]],
    models: tuple[str, ...],
    tools: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    tool_choice: Any = "required",
) -> tuple[str, dict[str, Any], StageTelemetry]:
    """Run a forced tool-call LLM request and return ``(name, args, telemetry)``.

    Records the call and pulls the first ``tool_calls`` entry. Missing
    tool calls or malformed arguments surface as ``StageError`` with the
    stage name attached. Pass ``tool_choice={"type": "function", "function":
    {"name": "<tool>"}}`` to force a specific tool instead of letting the
    model pick among the schemas.
    """
    async with record_call(
        user_id=user_id,
        conversation_turn_id=conversation_turn_id,
        stage=stage,
        mode=mode,
        model=models[0],
        messages=messages,
        tools=tools,
        temperature=temperature,
        max_tokens=max_tokens,
    ) as handle:
        resp, model_used = await client.complete_with_fallback(
            models=models,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            tools=tools,
            tool_choice=tool_choice,
        )
        handle.record_model_used(model_used)
        handle.capture_openrouter_response(resp)
    try:
        name, args = get_tool_call(resp)
    except ValueError as exc:
        raise StageError(f"{stage} tool call failed: {exc}") from exc
    return name, args, _extract_telemetry(resp, model_used)
