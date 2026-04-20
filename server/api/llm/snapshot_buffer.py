"""
Pipeline Snapshot Ring Buffer.

Stores timestamped pipeline snapshots in a fixed-size ring buffer so the
investigation LLM can receive condensed time-series context alongside the
current snapshot.

The buffer provides:
- Per-stream delta extraction (how each stream's contribution changed)
- Aggregated delta extraction (how edge, variance, and position changed)
- A compact prompt-ready formatter that produces markdown tables

All lookback intervals and snapshot counts are configurable via
``SnapshotBufferConfig``.
"""

from __future__ import annotations

import copy
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from server.api.config import (
    SNAPSHOT_BUFFER_MAX_DEFAULT,
    SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT,
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SnapshotBufferConfig:
    """Controls how the ring buffer samples and formats history.

    Defaults are imported from ``server.api.config`` — the single source of
    truth.  Override via constructor args or env vars at the config level.

    Parameters
    ----------
    max_snapshots:
        Maximum number of snapshots retained in the ring buffer.
    lookback_offsets_seconds:
        Ordered list of lookback offsets (in seconds from *now*) used to
        sample keyframes.  E.g. ``[3600, 21600, 86400]`` means the prompt
        will include snapshots closest to 1h, 6h, and 24h ago.
    """

    max_snapshots: int = SNAPSHOT_BUFFER_MAX_DEFAULT
    lookback_offsets_seconds: tuple[int, ...] = SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT


# ---------------------------------------------------------------------------
# Ring buffer
# ---------------------------------------------------------------------------

@dataclass
class TimestampedSnapshot:
    """A pipeline snapshot tagged with its timestamp."""

    timestamp: datetime
    data: dict[str, Any]


class SnapshotRingBuffer:
    """Fixed-size ring buffer for pipeline snapshots.

    Call :meth:`push` every time a new pipeline snapshot is produced.
    Call :meth:`build_history_context` to get a prompt-ready string of
    condensed deltas between sampled keyframes.
    """

    def __init__(self, config: SnapshotBufferConfig | None = None) -> None:
        self._config = config or SnapshotBufferConfig()
        self._buf: deque[TimestampedSnapshot] = deque(maxlen=self._config.max_snapshots)

    # -- public API ---------------------------------------------------------

    @property
    def config(self) -> SnapshotBufferConfig:
        return self._config

    def push(self, timestamp: datetime, snapshot: dict[str, Any]) -> None:
        """Append a new snapshot.  Oldest entries are evicted automatically."""
        self._buf.append(TimestampedSnapshot(timestamp=timestamp, data=copy.deepcopy(snapshot)))

    def __len__(self) -> int:
        return len(self._buf)

    def build_history_context(self, now: datetime) -> str | None:
        """Build a prompt-ready history section from the buffer.

        Returns ``None`` if the buffer has fewer than 2 snapshots (no delta
        possible).

        The output contains two tables:
        1. **Per-stream deltas** — how each stream's fair-value and
           market-implied contributions changed between keyframes.
        2. **Aggregated deltas** — how overall edge, variance, and desired
           position changed between keyframes.
        """
        if len(self._buf) < 2:
            return None

        keyframes = self._sample_keyframes(now)
        if len(keyframes) < 2:
            return None

        stream_table = _build_per_stream_table(keyframes)
        agg_table = _build_aggregated_table(keyframes)

        return (
            f"## PER-STREAM CHANGES\n{stream_table}\n\n"
            f"## AGGREGATED CHANGES\n{agg_table}"
        )

    # -- internal -----------------------------------------------------------

    def _sample_keyframes(self, now: datetime) -> list[TimestampedSnapshot]:
        """Pick the closest snapshot to each configured lookback offset,
        plus the most recent snapshot as *now*.

        Returns snapshots in chronological order (oldest first).
        """
        latest = self._buf[-1]
        targets = sorted(self._config.lookback_offsets_seconds, reverse=True)

        selected: list[TimestampedSnapshot] = []
        for offset_s in targets:
            target_ts = now - timedelta(seconds=offset_s)
            closest = _closest_snapshot(self._buf, target_ts)
            if closest is not None and closest is not latest:
                # Avoid duplicates if two offsets resolve to the same snapshot
                if not selected or selected[-1] is not closest:
                    selected.append(closest)

        # Chronological order, then append *now*
        selected.sort(key=lambda s: s.timestamp)
        selected.append(latest)
        return selected


# ---------------------------------------------------------------------------
# Delta extraction helpers
# ---------------------------------------------------------------------------

def _closest_snapshot(
    buf: deque[TimestampedSnapshot],
    target: datetime,
) -> TimestampedSnapshot | None:
    """Return the snapshot whose timestamp is closest to *target*."""
    best: TimestampedSnapshot | None = None
    best_delta = timedelta.max
    for snap in buf:
        d = abs(snap.timestamp - target)
        if d < best_delta:
            best_delta = d
            best = snap
    return best


def _extract_stream_contributions(
    snapshot: dict[str, Any],
) -> dict[str, dict[str, float]]:
    """Extract per-stream aggregated contributions from a pipeline snapshot.

    Market-implied value now lives at the space level — blocks only carry
    ``fair``. The per-stream table still emits a ``market`` column for
    backwards compatibility with the prompt format, filled with ``0`` since
    the block layer has no per-stream market anymore.

    Returns a dict keyed by ``stream_name`` with sub-keys:
    - ``fair``: sum of per-block fair value contributions for this stream
    - ``market``: always ``0.0``
    """
    streams: dict[str, dict[str, float]] = {}
    for block in snapshot.get("block_summary", []):
        name = block.get("stream_name", "unknown")
        entry = streams.setdefault(name, {"fair": 0.0, "market": 0.0})
        fair = block.get("fair", block.get("target_value", 0))
        entry["fair"] += float(fair)
    return streams


def _fmt_label(snap: TimestampedSnapshot, latest: TimestampedSnapshot) -> str:
    """Label for a keyframe: 'now' for the latest, else an actual timestamp.

    Uses 'HH:MM UTC' for same-day snapshots, 'YYYY-MM-DD HH:MM UTC' for
    older ones.  This prevents the LLM from echoing relative T-x notation.
    """
    if snap is latest:
        return "now"
    ts = snap.timestamp
    if ts.date() == latest.timestamp.date():
        return ts.strftime("%H:%M UTC")
    return ts.strftime("%Y-%m-%d %H:%M UTC")


# ---------------------------------------------------------------------------
# Table builders
# ---------------------------------------------------------------------------

def _build_per_stream_table(keyframes: list[TimestampedSnapshot]) -> str:
    """Markdown table showing per-stream fair & market changes across keyframes.

    Columns: Stream | <label_1> fair | <label_1> mkt | … | <label_n> fair | <label_n> mkt
    """
    latest = keyframes[-1]
    labels = [_fmt_label(kf, latest) for kf in keyframes]

    # Gather all stream names across all keyframes
    all_streams: list[str] = []
    seen: set[str] = set()
    for kf in keyframes:
        for name in _extract_stream_contributions(kf.data):
            if name not in seen:
                seen.add(name)
                all_streams.append(name)

    # Build per-keyframe contribution maps
    contribs = [_extract_stream_contributions(kf.data) for kf in keyframes]

    # Header
    header_parts = ["Stream"]
    for label in labels:
        header_parts.append(f"{label} fair")
        header_parts.append(f"{label} mkt")
    header = "| " + " | ".join(header_parts) + " |"
    sep = "| " + " | ".join(["---"] * len(header_parts)) + " |"

    rows: list[str] = []
    for stream_name in all_streams:
        parts = [stream_name]
        for contrib in contribs:
            entry = contrib.get(stream_name, {"fair": 0.0, "market": 0.0})
            parts.append(f"{entry['fair']:.4e}")
            parts.append(f"{entry['market']:.4e}")
        rows.append("| " + " | ".join(parts) + " |")

    return "\n".join([header, sep, *rows])


def _build_aggregated_table(keyframes: list[TimestampedSnapshot]) -> str:
    """Markdown table showing aggregated edge, var, and position across keyframes.

    Columns: Metric | <label_1> | <label_2> | … | <label_n>
    """
    latest = keyframes[-1]
    labels = [_fmt_label(kf, latest) for kf in keyframes]

    def _get(kf: TimestampedSnapshot, *keys: str) -> str:
        """Dig into kf.data by dotted keys, format as string."""
        obj: Any = kf.data
        for k in keys:
            if isinstance(obj, dict):
                obj = obj.get(k)
            else:
                return "—"
        if obj is None:
            return "—"
        if isinstance(obj, float):
            return f"{obj:.4e}" if abs(obj) < 0.01 or abs(obj) > 1e6 else f"{obj:,.2f}"
        return str(obj)

    metrics = [
        ("edge", ("current_agg", "edge")),
        ("var", ("current_agg", "var")),
        ("total_fair", ("current_agg", "total_fair")),
        ("total_mkt_fair", ("current_agg", "total_market_fair")),
        ("ideal_desired_position", ("current_position", "raw_desired_position")),
        ("executable_desired_position", ("current_position", "smoothed_desired_position")),
    ]

    # Header
    header = "| Metric | " + " | ".join(labels) + " |"
    sep = "| --- | " + " | ".join(["---"] * len(labels)) + " |"

    rows: list[str] = []
    for metric_name, keys in metrics:
        values = [_get(kf, *keys) for kf in keyframes]
        rows.append(f"| {metric_name} | " + " | ".join(values) + " |")

    return "\n".join([header, sep, *rows])
