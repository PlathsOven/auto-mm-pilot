"""Per-dimension desired-position history ring buffer.

`desired_pos_df` is a forward projection from rerun_time → expiry, wiped at
every pipeline rerun (snapshot POST, bankroll change, transform config edit,
manual block edit). The pipeline time-series endpoint previously derived the
Position view from that projection, so the trader only ever saw a thin sliver
between the last rerun and `current_tick_ts`.

This module keeps an independent in-memory history — one row per (user,
symbol, expiry) per pipeline rerun — so the Position view can render a true
backward-looking time series with a configurable lookback window. See
`tasks/lessons.md` ("desired_pos_df is a forward projection, not historical
data") for the motivation.

Persistence is intentionally limited to process lifetime. A server restart
starts the buffer empty; persisting to SQLite is a follow-up.
"""

from __future__ import annotations

import threading
from bisect import bisect_left
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import polars as pl

from server.api.expiry import canonical_expiry_key as _expiry_key

# Per-dimension entry cap. Each pipeline rerun appends one entry per active
# (symbol, expiry) dim, so 4096 entries covers many hours of typical usage
# even on a busy account; older entries fall off the deque first.
POSITION_HISTORY_MAX_ENTRIES: int = 4096


@dataclass(frozen=True)
class PositionHistoryPoint:
    """A single (symbol, expiry) snapshot captured at `timestamp`."""

    timestamp: datetime
    raw_desired_position: float
    smoothed_desired_position: float
    edge: float
    smoothed_edge: float
    var: float
    smoothed_var: float
    total_fair: float
    total_market_fair: float


class PositionHistoryBuffer:
    """Per-user in-memory history, keyed by (symbol, expiry).

    Reads and writes are serialised with a single lock — contention is low
    (one append per rerun, reads only from the timeseries endpoint) so a
    finer-grained scheme isn't worth the complexity.
    """

    def __init__(self, max_entries_per_dim: int = POSITION_HISTORY_MAX_ENTRIES) -> None:
        self._max = max_entries_per_dim
        self._by_dim: dict[tuple[str, str], deque[PositionHistoryPoint]] = {}
        self._lock = threading.Lock()

    def push_rows(self, rows: Iterable[dict], timestamp: datetime) -> None:
        """Append one point per row to its (symbol, expiry) deque.

        `rows` comes from `desired_pos_df` filtered to the current tick; each
        dict must carry the columns referenced in `PositionHistoryPoint`.
        """
        with self._lock:
            for r in rows:
                key = (str(r["symbol"]), _expiry_key(r["expiry"]))
                dq = self._by_dim.get(key)
                if dq is None:
                    dq = deque(maxlen=self._max)
                    self._by_dim[key] = dq
                dq.append(PositionHistoryPoint(
                    timestamp=timestamp,
                    raw_desired_position=_f(r.get("raw_desired_position")),
                    smoothed_desired_position=_f(r.get("smoothed_desired_position")),
                    edge=_f(r.get("edge")),
                    smoothed_edge=_f(r.get("smoothed_edge")),
                    var=_f(r.get("var")),
                    smoothed_var=_f(r.get("smoothed_var")),
                    total_fair=_f(r.get("total_fair")),
                    total_market_fair=_f(r.get("total_market_fair")),
                ))

    def get_range(
        self,
        symbol: str,
        expiry: str,
        since: datetime,
    ) -> list[PositionHistoryPoint]:
        """Return points with `timestamp >= since` for (symbol, expiry).

        The deque is append-only in chronological order, so a single bisect
        on the timestamp sequence is enough — no sort required per request.
        """
        key = (symbol, _expiry_key(expiry))
        with self._lock:
            dq = self._by_dim.get(key)
            if not dq:
                return []
            snap = list(dq)
        if not snap:
            return []
        timestamps = [p.timestamp for p in snap]
        start = bisect_left(timestamps, since)
        return snap[start:]


def _f(v: object) -> float:
    """Coerce Polars cell values (possibly None) to float; None → 0.0."""
    if v is None:
        return 0.0
    return float(v)  # type: ignore[arg-type]


def build_from_desired_pos_df(df: pl.DataFrame, current_ts: datetime) -> list[dict]:
    """Pick the row nearest `current_ts` for each (symbol, expiry).

    `desired_pos_df` is a forward grid; the value "at now" for each dim is
    the row with the largest timestamp still ≤ current_ts. Returns raw dicts
    so the caller can pass them to `push_rows`.
    """
    if df.is_empty():
        return []
    sliced = df.filter(pl.col("timestamp") <= current_ts)
    if sliced.is_empty():
        # Fresh rerun where no revealed row exists yet — fall back to the
        # earliest forward projection, which is effectively "right now".
        sliced = df
    latest = (
        sliced
        .sort("timestamp")
        .group_by(["symbol", "expiry"], maintain_order=True)
        .tail(1)
        # Drop pipeline sentinel rows: position_sizing zeroes both raw and
        # smoothed desired_position when |var| < VAR_FLOOR (see
        # server/core/pipeline.py). Pushing those to history makes the
        # Position chart blip to 0 for one rerun; preferring a gap is honest.
        .filter(
            (pl.col("raw_desired_position") != 0.0)
            | (pl.col("smoothed_desired_position") != 0.0)
        )
    )
    return latest.to_dicts()
