"""
Per-user context: vocabulary + preferences the LLM has observed.

Every mode's prompt reads this and injects a ``USER CONTEXT`` section
so personalisation survives across sessions. The detector writes here
on every preference signal via ``upsert_entry``.

Spec §9.3.1 controlled key vocabulary:
- magnitude_vocabulary         {"phrase": "unit", …}
- confidence_language          {"phrase": "level", …}
- typical_expiries_of_interest ["YYYY-MM-DD", …]
- typical_symbols_of_interest  ["BTC", "ETH", …]
- preferred_decay_rates        {"event_type": rate, …}
- calibration_notes            ["free-text observation", …]
- framework_mastery_level      "novice" | "intermediate" | "expert"
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from server.api.db import SessionLocal
from server.api.llm.models import UserContextEntry

log = logging.getLogger(__name__)


# Keys the detector is allowed to write. Any key outside this set is
# rejected — keeps the prompt-injection layer bounded.
CONTROLLED_KEYS: frozenset[str] = frozenset({
    "magnitude_vocabulary",
    "confidence_language",
    "typical_expiries_of_interest",
    "typical_symbols_of_interest",
    "preferred_decay_rates",
    "calibration_notes",
    "framework_mastery_level",
})


_MASTERY_LEVELS = frozenset({"novice", "intermediate", "expert"})


def _value_matches_key(key: str, value: Any) -> bool:
    """Check that ``value`` matches the shape specified in spec §9.3.1.

    Defensive: a malformed detector response (e.g. wrong type in
    ``magnitude_vocabulary.value``) would otherwise poison the prompt
    injection layer or blow up downstream consumers. Unknown keys are
    already rejected at the ``CONTROLLED_KEYS`` gate.
    """
    if key in (
        "magnitude_vocabulary", "confidence_language", "preferred_decay_rates",
    ):
        # dict[str, <scalar>] — every key a string; every value anything
        # JSON-serialisable (string / number / bool).
        return (
            isinstance(value, dict)
            and all(isinstance(k, str) for k in value.keys())
        )
    if key in (
        "typical_expiries_of_interest", "typical_symbols_of_interest",
        "calibration_notes",
    ):
        return isinstance(value, list) and all(isinstance(v, str) for v in value)
    if key == "framework_mastery_level":
        return value in _MASTERY_LEVELS
    return False

# Display order in the prompt — broad personality signals first, then
# specific vocab / patterns. Stable so the same user sees the same
# section shape across every turn.
_PROMPT_KEY_ORDER: tuple[str, ...] = (
    "framework_mastery_level",
    "typical_symbols_of_interest",
    "typical_expiries_of_interest",
    "magnitude_vocabulary",
    "confidence_language",
    "preferred_decay_rates",
    "calibration_notes",
)


def get_entries(user_id: str) -> list[UserContextEntry]:
    """Return every entry for ``user_id`` — no filtering or pagination."""
    with SessionLocal() as sess:
        rows = sess.execute(
            select(UserContextEntry).where(UserContextEntry.user_id == user_id)
        ).scalars().all()
        sess.expunge_all()
    return list(rows)


def upsert_entry(
    *,
    user_id: str,
    key: str,
    value: Any,
    reasoning: str | None,
) -> None:
    """Insert-or-update one ``(user_id, key)`` row.

    On conflict: refine ``value`` to the newer observation, increment
    ``observation_count``, advance ``updated_at``. ``reasoning`` is
    replaced (most recent wins — quick to read in analytics).
    """
    if key not in CONTROLLED_KEYS:
        log.warning("upsert_entry rejected unknown key: %s", key)
        return
    if not _value_matches_key(key, value):
        log.warning(
            "upsert_entry rejected malformed value for key=%s: %r", key, value,
        )
        return
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        with SessionLocal() as sess:
            existing = sess.execute(
                select(UserContextEntry).where(
                    UserContextEntry.user_id == user_id,
                    UserContextEntry.key == key,
                )
            ).scalar_one_or_none()
            if existing is None:
                sess.add(UserContextEntry(
                    user_id=user_id,
                    key=key,
                    value=value,
                    reasoning=reasoning,
                    first_observed_at=now,
                    updated_at=now,
                    observation_count=1,
                ))
            else:
                existing.value = value
                existing.reasoning = reasoning
                existing.updated_at = now
                existing.observation_count = existing.observation_count + 1
            sess.commit()
    except Exception:
        log.warning("upsert_entry persist failed", exc_info=True)


def serialize_for_prompt(user_id: str) -> str:
    """Build the ``USER CONTEXT`` prompt section for ``user_id``.

    Returns an empty string when the user has no entries yet — callers
    pass the result through to the prompt builder without conditionals.
    """
    entries = {e.key: e for e in get_entries(user_id)}
    if not entries:
        return ""

    lines: list[str] = ["", "## USER CONTEXT", ""]
    for key in _PROMPT_KEY_ORDER:
        e = entries.get(key)
        if e is None:
            continue
        lines.append(f"- **{key}:** {_format_value(e.value)}")
    lines.append("")
    return "\n".join(lines)


def _format_value(value: Any) -> str:
    """Compact value formatting for prompt injection."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(isinstance(v, str) for v in value):
            return ", ".join(value)
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = ", ".join(f"{k}={v!r}" for k, v in value.items())
        return items
    return json.dumps(value, default=str)


__all__ = ["get_entries", "upsert_entry", "serialize_for_prompt", "CONTROLLED_KEYS"]
