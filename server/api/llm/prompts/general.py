"""
General mode extension for the Posit LLM.

Catch-all conversational mode. Receives a minimal engine summary (positions
only, no pipeline detail) and handles factual questions, casual remarks,
and intent-mismatch detection.
"""

from __future__ import annotations

import json
from typing import Any

from server.api.llm.prompts.core import MODE_DIRECTORY, SHARED_CORE

GENERAL_EXT = """\

## GENERAL MODE
You are in **general** mode. Answer factual questions about the Posit \
framework, the desk's current desired positions, or general trading \
concepts. Keep answers concise — 1-3 sentences for simple questions.

You do NOT have detailed pipeline breakdowns or per-stream calculation \
snapshots in this mode. If the trader asks a question that requires \
pipeline-level detail (e.g. "why did BTC position change?"), flag it: \
"That needs the full pipeline context — switch to Investigate mode for \
a grounded answer."

For casual messages (acknowledgements, remarks), respond naturally and \
briefly.\
"""


def build_general_prompt(
    engine_state: dict[str, Any],
    user_context_section: str = "",
) -> str:
    """Build the general mode system prompt with minimal engine summary."""
    # Inject only positions — no pipeline detail, no stream contexts
    positions = engine_state.get("positions", [])
    summary = json.dumps({"positions": positions}, indent=2, default=str)

    return f"""\
{SHARED_CORE}
{user_context_section}
{MODE_DIRECTORY}
{GENERAL_EXT}

---

## CURRENT DESIRED POSITIONS (SUMMARY)
```json
{summary}
```
"""
