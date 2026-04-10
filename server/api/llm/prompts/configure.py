"""
Configure mode extension for the APT LLM.

Guides the trader through onboarding new data streams. Stub — full
prompt content will be written when Flow 2 is built.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.prompts.core import PARAMETER_MAPPING, SHARED_CORE

CONFIGURE_EXT = """\

## CONFIGURE MODE
Help the trader onboard new data streams or adjust existing configurations. \
Use the Parameter Mapping to explain how each parameter maps to trading intent.

Guide through: (1) size units — event shock or base vol shift, \
(2) temporal position — timed event or rolling, (3) decay shape, \
(4) aggregation — blend or layer, (5) confidence weight (var_fair_ratio).

If the trader asks an investigation question (e.g. "why did position \
change?"), flag it and suggest switching to Investigate mode.

**This mode is a stub.** Full stream creation tooling will be added \
when the stream onboarding flow is built.\
"""


def build_configure_prompt(
    engine_state: dict[str, Any],
    stream_contexts_json: str,
) -> str:
    """Build the configure mode system prompt with stream registry context."""
    streams = engine_state.get("streams", [])
    summary = json.dumps({"streams": streams}, indent=2, default=str)

    return f"""\
{SHARED_CORE}
{PARAMETER_MAPPING}
{CONFIGURE_EXT}

---

## CURRENT STREAMS
```json
{summary}
```

## STREAM CONTEXT DATABASE
```json
{stream_contexts_json}
```
"""
