"""Per-user bounded ring buffer of recent position payloads.

Keeps the last N serialized ``ServerPayload`` JSON strings together with
their monotonic ``seq``. Drives the ``GET /api/positions/since/{seq}``
replay endpoint so a reconnecting consumer can fetch anything it missed
during the outage — closes audit §9.2.
"""

from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass

from server.api.user_scope import UserRegistry

# Default buffer depth — 60 payloads at the current ~2s tick interval
# covers a ~2-minute outage. Generous but bounded.
MAX_REPLAY_PAYLOADS = 60


@dataclass
class ReplayEntry:
    seq: int
    prev_seq: int
    payload_json: str


class PositionsReplayStore:
    """One user's position payload ring buffer + monotonic seq counter."""

    def __init__(self, max_size: int = MAX_REPLAY_PAYLOADS) -> None:
        self._lock = threading.Lock()
        self._buffer: deque[ReplayEntry] = deque(maxlen=max_size)
        self._last_seq: int = 0

    def next_seq_and_prev(self) -> tuple[int, int]:
        """Reserve the next seq; return (new_seq, prev_seq)."""
        with self._lock:
            prev = self._last_seq
            self._last_seq += 1
            return self._last_seq, prev

    def record(self, seq: int, prev_seq: int, payload_json: str) -> None:
        """Store a freshly-built payload for replay."""
        with self._lock:
            self._buffer.append(
                ReplayEntry(seq=seq, prev_seq=prev_seq, payload_json=payload_json)
            )

    def since(self, seq: int) -> list[ReplayEntry]:
        """Return payloads with ``seq > input``. If the oldest buffered seq is
        already > ``seq + 1``, the caller missed more than the buffer holds —
        they see the oldest N but should treat the response's ``prev_seq``
        field as a gap indicator rather than trusting contiguity.
        """
        with self._lock:
            return [e for e in self._buffer if e.seq > seq]

    def oldest_seq(self) -> int | None:
        with self._lock:
            return self._buffer[0].seq if self._buffer else None

    def latest_seq(self) -> int:
        return self._last_seq


_stores: UserRegistry[PositionsReplayStore] = UserRegistry(PositionsReplayStore)


def get_store(user_id: str) -> PositionsReplayStore:
    return _stores.get(user_id)
