"""
Stage 3.5 — Critique prompt for custom derivations.

Runs ONLY when Stage 3 emitted ``derive_custom_block``. A fresh LLM
call reviews whether the LLM-authored BlockConfig + UnitConversion
actually encodes the trader's intent. Output is a
``CustomDerivationCritique`` JSON object (passes / concerns /
suggested_alternative_preset_id).

The prompt is intentionally isolated — it does NOT import SHARED_CORE
or the general framework sections. It needs only the invariants,
preset catalogue, and the two artefacts (intent + derivation) under
review. Isolation guards against accidental cross-contamination from
the synthesiser's prompt context.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.parameter_presets import serialize_presets_for_prompt

CRITIQUE_SYSTEM_PROMPT = f"""\
# CUSTOM DERIVATION CRITIQUE (STAGE 3.5)

**Mandate:** Review the LLM-authored BlockConfig + UnitConversion \
below. Your job is to spot errors the synthesiser missed. Be sharp — \
a false-pass here reaches the trader as a bad proposal.

## FRAMEWORK INVARIANTS TO VERIFY

1. **Variance units.** The unit_conversion must produce variance (σ²), \
not vol (σ) and not raw returns. If ``raw_value`` is in percent and the \
derivation has ``scale=0.01, exponent=1``, that's vol — wrong. Squaring \
(``exponent=2``) is required to land in variance.

2. **Half-normal identity for E[|ret|].** If the trader gave an \
expected absolute move (percent or decimal), ``scale`` must include \
``sqrt(pi/2)`` (≈1.2533). Decimal input: scale ≈ 1.2533. Percent input: \
scale ≈ 0.01253. Exponent = 2 either way.

3. **Temporal classification.** Event-vol inputs (a specific release \
time, bounded event) need ``temporal_position='static'``, \
``annualized=False``, ``decay_end_size_mult=0.0``. Base-vol / ongoing \
inputs need ``temporal_position='shifting'``, ``annualized=True``, \
``decay_end_size_mult=1.0``.

4. **Decay rate reasonableness.** Event vol typically decays 0.03/min \
(~30 min half-life for macro events like FOMC / CPI), 0.005/min (~3 hr \
for protocol upgrades), or 0.05/min (~15 min for flash events). A \
decay rate of 0 on an event-vol block is a bug — the event would never \
resolve.

5. **BlockConfig invariants.** ``decay_end_size_mult != 0`` requires \
``annualized=True``. Any other combination is a validation error.

6. **Preset avoidance.** If the derivation's parameters exactly match \
an existing preset's shape (same annualized, temporal_position, \
decay_*, unit_conversion), the synthesiser should have called \
``select_preset`` instead. Flag this with \
``suggested_alternative_preset_id`` set to the preset's id.

{serialize_presets_for_prompt()}

## OUTPUT

Return ONLY a JSON object, no markdown, no prose, no code fences:

{{
  "passes": <true|false>,
  "concerns": ["<concrete issue>", "<concrete issue>", ...],
  "suggested_alternative_preset_id": "<preset_id | null>"
}}

``passes=true`` requires ``concerns=[]``. If you list any concern, \
``passes`` MUST be false.\
"""


def build_critique_user_message(
    intent_output: dict[str, Any],
    custom_derivation: dict[str, Any],
) -> str:
    """Compose the user-role message carrying the artefacts under review."""
    return (
        "## STAGE 2 INTENT\n"
        f"```json\n{json.dumps(intent_output, indent=2, default=str)}\n```\n\n"
        "## STAGE 3 CUSTOM DERIVATION (UNDER REVIEW)\n"
        f"```json\n{json.dumps(custom_derivation, indent=2, default=str)}\n```\n"
    )
