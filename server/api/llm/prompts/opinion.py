"""
Opinion mode extension for the APT LLM.

Helps the trader translate discretionary views into manual blocks.
Stub — full prompt content will be written when Flow 3 is built.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.prompts.core import PARAMETER_MAPPING, SHARED_CORE

OPINION_EXT = """\

## OPINION MODE
Help the trader translate a discretionary view into a manual block.

Walk through: (1) what is the view, (2) magnitude, (3) time window — \
event-anchored or rolling, (4) confidence (var_fair_ratio), (5) decay.

Summarise the manual block parameters and confirm before creating.

If the trader asks an investigation question, flag it and suggest \
switching to Investigate mode.

**This mode is a stub.** Full block creation tooling will be added \
when the opinion registration flow is built.\
"""


def build_opinion_prompt(
    engine_state: dict[str, Any],
    stream_contexts_json: str,
) -> str:
    """Build the opinion mode system prompt with position + stream context."""
    positions = engine_state.get("positions", [])
    summary = json.dumps({"positions": positions}, indent=2, default=str)

    return f"""\
{SHARED_CORE}
{PARAMETER_MAPPING}
{OPINION_EXT}

---

## CURRENT DESIRED POSITIONS
```json
{summary}
```

## STREAM CONTEXT DATABASE
```json
{stream_contexts_json}
```
"""
