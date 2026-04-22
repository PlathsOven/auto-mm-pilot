"""Per-user monotonic sequence counter for snapshot ingests.

Every snapshot ingest (HTTP POST or WS inbound frame) pulls ``next()`` so
that every response — regardless of transport — carries a server-assigned
monotonic ``server_seq``. Consumers that want to correlate payloads or
detect gaps after a WS reconnect can rely on this field; the previously
fabricated ``seq=-1`` on the REST fallback of ``push_snapshot`` is gone.

Thread-safe via a small lock; per-user so one user's rate doesn't starve
another. Starts at 1; ``0`` is reserved for "never ingested anything."
"""

from __future__ import annotations

import threading

from server.api.user_scope import UserRegistry


class SequenceCounter:
    """One user's monotonic counter."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._value: int = 0

    def next(self) -> int:
        with self._lock:
            self._value += 1
            return self._value

    def peek(self) -> int:
        return self._value


_counters: UserRegistry[SequenceCounter] = UserRegistry(SequenceCounter)


def get_counter(user_id: str) -> SequenceCounter:
    return _counters.get(user_id)
