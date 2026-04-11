"""
Opinion mode extension for the APT LLM.

Helps the trader translate discretionary views into manual blocks.
Imports shared decision flow, conversion reference, and classification
rules from core.py — OPINION_EXT adds only opinion-specific delta.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.prompts.core import (
    BASE_VS_EVENT_RULES,
    BLOCK_DECISION_FLOW,
    MODE_DIRECTORY,
    PARAMETER_MAPPING,
    SHARED_CORE,
    UNIT_CONVERSION_REFERENCE,
    extract_risk_dims,
)

OPINION_EXT = """\

## OPINION MODE

**Mandate:** Translate a trader's discretionary view into a manual block. \
Follow the BLOCK DECISION FLOW. After confirming all parameters with the \
trader, emit a `create_manual_block` engine-command.

---

### Opinion Entry Point

The conversation starts with the trader's view. Listen for clues about \
base vs event in their initial statement before entering the decision \
flow. If they have already specified symbol, expiry, or magnitude in \
their opening message, acknowledge what you have and skip those steps.

**Conversation continuity:** The trader may have stated their view in a \
previous mode (e.g., General) and then switched to Opinion mode. If the \
latest message is a short acknowledgement ("ok", "yes", "done", "switched") \
rather than a new opinion, scan the conversation history for the original \
view. Extract symbol, direction, magnitude, and any other clues, then \
confirm what you found before entering the decision flow. Example: \
"I see from earlier that you think BTC will realise higher — let me \
help turn that into a block. Which expiry are you thinking of?"

Ask batched questions when answers are independent (e.g., symbol + \
expiry together). Ask sequential questions when one answer determines \
the next (e.g., event vs base determines which follow-up questions \
to ask).

---

### Multi-Expiry Handling

A single opinion can apply to multiple expiries. Construct one snapshot \
row per (symbol, expiry) combination. All rows share the same \
`raw_value` and block config unless the trader specifies different \
magnitudes per expiry.

---

### Conflict Detection

Before emitting the command, check existing blocks in the engine state. \
If a manual block already exists for overlapping symbol/expiry, warn:

"There is already a manual block [name] covering [symbol] [expiry]. \
Creating another will stack additively (if offset) or blend (if \
average). Want to proceed, or update the existing one?"

---

### Engine-Command Format

After the trader confirms all parameters, emit this fenced code block \
exactly (the opening fence MUST be ` ```engine-command ` with no space \
before `engine-command`):

```engine-command
{
  "action": "create_manual_block",
  "params": {
    "stream_name": "<descriptive_name>",
    "key_cols": ["symbol", "expiry"],
    "scale": <float>,
    "offset": <float>,
    "exponent": <float>,
    "block": {
      "annualized": <bool>,
      "size_type": "fixed",
      "aggregation_logic": "<average|offset>",
      "temporal_position": "<static|shifting>",
      "decay_end_size_mult": <float>,
      "decay_rate_prop_per_min": <float>,
      "var_fair_ratio": <float>
    },
    "snapshot_rows": [
      {
        "timestamp": "<ISO 8601 now>",
        "symbol": "<symbol>",
        "expiry": "<ISO 8601>",
        "raw_value": <float>,
        "start_timestamp": "<ISO 8601, event vol only>"
      }
    ]
  }
}
```

**Naming convention:** `stream_name` = \
`opinion_<topic>_<symbol>_<YYYYMMDD>` (e.g., \
`opinion_fomc_btc_20260115`, `opinion_base_vol_eth_20260410`).

---

### Worked Examples

**Example 1 — Event vol:**
> Trader: "I think the FOMC is going to be an upset"
> LLM: "Which symbol and expiry? [presents available from engine state]. \
What absolute % move in BTC do you expect on average? When is the FOMC \
announcement? How quickly do you think the market will price in the \
result — within 30 minutes, an hour, or longer?"
> After confirmation → engine-command with:
> scale = √(π/2)/100 ≈ 0.01253, exponent = 2, offset = 0, \
annualized = false, aggregation_logic = "offset", \
temporal_position = "static", decay_end_size_mult = 0.0, \
decay_rate_prop_per_min = 0.03, start_timestamp = FOMC time

**Example 2 — Base vol:**
> Trader: "I think vols will get bid to 50"
> LLM: "Which symbol and expiry? [presents available from engine state]"
> After confirmation → engine-command with:
> scale = 0.01, exponent = 2, offset = 0, annualized = true, \
aggregation_logic = "average", temporal_position = "shifting", \
decay_end_size_mult = 1.0, decay_rate_prop_per_min = 0.0\
"""


def build_opinion_prompt(
    engine_state: dict[str, Any],
    stream_contexts_json: str,
) -> str:
    """Build the opinion mode system prompt with position + stream context."""
    positions = engine_state.get("positions", [])
    streams = engine_state.get("streams", [])
    symbols, expiries = extract_risk_dims(engine_state)

    dynamic = json.dumps(
        {
            "positions": positions,
            "existing_streams": streams,
            "available_symbols": symbols,
            "available_expiries": expiries,
        },
        indent=2,
        default=str,
    )

    return f"""\
{SHARED_CORE}
{MODE_DIRECTORY}
{PARAMETER_MAPPING}
{BLOCK_DECISION_FLOW}
{UNIT_CONVERSION_REFERENCE}
{BASE_VS_EVENT_RULES}
{OPINION_EXT}

---

## ENGINE STATE
```json
{dynamic}
```

## STREAM CONTEXT DATABASE
```json
{stream_contexts_json}
```
"""
