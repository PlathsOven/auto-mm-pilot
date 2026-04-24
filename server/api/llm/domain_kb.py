"""
Domain knowledge base — per-user store of trader corrections.

The feedback detector writes factual corrections here; every LLM call's
system prompt reads the calling user's entries and injects them as a
``## DOMAIN KNOWLEDGE`` section so the same mistake is never repeated
for that trader. Per-user scoping: what one trader teaches the LLM does
not leak into another trader's prompts.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from server.api.db import SessionLocal
from server.api.llm.models import DomainKbEntry

log = logging.getLogger(__name__)


def save_entry(user_id: str, entry: dict[str, Any]) -> None:
    """Insert-or-update one ``(user_id, topic)`` row.

    On conflict: refine ``correct_fact`` / ``why_it_matters`` /
    ``misconception`` to the newer observation and advance ``created_at``.
    Same-trader refinement — latest observation wins.
    """
    topic = entry.get("topic", "unknown")
    misconception = entry.get("misconception", "") or ""
    correct_fact = entry.get("correct_fact", "") or ""
    why_it_matters = entry.get("why_it_matters", "") or ""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        with SessionLocal() as sess:
            existing = sess.execute(
                select(DomainKbEntry).where(
                    DomainKbEntry.user_id == user_id,
                    DomainKbEntry.topic == topic,
                )
            ).scalar_one_or_none()
            if existing is None:
                sess.add(DomainKbEntry(
                    user_id=user_id,
                    topic=topic,
                    misconception=misconception,
                    correct_fact=correct_fact,
                    why_it_matters=why_it_matters,
                    created_at=now,
                ))
            else:
                existing.misconception = misconception
                existing.correct_fact = correct_fact
                existing.why_it_matters = why_it_matters
                existing.created_at = now
            sess.commit()
        log.info("Domain KB: saved correction on topic %r for user %s", topic, user_id)
    except Exception:
        log.warning("domain_kb save failed", exc_info=True)


def serialize_kb_section(user_id: str) -> str:
    """Build the ``## DOMAIN KNOWLEDGE`` prompt section for ``user_id``.

    Returns an empty string when the user has no corrections yet — callers
    pass the result through to the prompt builder without conditionals.
    """
    with SessionLocal() as sess:
        rows = sess.execute(
            select(DomainKbEntry)
            .where(DomainKbEntry.user_id == user_id)
            .order_by(DomainKbEntry.created_at)
        ).scalars().all()
        sess.expunge_all()

    if not rows:
        return ""

    lines = ["\n---\n\n## DOMAIN KNOWLEDGE\n"]
    lines.append(
        "The following corrections were provided by the trading desk. "
        "Treat each as ground truth — never contradict them.\n"
    )
    for row in rows:
        lines.append(f"### {row.topic}")
        if row.misconception:
            lines.append(f"**Common misconception:** {row.misconception}")
        lines.append(f"**Correct:** {row.correct_fact}")
        if row.why_it_matters:
            lines.append(f"**Why it matters:** {row.why_it_matters}")
        lines.append("")  # blank line between entries

    return "\n".join(lines)


__all__ = ["save_entry", "serialize_kb_section"]
