"""
System prompt registry.

Provides ``build_system_prompt(mode, ...)`` which composes the correct
shared-core + mode-extension + dynamic-data prompt for a given chat mode.

Build mode does NOT go through this dispatcher anymore — it runs through
the five-stage orchestrator at ``/api/build/converse`` (see
``server/api/llm/build_orchestrator.py``). The dispatcher now serves only
Investigate and General, which remain single-shot streaming chats.
"""

from __future__ import annotations

from typing import Any

from server.api.models import ChatMode
from server.api.llm.domain_kb import serialize_kb_section
from server.api.llm.prompts.general import build_general_prompt
from server.api.llm.prompts.investigation import build_investigation_prompt


def build_system_prompt(
    mode: ChatMode,
    *,
    engine_state: dict[str, Any],
    stream_contexts_json: str = "[]",
    pipeline_snapshot: dict[str, Any] | None = None,
    history_context: str | None = None,
    user_context_section: str = "",
) -> str:
    """
    Compose a system prompt for the given chat mode.

    - investigate: engine state, stream contexts, pipeline snapshot, history
    - general:     engine state (positions summary only)
    - build:       not routed here — Build uses ``/api/build/converse``

    ``user_context_section`` is the per-user vocabulary / preferences
    block from ``server/api/llm/user_context.serialize_for_prompt`` —
    injected after SHARED_CORE in every mode's prompt.
    """
    if mode == "investigate":
        base = build_investigation_prompt(
            engine_state, stream_contexts_json, pipeline_snapshot,
            history_context, user_context_section=user_context_section,
        )
    else:
        # general (default fallback)
        base = build_general_prompt(
            engine_state, user_context_section=user_context_section,
        )

    # Append accumulated domain knowledge to every mode
    return base + serialize_kb_section()


__all__ = [
    "ChatMode",
    "build_system_prompt",
]
