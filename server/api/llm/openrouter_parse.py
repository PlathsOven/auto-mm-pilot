"""
OpenRouter response parsing helpers.

Every LLM-facing module pulls ``choices[0].message.content`` and
``choices[0].message.tool_calls`` out of the same JSON shape; these
helpers own that pattern so callers never re-invent it.
"""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE_RE = re.compile(r"^```[a-zA-Z0-9_]*\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def strip_markdown_fences(text: str) -> str:
    """Remove leading/trailing markdown code fences if the model wrapped output."""
    match = _FENCE_RE.match(text.strip())
    if match:
        return match.group(1).strip()
    return text.strip()


def get_content(resp: dict[str, Any]) -> str:
    """Pull ``choices[0].message.content`` out of an OpenRouter response."""
    choice = (resp.get("choices") or [{}])[0]
    return (choice.get("message") or {}).get("content") or ""


def get_tool_call(resp: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Pull the first tool call out of an OpenRouter function-call response.

    Returns ``(tool_name, parsed_args)``. Raises ``ValueError`` if the
    response has no tool calls or arguments fail to parse.
    """
    choice = (resp.get("choices") or [{}])[0]
    calls = (choice.get("message") or {}).get("tool_calls") or []
    if not calls:
        raise ValueError("response carried no tool_calls")
    fn = calls[0].get("function") or {}
    name = fn.get("name") or ""
    raw = fn.get("arguments") or "{}"
    if isinstance(raw, str):
        try:
            args = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"tool call arguments parse failed: {exc}") from exc
    elif isinstance(raw, dict):
        args = raw
    else:
        raise ValueError(f"unexpected tool_calls arguments type: {type(raw)!r}")
    return name, args


def parse_json_content(resp: dict[str, Any]) -> dict[str, Any]:
    """Extract ``message.content``, strip fences, parse as JSON.

    Tolerates trailing prose after the JSON body — some models leak
    explanations despite ``response_format=json_object``. Uses
    ``raw_decode`` to take the first valid JSON object and ignore the
    tail. Raises ``json.JSONDecodeError`` only if no valid JSON prefix
    exists; callers wrap as their own stage error.
    """
    cleaned = strip_markdown_fences(get_content(resp))
    obj, _end = json.JSONDecoder().raw_decode(cleaned)
    if not isinstance(obj, dict):
        raise json.JSONDecodeError(
            f"expected JSON object, got {type(obj).__name__}", cleaned, 0,
        )
    return obj
