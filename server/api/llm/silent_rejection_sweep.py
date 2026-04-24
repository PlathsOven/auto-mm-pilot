"""
Background coroutine that drains stale pending Build proposals into
``llm_failures`` as ``signal_type="silent_rejection"``.

Runs inside the FastAPI lifespan. Every
``silent_rejection_sweep_interval_secs`` seconds it asks
``pending_proposals.sweep_stale`` for proposals older than
``silent_rejection_threshold_secs``, then writes each as a failure row.

Crash behaviour: anything other than ``CancelledError`` is logged, we
back off for a few seconds, and the loop resumes — the sweep must never
silently die (spec acceptance criteria).
"""

from __future__ import annotations

import asyncio
import logging

from server.api.llm import pending_proposals
from server.api.llm.failures import log_failure
from server.api.llm.orchestration_config import LlmOrchestrationConfig
from server.api.llm.pending_proposals import SweepHit

log = logging.getLogger(__name__)

# Pause between a caught crash and the next iteration — keeps a
# persistently failing sweep from hot-looping against the logger / DB.
_CRASH_BACKOFF_SECS = 5.0


async def run_sweep_forever(config: LlmOrchestrationConfig) -> None:
    """Sweep loop. Exits only on ``asyncio.CancelledError`` (shutdown)."""
    while True:
        try:
            await asyncio.sleep(config.silent_rejection_sweep_interval_secs)
            hits = await pending_proposals.sweep_stale(
                threshold_secs=config.silent_rejection_threshold_secs,
            )
            for hit in hits:
                await log_silent_rejection(hit)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("silent_rejection sweep iteration crashed; backing off")
            await asyncio.sleep(_CRASH_BACKOFF_SECS)


async def log_silent_rejection(hit: SweepHit) -> None:
    """Write one ``llm_failures(signal_type="silent_rejection")`` row.

    Used by both the sweep (``reason="idle_timeout"`` hits) and the
    overflow-eviction path at register time (``reason="overflow"`` hits).
    Trigger is always ``idle_timeout`` — the Trigger enum has no
    ``overflow`` value and the spec calls for ``metadata.reason`` to
    disambiguate, not a new trigger type.
    """
    await asyncio.to_thread(
        log_failure,
        user_id=hit.user_id,
        signal_type="silent_rejection",
        trigger="idle_timeout",
        conversation_turn_id=hit.conversation_turn_id,
        metadata={"stream_name": hit.stream_name, "reason": hit.reason},
    )


__all__ = ["run_sweep_forever", "log_silent_rejection"]
