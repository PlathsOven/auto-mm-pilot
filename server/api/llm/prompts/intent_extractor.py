"""
Stage 2 — Intent extractor prompt.

Given the router's category hint and the Build conversation, extract a
``StructuredIntent`` (DiscretionaryViewIntent / DataStreamIntent /
HeadlineIntent) or, if the input is framework-relevant but doesn't
match a schema, a ``RawIntent`` fallback. If a required field is
missing, return a single ``clarifying_question``.

Output is strict JSON conforming to ``IntentOutput`` (server/api/models.py).
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.prompts.core import (
    BASE_VS_EVENT_RULES,
    SHARED_CORE,
    UNIT_CONVERSION_REFERENCE,
    current_time_block,
    extract_risk_dims,
)


_INTENT_EXTRACTOR_EXT = """\

# INTENT EXTRACTOR (STAGE 2)

**Mandate:** Turn the trader's free-text Build message into one of the \
structured intent schemas below, or into a ``RawIntent`` fallback, or \
into a ``clarifying_question`` if a required field is missing.

The router has already classified the message with a hint — use the \
hint to pick which schema to attempt first, but fall back to \
``RawIntent`` (not a different schema) if the message doesn't fit.

## OUTPUT SCHEMA

Return ONLY a JSON object matching this exact shape (no prose, no \
markdown, no code fences):

{
  "classification": {
    "category": "<view|stream|headline|question|none>",
    "confidence": <0.0..1.0>,
    "reason": "<one sentence>"
  },
  "structured": <StructuredIntent or null>,
  "raw": <RawIntent or null>,
  "clarifying_question": <string or null>
}

**HARD INVARIANT — mutual exclusion:** exactly one of ``structured`` / \
``raw`` / ``clarifying_question`` is non-null; the other two are null. \
No exceptions. Setting two or more produces a validation error and the \
turn fails.

- If you extracted enough information to fill a structured schema, \
EMIT STRUCTURED and set ``clarifying_question`` to null. The trader can \
refine in a follow-up turn.
- Emit ``clarifying_question`` ONLY when neither structured nor raw \
is possible because a REQUIRED field is genuinely missing.
- Never emit ``clarifying_question`` "just to be safe" alongside a \
structured intent.

## STRUCTURED INTENT VARIANTS

Pick the variant matching the router's category hint. Every variant \
carries the trader's ``original_phrasing`` verbatim (the exact words \
they used, not your paraphrase) — this is persisted alongside the \
block and is the desk's shared-language primitive.

### DiscretionaryViewIntent (category="view")

{
  "kind": "view",
  "original_phrasing": "<trader's verbatim words>",
  "target_variable": "<e.g. 'annualised vol', 'event-day move'>",
  "magnitude": <float>,
  "magnitude_unit": "<e.g. 'percent', 'decimal', 'vol_points'>",
  "time_horizon": "<ongoing|event_window>",
  "event_or_ongoing": "<event|ongoing>",
  "event_type": "<e.g. 'FOMC' | null when ongoing>",
  "start_timestamp": "<ISO 8601 | null when ongoing>",
  "symbols": ["<symbol>", ...],
  "expiries": ["<expiry>", ...],
  "confidence_relative": "<very_low|low|medium|high|very_high>"
}

### DataStreamIntent (category="stream")

{
  "kind": "stream",
  "original_phrasing": "<trader's verbatim words>",
  "semantic_type": "<e.g. 'realised vol', 'funding rate'>",
  "units_in": "<e.g. 'annualised vol as decimal', 'percentage points'>",
  "temporal_character": "<ongoing|event_window>",
  "key_cols": ["<dimension>", ...],
  "update_cadence": "<e.g. 'per minute', 'tick-by-tick', 'hourly'>",
  "confidence_relative": "<very_low|low|medium|high|very_high>"
}

### HeadlineIntent (category="headline") — reserved, full flow deferred

{
  "kind": "headline",
  "original_phrasing": "<the pasted headline>",
  "event_type": "<classification, e.g. 'macro_release'>",
  "market_variable_affected": "<e.g. 'BTC vol', 'cross-asset correlation'>",
  "direction": "<bullish_vol|bearish_vol|ambiguous>",
  "magnitude_language": "<the language used, e.g. 'small surprise' | null>",
  "probable_timeframe": "<e.g. '30 minutes', 'overnight' | null>"
}

``magnitude_language`` and ``probable_timeframe`` are OPTIONAL — emit \
``null`` when the input gives no magnitude or timeframe cue. Never \
invent a filler like ``"unspecified"``. ``direction`` defaults to \
``"ambiguous"`` when the input is directionally unclear.

## FALLBACK — RawIntent

If the message is framework-relevant (talking about vol, events, \
correlations, risk) but doesn't fit any structured schema, emit a \
``RawIntent`` under ``raw``:

{
  "kind": "raw",
  "original_phrasing": "<trader's verbatim words>",
  "llm_interpretation": "<one paragraph — your best read>",
  "relevant_framework_concepts": ["<concept>", ...],
  "unresolved_fields": ["<what structured schemas would have wanted>"]
}

Pick ``RawIntent`` when: the input is a novel construct (e.g. \
cross-asset correlation views, vol-of-vol proxies, regime-change \
indicators) without a clean schema fit. Stage 3 has a custom-derivation \
path for these.

## FALLBACK — Clarifying Question

If a structured-intent variant is the clear fit but a REQUIRED field is \
missing (e.g. the trader said "FOMC will be an upset" but didn't say \
the magnitude or expiry), return a short clarifying question under \
``clarifying_question`` and set ``structured`` and ``raw`` to null.

Ask ONE question at a time. Do not stack multiple questions into one \
string. If you need two pieces of information, ask the most important \
one first and let the next Stage 2 run ask the follow-up.

Example: {"classification": {...}, "structured": null, "raw": null, \
"clarifying_question": "What absolute % move do you expect on average?"}

## PARSING CONVERSATION CONTEXT

The conversation is an OpenAI-style message array. The latest user \
message is the input to classify. If an earlier assistant message \
asked a clarifying question, the latest user message may be a short \
answer to it — in that case, reconstruct the full intent by reading \
the earlier trader turn plus the latest answer.

Preserve the original phrasing from the ORIGINAL user turn, not from \
the short follow-up answer.\
"""


def build_intent_prompt(
    engine_state: dict[str, Any],
    router_category: str,
    router_reason: str,
    user_context_section: str = "",
) -> str:
    """Assemble the Stage 2 system prompt.

    Includes shared core, framework helpers (unit conversion, base-vs-event
    rules), engine-state dims (so the LLM knows available symbols /
    expiries for ``DiscretionaryViewIntent.symbols``), the router's
    hint, and the per-user context section (vocabulary / preferences
    learned across prior sessions).
    """
    symbols, expiries = extract_risk_dims(engine_state)
    streams = engine_state.get("streams", [])
    existing_stream_names = [
        s.get("stream_name") for s in streams if s.get("stream_name")
    ]

    dims_block = json.dumps(
        {
            "available_symbols": symbols,
            "available_expiries": expiries,
            "existing_stream_names": existing_stream_names,
        },
        indent=2,
        default=str,
    )

    return (
        f"{SHARED_CORE}\n"
        f"{user_context_section}\n"
        f"{current_time_block()}"
        f"{UNIT_CONVERSION_REFERENCE}\n"
        f"{BASE_VS_EVENT_RULES}\n"
        f"{_INTENT_EXTRACTOR_EXT}\n\n"
        "## ROUTER HINT\n"
        f"The Stage 1 router classified the input as: `{router_category}`.\n"
        f"Reason: {router_reason}\n\n"
        "Use this as a hint for which structured schema to attempt first. "
        "Fall back to `RawIntent` if none fit.\n\n"
        "## ENGINE STATE (risk dimensions)\n"
        f"```json\n{dims_block}\n```\n"
    )
