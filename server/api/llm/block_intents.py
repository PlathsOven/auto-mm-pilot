"""
Persistence helpers for ``block_intents``.

Every successful Stage-5 commit writes one row here — it binds a created
stream to the trader's original phrasing + the Stage-1→4 trace. The
Inspector surface reads via ``get_for_stream`` to answer "why does this
block exist?" in the trader's own words.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from server.api.db import SessionLocal
from server.api.llm.models import BlockIntent
from server.api.models import StoredBlockIntent

log = logging.getLogger(__name__)


def save_block_intent(intent: StoredBlockIntent) -> None:
    """Insert one ``block_intents`` row.

    Raises on persistence failure so the commit handler can surface the
    error to the trader — the row is part of the committed block's
    identity, not an optional audit tail.
    """
    # Denormalise the preset_id + custom reasoning so analytics can query
    # "which presets are most popular" without unpacking JSON every time.
    preset_id: str | None = None
    custom_reasoning: str | None = None
    choice = intent.synthesis.choice
    if choice.mode == "preset":
        preset_id = choice.preset_id
    elif choice.mode == "custom":
        custom_reasoning = choice.reasoning

    row = BlockIntent(
        id=intent.id,
        user_id=intent.user_id,
        stream_name=intent.stream_name,
        action=intent.action,
        original_phrasing=intent.original_phrasing,
        intent_output=intent.intent.model_dump(mode="json"),
        synthesis_output=intent.synthesis.model_dump(mode="json"),
        preview_response=intent.preview.model_dump(mode="json"),
        preset_id=preset_id,
        custom_derivation_reasoning=custom_reasoning,
        created_at=intent.created_at,
    )
    with SessionLocal() as sess:
        sess.add(row)
        sess.commit()


def get_for_stream(user_id: str, stream_name: str) -> StoredBlockIntent | None:
    """Return the stored intent for a stream, or None if there isn't one.

    Streams created before M3 (or via paths other than the Build
    orchestrator, e.g. the ``+ Manual block`` drawer) have no row — the
    caller should surface a "no intent recorded" placeholder.
    """
    with SessionLocal() as sess:
        row = sess.execute(
            select(BlockIntent).where(
                BlockIntent.user_id == user_id,
                BlockIntent.stream_name == stream_name,
            )
        ).scalar_one_or_none()
    if row is None:
        return None
    return _row_to_model(row)


def recent_intent_id(
    user_id: str,
    stream_name: str,
    threshold_secs: int,
) -> str | None:
    """Return the BlockIntent id if the stream was created within ``threshold_secs``.

    Powers post-commit-edit detection: PATCH/DELETE on a block created
    very recently is most likely a correction of the original proposal
    rather than a response to new information. The caller turns a
    non-null return into a ``post_commit_edit`` failure row.
    """
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=threshold_secs)
    with SessionLocal() as sess:
        row = sess.execute(
            select(BlockIntent).where(
                BlockIntent.user_id == user_id,
                BlockIntent.stream_name == stream_name,
                BlockIntent.created_at >= cutoff,
            )
        ).scalar_one_or_none()
    return row.id if row is not None else None


def _row_to_model(row: BlockIntent) -> StoredBlockIntent:
    """Rehydrate the Pydantic ``StoredBlockIntent`` from an ORM row."""
    from server.api.models import IntentOutput, PreviewResponse, SynthesisOutput
    return StoredBlockIntent(
        id=row.id,
        user_id=row.user_id,
        stream_name=row.stream_name,
        action=row.action,  # type: ignore[arg-type]
        original_phrasing=row.original_phrasing,
        intent=IntentOutput(**row.intent_output),
        synthesis=SynthesisOutput(**row.synthesis_output),
        preview=PreviewResponse(**row.preview_response),
        created_at=row.created_at,
    )


__all__ = ["save_block_intent", "get_for_stream", "recent_intent_id"]
