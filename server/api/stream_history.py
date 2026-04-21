"""Per-stream per-key raw-value history ring buffer.

``StreamRegistration.snapshot_rows`` is replaced on every ingest with the
latest batch — producers pushing one row at a time overwrite any prior
values, so the Stream Inspector's time-series chart would show a single
point per key. This buffer captures one entry per ``(key_tuple)`` per
ingest, giving the Inspector a live accumulating series while leaving
``snapshot_rows`` free to carry "the current state" for pipeline
consumption.

Each ``StreamRegistration`` owns its own buffer; lifetime is tied to the
registration. Persistence is process-lifetime only — a restart wipes it
(future: persist to SQLite).
"""

from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

# Per-key entry cap. High enough to cover several hours of one-per-second
# pushes; older entries fall off the deque first. Mirrors
# ``POSITION_HISTORY_MAX_ENTRIES`` in ``position_history.py``.
STREAM_HISTORY_MAX_ENTRIES: int = 4096


@dataclass(frozen=True)
class StreamHistoryPoint:
    """One raw_value observation for a (stream, key) at ``timestamp``."""

    timestamp: datetime
    raw_value: float


class StreamHistoryBuffer:
    """Per-registration history, keyed by the key-column tuple.

    Reads and writes share a single lock — contention is low (one append
    per ingest, reads only from the Inspector endpoint) so a finer-grained
    scheme isn't worth the complexity.
    """

    def __init__(self, max_entries_per_key: int = STREAM_HISTORY_MAX_ENTRIES) -> None:
        self._max = max_entries_per_key
        self._by_key: dict[tuple[str, ...], deque[StreamHistoryPoint]] = {}
        self._key_spec: dict[tuple[str, ...], dict[str, str]] = {}
        self._lock = threading.Lock()

    def push_rows(
        self,
        key_cols: list[str],
        rows: Iterable[dict[str, Any]],
    ) -> None:
        """Append one point per row to its key-tuple deque.

        Rows with missing / unparseable ``timestamp`` or ``raw_value`` are
        skipped silently — ingest already validated the required-column
        shape; this guards against stray type coercion edge cases.
        """
        with self._lock:
            for row in rows:
                key_values = tuple(str(row.get(k, "")) for k in key_cols)
                ts = _coerce_ts(row.get("timestamp"))
                if ts is None:
                    continue
                try:
                    raw_value = float(row.get("raw_value", 0.0))
                except (TypeError, ValueError):
                    continue
                dq = self._by_key.get(key_values)
                if dq is None:
                    dq = deque(maxlen=self._max)
                    self._by_key[key_values] = dq
                    self._key_spec[key_values] = {k: str(row.get(k, "")) for k in key_cols}
                dq.append(StreamHistoryPoint(timestamp=ts, raw_value=raw_value))

    def record_heartbeat(
        self,
        key_cols: list[str],
        latest_rows: Iterable[dict[str, Any]],
        at: datetime,
    ) -> None:
        """Extend each tracked key's history with a ``(at, latest_raw_value)``
        point — so a stream whose producer only pushed once still renders as
        a growing "live" line in the Inspector.

        Reduces ``latest_rows`` to one entry per key (last write wins) and
        appends a point per key whose deque exists. Dedupes on exact
        ``timestamp``; skips keys not yet in the buffer (heartbeats never
        create keys — they only extend what a real ingest already seeded).
        """
        latest_per_key: dict[tuple[str, ...], float] = {}
        for row in latest_rows:
            key_values = tuple(str(row.get(k, "")) for k in key_cols)
            try:
                latest_per_key[key_values] = float(row.get("raw_value", 0.0))
            except (TypeError, ValueError):
                continue
        if not latest_per_key:
            return
        with self._lock:
            for key_values, raw_value in latest_per_key.items():
                dq = self._by_key.get(key_values)
                if dq is None:
                    continue
                if dq and dq[-1].timestamp == at:
                    continue
                dq.append(StreamHistoryPoint(timestamp=at, raw_value=raw_value))

    def series(self) -> list[tuple[dict[str, str], list[StreamHistoryPoint]]]:
        """Return ``(key_spec, points)`` pairs, sorted by points' timestamps."""
        with self._lock:
            out: list[tuple[dict[str, str], list[StreamHistoryPoint]]] = []
            for key_values, dq in self._by_key.items():
                pts = sorted(dq, key=lambda p: p.timestamp)
                out.append((dict(self._key_spec[key_values]), pts))
            out.sort(key=lambda pair: tuple(pair[0].values()))
            return out

    def clear(self) -> None:
        """Drop every key-series — called when ``key_cols`` changes."""
        with self._lock:
            self._by_key.clear()
            self._key_spec.clear()


def _coerce_ts(value: Any) -> datetime | None:
    """Accept ``datetime`` objects or ISO-format strings; normalise to naive UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo is not None else value
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value)
        except ValueError:
            return None
        return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt
    return None
