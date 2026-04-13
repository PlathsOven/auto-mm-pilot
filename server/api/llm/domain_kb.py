"""
Domain knowledge base — persistent store of trader corrections.

Reads/writes a JSON file on disk. Corrections captured by the background
detector accumulate here and are injected into every LLM system prompt
so the same domain mistake is never repeated.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_KB_PATH = Path(__file__).resolve().parent / "domain_kb.json"


def load_kb() -> list[dict[str, Any]]:
    """Load all KB entries from disk. Returns [] on missing/corrupt file."""
    try:
        return json.loads(_KB_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        log.warning("domain_kb.json load failed (%s) — returning empty KB", exc)
        return []


def save_entry(entry: dict[str, Any]) -> None:
    """Append a single entry to the KB file."""
    kb = load_kb()
    kb.append(entry)
    _KB_PATH.write_text(
        json.dumps(kb, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    log.info("Domain KB: saved correction on topic %r", entry.get("topic", "?"))


def serialize_kb_section() -> str:
    """Format all KB entries into a prompt section string.

    Returns an empty string if the KB is empty, so callers can
    unconditionally append the result without adding blank sections.
    """
    kb = load_kb()
    if not kb:
        return ""

    lines = ["\n---\n\n## DOMAIN KNOWLEDGE\n"]
    lines.append(
        "The following corrections were provided by the trading desk. "
        "Treat each as ground truth — never contradict them.\n"
    )
    for entry in kb:
        topic = entry.get("topic", "unknown")
        misconception = entry.get("misconception", "")
        correct = entry.get("correct_fact", "")
        why = entry.get("why_it_matters", "")
        lines.append(f"### {topic}")
        if misconception:
            lines.append(f"**Common misconception:** {misconception}")
        lines.append(f"**Correct:** {correct}")
        if why:
            lines.append(f"**Why it matters:** {why}")
        lines.append("")  # blank line between entries

    return "\n".join(lines)
