"""Per-user tracker for silent streams — READY streams whose snapshots
carry no ``market_value`` over a threshold number of rows.

Why this exists: when a stream sends only ``raw_value`` (no market_value),
the pipeline defaults the market-implied value to match fair, which
collapses edge to zero everywhere and all desired positions read zero.
The trader sees "nothing to do" with no explanation. This store surfaces
the silent stream to the Notifications center so the cause is visible.

Design choices (mirror ``unregistered_push_store`` where sensible):

- **In-memory only.** Counters reset on server restart; the feeder will
  re-populate them on its next push. No durable storage needed.
- **One entry per stream.** Same-name pushes merge: ``rows_seen`` grows,
  ``last_seen`` advances.
- **Auto-clear on first market_value.** The moment any row with a
  non-None ``market_value`` arrives, the entry is removed — the stream
  has self-healed.
- **Threshold is user-configurable.** ``SILENT_STREAM_THRESHOLD`` (in
  ``config.py``) sets the minimum ``rows_seen`` before we surface the
  alert. Default 5 — enough to distinguish a deliberate silent stream
  from a single teething snapshot.
- **Explicit dismissal.** Same semantics as the unregistered store —
  drops the entry; subsequent silent pushes re-add it. A trader who
  genuinely wants to run without market_values can rely on the alert
  only reappearing after the next push, which is acceptable noise.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

from server.api.config import SILENT_STREAM_THRESHOLD
from server.api.user_scope import UserRegistry

log = logging.getLogger(__name__)


_MAX_ENTRIES_PER_USER = 50


@dataclass
class SilentStreamCounter:
    """Per-stream tally: how many rows ingested, when it started."""
    stream_name: str
    rows_seen: int
    first_seen: datetime
    last_seen: datetime


class SilentStreamStore:
    """Per-user LRU store of streams whose snapshots lack market_value."""

    def __init__(self) -> None:
        self._entries: dict[str, SilentStreamCounter] = {}
        self._lock = threading.Lock()

    def record(
        self,
        stream_name: str,
        rows_count: int,
        rows_with_market_value: int,
    ) -> None:
        """Update per-stream counters after a snapshot ingest.

        If any row carried a ``market_value``, the entry is cleared — the
        stream is no longer silent. Otherwise ``rows_seen`` increments by
        ``rows_count`` and ``last_seen`` advances.
        """
        if rows_count <= 0:
            return
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with self._lock:
            if rows_with_market_value > 0:
                # Self-heal: the stream is emitting market_value now.
                self._entries.pop(stream_name, None)
                return
            existing = self._entries.pop(stream_name, None)
            if existing is not None:
                existing.rows_seen += rows_count
                existing.last_seen = now
                self._entries[stream_name] = existing
                return
            if len(self._entries) >= _MAX_ENTRIES_PER_USER:
                oldest_key = next(iter(self._entries))
                self._entries.pop(oldest_key, None)
            self._entries[stream_name] = SilentStreamCounter(
                stream_name=stream_name,
                rows_seen=rows_count,
                first_seen=now,
                last_seen=now,
            )

    def list(self) -> list[SilentStreamCounter]:
        """Return every stream whose ``rows_seen`` has crossed the threshold.

        Counters below the threshold are held privately — surfacing an alert
        after a single zero-market_value snapshot would be noise.
        """
        with self._lock:
            return [
                c for c in self._entries.values()
                if c.rows_seen >= SILENT_STREAM_THRESHOLD
            ]

    def dismiss(self, stream_name: str) -> bool:
        """Drop an entry. Returns True if one was present."""
        with self._lock:
            return self._entries.pop(stream_name, None) is not None


_stores: UserRegistry[SilentStreamStore] = UserRegistry(SilentStreamStore)


def get_store(user_id: str) -> SilentStreamStore:
    """Return the per-user store (lazily constructed)."""
    return _stores.get(user_id)
