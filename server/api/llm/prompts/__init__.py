"""
System prompt registry.

Each prompt module exposes a factory function that returns the
fully-interpolated system prompt string.
"""

from server.api.llm.prompts.investigation import get_investigation_prompt
from server.api.llm.prompts.justification import get_justification_prompt

__all__ = ["get_investigation_prompt", "get_justification_prompt"]
