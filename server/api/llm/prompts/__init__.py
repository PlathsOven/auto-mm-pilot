"""
System prompt registry.

Provides ``build_system_prompt(mode, ...)`` which composes the correct
shared-core + mode-extension + dynamic-data prompt for a given chat mode.
"""

from __future__ import annotations

from typing import Any

from server.api.models import ChatMode
from server.api.llm.prompts.configure import build_configure_prompt
from server.api.llm.prompts.general import build_general_prompt
from server.api.llm.prompts.investigation import build_investigation_prompt
from server.api.llm.prompts.opinion import build_opinion_prompt


def build_system_prompt(
    mode: ChatMode,
    *,
    engine_state: dict[str, Any],
    stream_contexts_json: str = "[]",
    pipeline_snapshot: dict[str, Any] | None = None,
    history_context: str | None = None,
) -> str:
    """
    Compose a system prompt for the given chat mode.

    Each mode receives only the data it needs:
    - investigate: engine state, stream contexts, pipeline snapshot, history
    - configure:   engine state, stream contexts
    - opinion:     engine state, stream contexts
    - general:     engine state (positions summary only)
    """
    if mode == "investigate":
        return build_investigation_prompt(
            engine_state, stream_contexts_json, pipeline_snapshot, history_context,
        )
    if mode == "configure":
        return build_configure_prompt(engine_state, stream_contexts_json)
    if mode == "opinion":
        return build_opinion_prompt(engine_state, stream_contexts_json)
    # general (default fallback)
    return build_general_prompt(engine_state)


__all__ = [
    "ChatMode",
    "build_system_prompt",
]
