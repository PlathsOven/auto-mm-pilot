"""
Persistence helpers for ``llm_failures``.

Every captured failure signal — detector-flagged discontent, explicit
preview rejection, post-commit edits — flows through ``log_failure``.
Fire-and-forget: the helper is invoked via ``asyncio.create_task`` from
the caller, never blocking the response path.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal

from server.api.db import SessionLocal
from server.api.llm.models import LlmFailure

log = logging.getLogger(__name__)


SignalType = Literal[
    "factual_correction",
    "discontent",
    "preview_rejection",
    "silent_rejection",
    "post_commit_edit",
]
Trigger = Literal[
    "chat_message",
    "preview_ui",
    "commit_followup",
    "idle_timeout",
]


def log_failure(
    *,
    user_id: str,
    signal_type: SignalType,
    trigger: Trigger,
    conversation_turn_id: str | None = None,
    llm_call_id: int | None = None,
    llm_output_snippet: str | None = None,
    trader_response_snippet: str | None = None,
    detector_reasoning: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert one ``llm_failures`` row — synchronous, sync ORM.

    Call via ``asyncio.to_thread`` or ``asyncio.create_task`` from async
    code to keep it off the event loop.
    """
    row = LlmFailure(
        user_id=user_id,
        conversation_turn_id=conversation_turn_id,
        llm_call_id=llm_call_id,
        signal_type=signal_type,
        trigger=trigger,
        llm_output_snippet=llm_output_snippet,
        trader_response_snippet=trader_response_snippet,
        detector_reasoning=detector_reasoning,
        metadata_json=metadata or {},
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    try:
        with SessionLocal() as sess:
            sess.add(row)
            sess.commit()
    except Exception:
        log.warning("log_failure persist failed", exc_info=True)


__all__ = ["log_failure", "SignalType", "Trigger"]
