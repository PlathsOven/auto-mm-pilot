"""Per-user buffer of unregistered-stream push attempts.

When a caller (SDK or raw HTTP) pushes a snapshot to a ``stream_name`` that
does not exist in this user's registry, we store the attempt here so the
UI can surface a notification that deep-links into Anatomy with a
pre-filled stream form — instead of just rejecting with 409 and forcing
the operator to dig through server logs to find out *which* stream name
the feeder expects.

Design choices:

- **In-memory only.** Entries do not persist across server restarts. The
  feeder will trigger the same buffer fill again on its next push, so we
  don't need durable storage here.
- **LRU-capped per user.** ``_MAX_ENTRIES_PER_USER`` bounds the damage a
  buggy feeder spamming distinct stream names can do to memory.
- **Same-name deduplication.** Multiple attempts against the same
  ``stream_name`` merge: the first ``example_row`` is retained (we assume
  it is representative), ``attempt_count`` increments, ``last_seen``
  advances. The UI renders a single notification with the live count.
- **Explicit dismissal.** ``dismiss`` is called by the streams router on
  successful ``create_stream`` — the notification disappears the moment
  the operator closes the loop.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from server.api.user_scope import UserRegistry

log = logging.getLogger(__name__)


_MAX_ENTRIES_PER_USER = 50


@dataclass
class UnregisteredPushAttempt:
    """One unregistered-stream push attempt, merged across repeats."""
    stream_name: str
    example_row: dict[str, Any]
    attempt_count: int
    first_seen: datetime
    last_seen: datetime


class UnregisteredPushStore:
    """Per-user LRU store of unregistered-stream push attempts."""

    def __init__(self) -> None:
        # Using a plain dict and the insertion-order guarantee for LRU: on
        # re-record we pop-and-reinsert so the most-recent touch sits at the
        # tail, and evict from the head.
        self._entries: dict[str, UnregisteredPushAttempt] = {}
        self._lock = threading.Lock()

    def record(self, stream_name: str, example_row: dict[str, Any]) -> None:
        """Register or merge an unregistered-push attempt.

        Emits a ``WARNING`` log on every call so ``.logs/server.log`` is an
        authoritative audit trail — proves the hard-block fired (no data
        was accepted into the pipeline) even if nobody is watching the UI.
        """
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with self._lock:
            existing = self._entries.pop(stream_name, None)
            if existing is not None:
                existing.attempt_count += 1
                existing.last_seen = now
                self._entries[stream_name] = existing
                log.warning(
                    "Unregistered push REJECTED (dedup): stream=%r attempt=%d",
                    stream_name, existing.attempt_count,
                )
                return
            if len(self._entries) >= _MAX_ENTRIES_PER_USER:
                oldest_key = next(iter(self._entries))
                self._entries.pop(oldest_key, None)
            self._entries[stream_name] = UnregisteredPushAttempt(
                stream_name=stream_name,
                example_row=dict(example_row),
                attempt_count=1,
                first_seen=now,
                last_seen=now,
            )
            log.warning(
                "Unregistered push REJECTED (first): stream=%r example_keys=%s",
                stream_name, sorted(example_row.keys()),
            )

    def list(self) -> list[UnregisteredPushAttempt]:
        """Return every active attempt, LRU-ordered (oldest first)."""
        with self._lock:
            return list(self._entries.values())

    def dismiss(self, stream_name: str) -> bool:
        """Drop an entry. Returns True if one was present."""
        with self._lock:
            return self._entries.pop(stream_name, None) is not None


_stores: UserRegistry[UnregisteredPushStore] = UserRegistry(UnregisteredPushStore)


def get_store(user_id: str) -> UnregisteredPushStore:
    """Return the per-user store (lazily constructed)."""
    return _stores.get(user_id)
