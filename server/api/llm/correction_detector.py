"""
Background correction detector.

After every LLM response is fully streamed, this module checks whether
the trader's latest message corrected a factual error.  If so, the
correction is extracted and persisted to the domain knowledge base.

Runs as an ``asyncio.create_task`` — never adds latency to the streamed
response.  All exceptions are caught and logged; failures are silent.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from server.api.llm.audit import record_call
from server.api.llm.client import OpenRouterClient
from server.api.llm.domain_kb import save_entry

log = logging.getLogger(__name__)

# Number of recent messages to send to the detector (user + assistant pairs).
# More context = better detection, but keep token cost low.
_CONTEXT_WINDOW = 6  # last 3 exchanges

_DETECTION_PROMPT = """\
You are a correction detector for a trading terminal's AI assistant.

Your ONLY job: determine whether the trader's latest message corrects \
a factual error made by the assistant. Be AGGRESSIVE — if there is any \
reasonable chance the trader is correcting, teaching, or clarifying a \
domain fact, mark it as a correction. False positives are acceptable; \
missed corrections are not.

A correction is when the trader says something like:
- "No, that's wrong because..."
- "Actually, the reason is..."
- "That's not how it works — ..."
- "You're confusing X with Y"
- Or any implicit correction where they restate a fact differently

NOT a correction:
- Asking a new question
- Agreeing with the assistant
- Changing the topic
- Giving instructions or preferences (not factual corrections)

Respond with ONLY a JSON object (no markdown, no explanation):

If correction detected:
{"is_correction": true, "topic": "<2-5 word topic>", \
"misconception": "<what the assistant got wrong>", \
"correct_fact": "<the correct domain fact>", \
"why_it_matters": "<why this distinction matters for trading>"}

If no correction:
{"is_correction": false}\
"""


async def detect_and_store(
    client: OpenRouterClient,
    detector_models: tuple[str, ...],
    max_tokens: int,
    temperature: float,
    conversation: list[dict[str, str]],
    assistant_response: str,
    user_id: str,
    conversation_turn_id: str,
) -> None:
    """Check the latest exchange for corrections and persist any found.

    This function is designed to be fired via ``asyncio.create_task`` and
    will never raise — all errors are logged and swallowed.
    """
    try:
        await _detect_and_store_inner(
            client, detector_models, max_tokens, temperature,
            conversation, assistant_response,
            user_id=user_id,
            conversation_turn_id=conversation_turn_id,
        )
    except Exception:
        log.warning("Correction detector failed", exc_info=True)


async def _detect_and_store_inner(
    client: OpenRouterClient,
    detector_models: tuple[str, ...],
    max_tokens: int,
    temperature: float,
    conversation: list[dict[str, str]],
    assistant_response: str,
    *,
    user_id: str,
    conversation_turn_id: str,
) -> None:
    """Inner implementation — may raise."""
    # Need at least one prior assistant message to have something to correct
    prior_assistant = any(m["role"] == "assistant" for m in conversation)
    if not prior_assistant:
        return

    # Build the context: recent conversation + the latest assistant response
    recent = conversation[-_CONTEXT_WINDOW:]
    recent_with_response = [
        *recent,
        {"role": "assistant", "content": assistant_response},
    ]

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _DETECTION_PROMPT},
        # Pack the conversation as a single user message for the detector
        {
            "role": "user",
            "content": _format_conversation_for_detector(recent_with_response),
        },
    ]

    async with record_call(
        user_id=user_id,
        conversation_turn_id=conversation_turn_id,
        stage="correction_detector",
        mode=None,
        model=detector_models[0],
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    ) as handle:
        resp = await client.complete_with_fallback(
            models=detector_models,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        handle.capture_openrouter_response(resp)

    raw = (
        resp.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )

    # Strip markdown fences if the model wraps the JSON
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    result = json.loads(raw)

    if not result.get("is_correction"):
        return

    entry = {
        "topic": result.get("topic", "unknown"),
        "misconception": result.get("misconception", ""),
        "correct_fact": result.get("correct_fact", ""),
        "why_it_matters": result.get("why_it_matters", ""),
    }
    save_entry(entry)


def _format_conversation_for_detector(
    messages: list[dict[str, str]],
) -> str:
    """Format conversation messages into a readable transcript for the detector."""
    lines: list[str] = []
    for msg in messages:
        role = msg["role"].upper()
        lines.append(f"[{role}]: {msg['content']}")
    return "\n\n".join(lines)
