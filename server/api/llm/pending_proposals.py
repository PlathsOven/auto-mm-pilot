"""
In-memory per-user map of outstanding Build proposals.

A proposal is registered when the trader hits the Stage 4 preview; it is
resolved when the matching commit or cancel arrives; and it is drained
into ``llm_failures`` as ``signal_type="silent_rejection"`` when neither
happens within the threshold — the trader walked away.

State is process-local and lost on restart. Silent rejection is an
analytics signal, not an audit-critical record, so durability is not
worth the extra plumbing (see ``tasks/spec-silent-rejection-sweep.md``).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True, slots=True)
class PendingProposal:
    """One outstanding proposal shown to the trader."""
    created_at: datetime
    stream_name: str
    conversation_turn_id: str | None


@dataclass(frozen=True, slots=True)
class SweepHit:
    """Entry the caller should log as ``signal_type="silent_rejection"``.

    Returned from ``register`` on overflow eviction (``reason="overflow"``)
    and from ``sweep_stale`` on idle timeout (``reason="idle_timeout"``).
    Logging lives with the caller so this module stays a pure state /
    coordination primitive.
    """
    user_id: str
    stream_name: str
    conversation_turn_id: str | None
    created_at: datetime
    reason: str


# Module-level state. Keyed by user_id → ordered list of outstanding
# proposals (oldest first). A single ``asyncio.Lock`` serialises every
# mutation so register / resolve / sweep are safe against concurrent
# requests. The lock binds to the running event loop on first await,
# which matches uvicorn's single-loop model.
_pending: dict[str, list[PendingProposal]] = {}
_lock: asyncio.Lock = asyncio.Lock()


async def register(
    *,
    user_id: str,
    stream_name: str,
    conversation_turn_id: str | None,
    max_per_user: int,
) -> SweepHit | None:
    """Record a new pending proposal.

    Returns the evictee (reason ``"overflow"``) when the user's list was
    already at ``max_per_user``; caller logs it as silent_rejection.
    Otherwise returns None.
    """
    async with _lock:
        queue = _pending.setdefault(user_id, [])
        evictee: PendingProposal | None = None
        if len(queue) >= max_per_user:
            evictee = queue.pop(0)
        queue.append(PendingProposal(
            created_at=_now(),
            stream_name=stream_name,
            conversation_turn_id=conversation_turn_id,
        ))
        if evictee is None:
            return None
        return SweepHit(
            user_id=user_id,
            stream_name=evictee.stream_name,
            conversation_turn_id=evictee.conversation_turn_id,
            created_at=evictee.created_at,
            reason="overflow",
        )


async def resolve(*, user_id: str, stream_name: str) -> None:
    """Remove every pending entry matching ``(user_id, stream_name)``.

    Delete-all-matching semantics handle the (rare) case of multiple
    previews of the same stream from one user. Callers holding an
    optional stream_name (e.g. the preview_rejection path reading
    ``metadata.get("stream_name")``) must guard the call site.
    """
    async with _lock:
        queue = _pending.get(user_id)
        if not queue:
            return
        survivors = [e for e in queue if e.stream_name != stream_name]
        if survivors:
            _pending[user_id] = survivors
        else:
            del _pending[user_id]


async def sweep_stale(*, threshold_secs: int) -> list[SweepHit]:
    """Drain and return entries older than ``threshold_secs``.

    Each returned hit carries ``reason="idle_timeout"``; the caller
    writes one ``llm_failures`` row per hit. Entries are removed from
    the map before return so the next sweep doesn't double-log.
    """
    async with _lock:
        cutoff = _now() - timedelta(seconds=threshold_secs)
        hits: list[SweepHit] = []
        for user_id in list(_pending.keys()):
            queue = _pending[user_id]
            survivors: list[PendingProposal] = []
            for entry in queue:
                if entry.created_at <= cutoff:
                    hits.append(SweepHit(
                        user_id=user_id,
                        stream_name=entry.stream_name,
                        conversation_turn_id=entry.conversation_turn_id,
                        created_at=entry.created_at,
                        reason="idle_timeout",
                    ))
                else:
                    survivors.append(entry)
            if survivors:
                _pending[user_id] = survivors
            else:
                del _pending[user_id]
        return hits


def _now() -> datetime:
    # Match the rest of the orchestration layer: UTC-naive.
    return datetime.now(timezone.utc).replace(tzinfo=None)


__all__ = ["register", "resolve", "sweep_stale", "PendingProposal", "SweepHit"]
