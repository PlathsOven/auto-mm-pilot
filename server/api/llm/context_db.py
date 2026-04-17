"""
Stream Context Database.

Stores descriptive metadata about each data stream the engine consumes.
This context is injected into the investigation system prompt so the LLM
can ground its reasoning in the actual data sources available, rather than
inventing jargon.

v1 multi-user: starts empty. Stream context entries will be contributed by
the client via a future API; until then the investigation LLM simply has
no descriptive context to ground on, matching the "new user = empty" spec.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict


@dataclass(frozen=True)
class StreamContext:
    """Metadata describing a single data stream the engine consumes."""

    id: str
    name: str
    category: str
    description: str
    example_impact: str
    update_frequency: str
    assets: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_store: list[StreamContext] = []


def serialize_stream_contexts() -> str:
    """Serialize all stream contexts to a JSON string for prompt injection."""
    return json.dumps(
        [asdict(s) for s in _store],
        indent=2,
    )
