"""
Stage-runner helpers for LLM orchestration.

Wrap the repeating boilerplate: ``record_call`` → ``complete_with_fallback``
→ capture model + response → extract. Two variants cover every caller:

- ``run_json_stage`` — response_format=json_object, returns parsed dict.
- ``run_tool_stage`` — forced tool_choice, returns ``(tool_name, args)``.

Each stage-specific prompt / message builder / post-validation lives in
the caller (build orchestrator, feedback detector). The helpers own only
the LLM-call glue.
"""

from __future__ import annotations

from typing import Any

from server.api.llm.audit import record_call
from server.api.llm.client import OpenRouterClient
from server.api.llm.openrouter_parse import get_tool_call, parse_json_content


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
) -> dict[str, Any]:
    """Run a JSON-shaped LLM call and return the parsed content.

    Records the call to ``llm_calls`` and extracts the JSON dict from
    ``choices[0].message.content``. Parse errors propagate as
    ``json.JSONDecodeError``.
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
    return parse_json_content(resp)


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
) -> tuple[str, dict[str, Any]]:
    """Run a forced tool-call LLM request and return ``(name, args)``.

    Records the call and pulls the first ``tool_calls`` entry. Raises
    ``ValueError`` when the response carries no tool calls or arguments
    are malformed.
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
            tool_choice="required",
        )
        handle.record_model_used(model_used)
        handle.capture_openrouter_response(resp)
    return get_tool_call(resp)
