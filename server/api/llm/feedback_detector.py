"""
Unified feedback detector.

One LLM call per completed trader turn emits three detection types in
a single JSON object; the caller fans the output to three destinations:

- ``factual_correction``  → ``domain_kb.json`` (global knowledge base)
- ``discontent_signals[]`` → ``llm_failures`` (``signal_type="discontent"``)
- ``preference_signals[]`` → ``user_context_entries`` (upsert by key)

Replaces the narrow ``correction_detector`` from M1. Designed to fire
via ``asyncio.create_task`` — never adds latency to the main response,
never raises: all errors are logged and swallowed.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from server.api.llm.audit import record_call
from server.api.llm.client import OpenRouterClient
from server.api.llm.domain_kb import save_entry as save_domain_kb_entry
from server.api.llm.failures import log_failure
from server.api.llm.openrouter_parse import get_content, strip_markdown_fences
from server.api.llm.user_context import CONTROLLED_KEYS, upsert_entry

log = logging.getLogger(__name__)


_DETECTION_PROMPT = """\
You are the feedback detector for a trading terminal's AI assistant.

Your job: read the most recent exchange and emit THREE detection types \
in a single JSON object. Be aggressive — the assistant is better off \
flagging a false positive than missing a real signal.

## 1. factual_correction

Did the trader correct a factual error the assistant made? Look for:
- "No, that's wrong because..."
- "Actually, the reason is..."
- "You're confusing X with Y"
- Implicit corrections where they restate a fact differently

NOT a correction:
- Asking a new question
- Giving instructions or preferences (those go in preference_signals)
- Changing the topic

## 2. discontent_signals

Is the trader showing frustration, pushback, or "you don't get it" \
affect? Catch:
- "that's not what I said"
- "no, I meant..."
- short, terse replies after a long assistant message
- visible frustration

NOT discontent:
- Neutral follow-up questions
- Factual corrections (those go in factual_correction)
- Preferences stated calmly (those go in preference_signals)

Severity ``mild`` = subtle pushback; ``strong`` = obvious frustration.

## 3. preference_signals

Did the trader reveal a vocabulary rule, a typical dimension of \
interest, or a personal pattern the assistant should remember? \
Controlled key vocabulary (ONLY emit one of these):

- ``magnitude_vocabulary`` — value shape ``{"phrase": "unit", ...}``. \
  E.g. trader consistently says "50 vol" to mean 50% annualised \
  (not 0.50). Returns ``{"50 vol": "percent"}``.
- ``confidence_language`` — value shape ``{"phrase": "level", ...}``. \
  E.g. "pretty confident" → "high".
- ``typical_symbols_of_interest`` — value shape ``["BTC", "ETH", ...]``.
- ``typical_expiries_of_interest`` — value shape ``["YYYY-MM-DD", ...]``.
- ``preferred_decay_rates`` — value shape ``{"event_type": rate, ...}``. \
  E.g. "CPI is always faster, use 0.05" → ``{"CPI": 0.05}``.
- ``calibration_notes`` — value shape ``["free-text observation", ...]``. \
  E.g. "trader's 'expected' move tends to be the lower bound".
- ``framework_mastery_level`` — value shape ``"novice" | "intermediate" | "expert"``.

Each preference signal carries: ``key`` (from the list above), ``value`` \
(matching the schema), ``reasoning`` (one sentence justifying the write).

## Output

Return ONLY a JSON object — no markdown, no prose, no code fences:

{
  "factual_correction": null | {
    "topic": "<2-5 word topic>",
    "misconception": "<what the assistant got wrong>",
    "correct_fact": "<the correct domain fact>",
    "why_it_matters": "<why this distinction matters for trading>"
  },
  "discontent_signals": [
    {
      "severity": "mild" | "strong",
      "llm_output_snippet": "<what the assistant said>",
      "trader_response_snippet": "<how the trader responded>",
      "reasoning": "<why this counts as discontent>"
    }
  ],
  "preference_signals": [
    {
      "key": "<one of the controlled vocabulary>",
      "value": <JSON matching the key's schema>,
      "reasoning": "<why this warrants a user_context write>"
    }
  ]
}

Empty arrays are fine — never fabricate a signal to fill the structure.\
"""


async def detect_and_store(
    client: OpenRouterClient,
    detector_models: tuple[str, ...],
    max_tokens: int,
    temperature: float,
    context_window: int,
    conversation: list[dict[str, str]],
    assistant_response: str,
    user_id: str,
    conversation_turn_id: str,
) -> None:
    """Run the unified feedback detector and fan the output to 3 destinations.

    Fired via ``asyncio.create_task`` from the converse / commit
    endpoints. Never raises.
    """
    try:
        await _detect_and_store_inner(
            client=client,
            detector_models=detector_models,
            max_tokens=max_tokens,
            temperature=temperature,
            context_window=context_window,
            conversation=conversation,
            assistant_response=assistant_response,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
        )
    except Exception:
        log.warning("feedback detector failed", exc_info=True)


async def _detect_and_store_inner(
    *,
    client: OpenRouterClient,
    detector_models: tuple[str, ...],
    max_tokens: int,
    temperature: float,
    context_window: int,
    conversation: list[dict[str, str]],
    assistant_response: str,
    user_id: str,
    conversation_turn_id: str,
) -> None:
    """Inner implementation — may raise."""
    if not any(m["role"] == "assistant" for m in conversation) and not assistant_response:
        return

    recent = conversation[-context_window:]
    if assistant_response:
        recent = [*recent, {"role": "assistant", "content": assistant_response}]

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _DETECTION_PROMPT},
        {
            "role": "user",
            "content": _format_conversation(recent),
        },
    ]

    async with record_call(
        user_id=user_id,
        conversation_turn_id=conversation_turn_id,
        stage="feedback_detector",
        mode=None,
        model=detector_models[0],
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    ) as handle:
        resp, model_used = await client.complete_with_fallback(
            models=detector_models,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )
        handle.record_model_used(model_used)
        handle.capture_openrouter_response(resp)

    raw = strip_markdown_fences(get_content(resp))
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("feedback detector returned non-JSON: %r", raw[:200])
        return

    _fanout(user_id=user_id, conversation_turn_id=conversation_turn_id, result=result)


def _fanout(
    *,
    user_id: str,
    conversation_turn_id: str,
    result: dict[str, Any],
) -> None:
    """Dispatch the detector output to its three destinations."""

    # Destination 1: domain_kb.json (unchanged from the legacy detector).
    correction = result.get("factual_correction")
    if isinstance(correction, dict):
        entry = {
            "topic": correction.get("topic", "unknown"),
            "misconception": correction.get("misconception", ""),
            "correct_fact": correction.get("correct_fact", ""),
            "why_it_matters": correction.get("why_it_matters", ""),
        }
        try:
            save_domain_kb_entry(entry)
        except Exception:
            log.warning("domain_kb save failed", exc_info=True)
        # Mirror to llm_failures for analytics.
        log_failure(
            user_id=user_id,
            signal_type="factual_correction",
            trigger="chat_message",
            conversation_turn_id=conversation_turn_id,
            detector_reasoning=correction.get("why_it_matters"),
            metadata={"topic": correction.get("topic")},
        )

    # Destination 2: llm_failures — each discontent signal.
    for signal in result.get("discontent_signals", []) or []:
        if not isinstance(signal, dict):
            continue
        log_failure(
            user_id=user_id,
            signal_type="discontent",
            trigger="chat_message",
            conversation_turn_id=conversation_turn_id,
            llm_output_snippet=signal.get("llm_output_snippet"),
            trader_response_snippet=signal.get("trader_response_snippet"),
            detector_reasoning=signal.get("reasoning"),
            metadata={"severity": signal.get("severity", "mild")},
        )

    # Destination 3: user_context_entries — each preference signal.
    for signal in result.get("preference_signals", []) or []:
        if not isinstance(signal, dict):
            continue
        key = signal.get("key")
        value = signal.get("value")
        if key not in CONTROLLED_KEYS or value is None:
            continue
        upsert_entry(
            user_id=user_id,
            key=key,
            value=value,
            reasoning=signal.get("reasoning"),
        )


def _format_conversation(messages: list[dict[str, str]]) -> str:
    """Flatten a message list into a readable transcript for the detector."""
    return "\n\n".join(
        f"[{m.get('role', 'user').upper()}]: {m.get('content', '')}"
        for m in messages
    )


__all__ = ["detect_and_store"]
