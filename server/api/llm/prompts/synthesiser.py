"""
Stage 3 — Parameter synthesiser prompt + tool schemas.

Given a Stage 2 ``IntentOutput`` (structured or raw), emit a fully
parameterised block via one of two tools:

- ``select_preset`` — the situation matches a canonical preset from the
  registry. Deterministic code clones the preset's ``BlockConfig`` and
  ``UnitConversion`` with any overrides.
- ``derive_custom_block`` — no preset fits. The LLM derives each
  parameter from first principles; a mandatory critique pass (Stage 3.5)
  reviews the derivation before Stage 4 preview.

Both tools accept the trader's original phrasing, symbols/expiries,
and raw_value. The critique pass runs only on ``derive_custom_block``
output, since presets are already-reviewed artefacts.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.parameter_presets import serialize_presets_for_prompt
from server.api.llm.prompts.core import (
    BASE_VS_EVENT_RULES,
    BLOCK_DECISION_FLOW,
    FRAMEWORK_DETAIL,
    PARAMETER_MAPPING,
    SHARED_CORE,
    UNIT_CONVERSION_REFERENCE,
    current_time_block,
    extract_risk_dims,
)


# The two tool schemas Stage 3 exposes to the model. Shape matches
# OpenAI's function-calling API — OpenRouter forwards this to the
# underlying provider (Anthropic / OpenAI / Google) verbatim.
SYNTHESISER_TOOLS: list[dict[str, Any]] = [
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
                    "preset_id": {
                        "type": "string",
                        "description": "Exact id of the matching preset.",
                    },
                    "symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "One or more target symbols.",
                    },
                    "expiries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "One or more target expiries.",
                    },
                    "raw_value": {
                        "type": "number",
                        "description": (
                            "The trader's magnitude in the preset's "
                            "expected input units."
                        ),
                    },
                    "start_timestamp": {
                        "type": ["string", "null"],
                        "description": (
                            "ISO 8601 event release time. Required for "
                            "event-vol presets; null for base-vol presets."
                        ),
                    },
                    "var_fair_ratio_override": {
                        "type": ["number", "null"],
                        "description": (
                            "Optional override for var_fair_ratio (trader "
                            "confidence). Null means use the preset's default."
                        ),
                    },
                    "reasoning": {
                        "type": "string",
                        "description": (
                            "1-3 sentences: why this preset fits the "
                            "trader's situation. Cites the trader's own "
                            "words where possible."
                        ),
                    },
                },
                "required": [
                    "preset_id", "symbols", "expiries",
                    "raw_value", "reasoning",
                ],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "derive_custom_block",
            "description": (
                "Emit a block by deriving parameters from first principles. "
                "Call this ONLY when no preset's when_to_use description "
                "fits the trader's situation. Reasoning is mandatory and "
                "must ground each parameter choice in the framework math."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array", "items": {"type": "string"},
                    },
                    "expiries": {
                        "type": "array", "items": {"type": "string"},
                    },
                    "raw_value": {"type": "number"},
                    "start_timestamp": {"type": ["string", "null"]},
                    "block": {
                        "type": "object",
                        "properties": {
                            "annualized": {"type": "boolean"},
                            "temporal_position": {
                                "type": "string",
                                "enum": ["static", "shifting"],
                            },
                            "decay_end_size_mult": {
                                "type": "number", "minimum": 0.0,
                            },
                            "decay_rate_prop_per_min": {
                                "type": "number", "minimum": 0.0,
                            },
                            "var_fair_ratio": {
                                "type": "number", "exclusiveMinimum": 0.0,
                            },
                        },
                        "required": [
                            "annualized", "temporal_position",
                            "decay_end_size_mult", "decay_rate_prop_per_min",
                            "var_fair_ratio",
                        ],
                    },
                    "unit_conversion": {
                        "type": "object",
                        "properties": {
                            "scale": {"type": "number"},
                            "offset": {"type": "number"},
                            "exponent": {"type": "number"},
                            "annualized": {"type": "boolean"},
                        },
                        "required": [
                            "scale", "offset", "exponent", "annualized",
                        ],
                    },
                    "reasoning": {
                        "type": "string",
                        "description": (
                            "Multi-sentence derivation. Cover: why no "
                            "preset fits, the framework reasoning behind "
                            "each BlockConfig field, and the unit-conversion "
                            "derivation from first principles. Must be at "
                            "least 40 characters, at most 2000."
                        ),
                    },
                },
                "required": [
                    "symbols", "expiries", "raw_value",
                    "block", "unit_conversion", "reasoning",
                ],
            },
        },
    },
]


_SYNTHESISER_EXT = """\

# PARAMETER SYNTHESISER (STAGE 3)

**Mandate:** Take a ``Stage 2 IntentOutput`` and emit a fully parameterised \
block. You have TWO tools available and MUST call exactly one.

## DECISION

- **Read every preset's ``when_to_use`` carefully.** If one matches the \
trader's situation, call ``select_preset`` with that preset's ``id``. \
Presets are already-reviewed artefacts — picking one is the preferred \
path.
- **Only if no preset fits**, call ``derive_custom_block`` with \
BlockConfig + UnitConversion derived from first principles. Include a \
multi-sentence ``reasoning`` that cites the framework math for each \
parameter choice. A separate critique pass will review the derivation.

## CONSTRAINTS

- Do NOT output prose. Output ONLY the tool call.
- ``raw_value`` is the trader's magnitude in the input units the preset \
(or your custom conversion) expects. For event-vol presets on an \
E[|ret|] in %, pass the trader's % value (e.g. 2.0 for "2% move"). For \
base-vol presets in %, pass the % vol value (e.g. 50 for "50 vol"). For \
decimal presets, pass the decimal value.
- ``start_timestamp`` is REQUIRED for event-vol inputs (anything with \
``event_or_ongoing: 'event'`` or ``temporal_position: 'static'``) and \
must be null for ongoing inputs.
- For ``DataStreamIntent`` inputs, call ``select_preset`` with the \
preset whose input-units match the stream's ``units_in``. Data streams \
do not carry a snapshot at creation — the server will emit \
``create_stream`` rather than ``create_manual_block`` based on the intent \
kind.
- Framework invariants are enforced by code. If you pick \
``decay_end_size_mult != 0``, you must also pick ``annualized=True``. \
Violating this raises a validation error.
- ``symbols`` and ``expiries`` MUST come from the ENGINE STATE block \
below — never emit placeholder strings like ``"<UNKNOWN>"``, ``"*"``, \
``"TBD"``, or ``"ALL"``. If the intent does not name specific \
symbols/expiries (e.g. a HeadlineIntent about BTC vol generically), \
default to every active symbol and expiry matching the intent's \
``market_variable_affected``. A BTC headline fans out across every BTC \
expiry; a vol headline with no symbol restriction fans across every \
active symbol × expiry.
- ``start_timestamp`` must be an absolute ISO 8601 string anchored to \
the CURRENT TIME block. Never use placeholder dates \
(``"2024-01-01..."``, ``"TBD"``, ``"tomorrow"``).\
"""


def build_synthesiser_prompt(
    intent_output: dict[str, Any],
    engine_state: dict[str, Any],
    user_context_section: str = "",
) -> str:
    """Assemble the Stage 3 synthesiser system prompt.

    ``intent_output`` is the Stage 2 ``IntentOutput`` serialised to dict.
    ``engine_state`` provides the active symbols + expiries so the LLM
    can fan out headline-style intents that don't name specific dims.
    The prompt includes shared framework sections plus every preset's
    ``when_to_use`` and ``framework_reasoning`` so the LLM can match on
    the trader's situation without round-tripping to the registry.
    ``user_context_section`` carries the per-user vocabulary /
    preference block — empty string when the user has no entries.
    """
    intent_json = json.dumps(intent_output, indent=2, default=str)
    symbols, expiries = extract_risk_dims(engine_state)
    dims_block = json.dumps(
        {"available_symbols": symbols, "available_expiries": expiries},
        indent=2, default=str,
    )
    return (
        f"{SHARED_CORE}\n"
        f"{user_context_section}\n"
        f"{current_time_block()}"
        f"{FRAMEWORK_DETAIL}\n"
        f"{PARAMETER_MAPPING}\n"
        f"{BLOCK_DECISION_FLOW}\n"
        f"{UNIT_CONVERSION_REFERENCE}\n"
        f"{BASE_VS_EVENT_RULES}\n"
        f"{serialize_presets_for_prompt()}\n"
        f"{_SYNTHESISER_EXT}\n\n"
        "## ENGINE STATE (active risk dimensions)\n"
        f"```json\n{dims_block}\n```\n\n"
        "## STAGE 2 INTENT\n"
        f"```json\n{intent_json}\n```\n"
    )
