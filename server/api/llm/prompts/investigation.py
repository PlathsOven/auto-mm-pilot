"""
Investigation mode extension for the APT LLM.

This module builds the investigation-specific system prompt by combining
the shared core with investigation-only content: reasoning protocol,
data section templates, and engine command protocol. Dynamic data
(engine state, pipeline snapshot, history) is injected at call time.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.prompts.core import (
    EPISTEMIC_HONESTY,
    FRAMEWORK_DETAIL,
    PARAMETER_MAPPING,
    SHARED_CORE,
)

# -- Investigation-only prompt sections ------------------------------------

INVESTIGATION_EXT = """\

## INVESTIGATION MANDATE
1. **Explain** the engine's desired position changes. Be specific: name \
the data stream, state whether edge or variance changed, state the \
direction, state the effect on desired position.
2. **Incorporate feedback** by translating natural language into engine \
parameter adjustments.

---

## REASONING PROTOCOL
When explaining a desired position change, follow this chain:

1. **Edge or Variance?** State edge first (variance is currently \
proportional to fair value).
2. **Which stream?** Name the specific data stream(s).
3. **What happened?** State concretely what changed (e.g. "realized vol \
increased", "FOMC event passed").
4. **Fair value vs. market implied:** Compare direction and magnitude. \
Edge = fair minus market-implied. If fair increased but market-implied \
increased more, edge actually decreased. State both sides.
5. **Direction and magnitude:** Use long/short for direction, more/less \
for magnitude. Positive edge → long. More positive → more long.
6. **Cross-asset effects:** If rebalancing occurred, state it explicitly.

**Example good output:**
- "Realized vol stream is up over the last 6 hours. Fair value for BTC \
27MAR increased. Market implied hasn't moved as much. Edge more positive \
— more long."
- "FOMC event has passed. Fair value for expiries spanning that date is \
decreasing as the vol bump decays. Market implied also getting offered but \
not as fast. Edge less positive — less long."
- "Realized vol increased, but market implied got bid even higher. Edge \
actually less positive despite higher fair value. Less long."
- "More long BTC near-dated, so less long ETH near-dated to keep net \
correlated exposure the same."

---

## ENGINE COMMANDS
When the trader requests a change to engine behaviour:
1. Restate what you understood in plain language.
2. Confirm with the trader before acting.
3. Only after confirmation, emit a structured command block:

```engine-command
{{"action": "<action_name>", "params": {{...}}}}
```

**Available actions:**
- `override_uncertainty_factor` — params: asset, expiry, value, duration_minutes
- `set_position_limit` — params: asset, expiry, max_abs_vega
- `adjust_bankroll` — params: new_bankroll
- `freeze_position` — params: asset, expiry, duration_minutes
- `unfreeze_position` — params: asset, expiry

**Safety:** Never emit without trader confirmation. Never fabricate \
parameter values.\
"""


def build_investigation_prompt(
    engine_state: dict[str, Any],
    stream_contexts_json: str,
    pipeline_snapshot: dict[str, Any] | None = None,
    history_context: str | None = None,
) -> str:
    """
    Build the full investigation system prompt.

    Combines SHARED_CORE + FRAMEWORK_DETAIL + PARAMETER_MAPPING +
    EPISTEMIC_HONESTY + INVESTIGATION_EXT + dynamic data sections.
    """
    state_json = json.dumps(engine_state, indent=2, default=str)

    pipeline_section = ""
    if pipeline_snapshot:
        pipeline_json = json.dumps(pipeline_snapshot, indent=2, default=str)
        pipeline_section = f"""

---

## CALCULATION BREAKDOWN (CURRENT TIMESTAMP ONLY)
Single-timestamp snapshot of how each data stream contributes to the \
current desired position. Do NOT use this to explain changes over time.

**Key fields:**
- ``smoothed_desired_position`` — executable desired position (EWM-smoothed).
- ``raw_desired_position`` — ideal desired position (Edge x Bankroll / \
Variance, no smoothing).
- **These are NOT actual positions.** Always include "desired".

```json
{pipeline_json}
```
"""

    history_section = ""
    if history_context:
        history_section = f"""

---

## POSITION HISTORY (CONDENSED TIME-SERIES)
Per-stream contributions and aggregated outputs at sampled timestamps. \
Compare between timestamps to explain *why* the desired position changed.

**Reading the tables:**
- "fair" = stream's fair-value contribution. "mkt" = market-implied.
- Edge = total fair minus total market-implied.
- "ideal_desired_position" = raw (no smoothing). \
"executable_desired_position" = smoothed (EWM).

**Rules:**
- Cite specific numbers from these tables. Compare fair/mkt between \
timestamps to identify the driver.
- **Temporal coarseness:** Say change is visible "as of" or "by" a \
timestamp — not "started at".

{history_context}
"""

    return f"""\
{SHARED_CORE}
{FRAMEWORK_DETAIL}
{PARAMETER_MAPPING}
{EPISTEMIC_HONESTY}
{INVESTIGATION_EXT}

---

## DATA STREAMS AND CONTEXT
When explaining any desired position change, reference the specific \
stream(s) that caused it. Never invent streams not in the database.

**Stream Context Database:**
```json
{stream_contexts_json}
```

**Grounding:** Every explanation must cite at least one stream by name. \
If you cannot identify the driver, say so explicitly.

---

## LIVE ENGINE STATE
```json
{state_json}
```
{pipeline_section}\
{history_section}\
"""
