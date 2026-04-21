"""
Per-user in-memory stream registry.

Each user owns an independent ``StreamRegistry`` with its own streams,
snapshot rows, and manual-block metadata. Callers pass ``user_id`` explicitly
— the module exposes helpers that lazily construct a registry per user.

Lifecycle:
    1. User creates stream (stream_name + key_cols) → PENDING
    2. Admin (or the user via stream config UI) fills in pipeline params → READY
    3. Client pushes snapshot rows for READY streams → stored here, consumed by engine
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import polars as pl

from server.api.user_scope import UserRegistry
from server.core.config import BlockConfig, StreamConfig

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Manual-block metadata store (one per user)
# ---------------------------------------------------------------------------

@dataclass
class ManualBlockMetadata:
    """Tracks manually-created blocks for source attribution."""
    created_at: str


class ManualBlockStore:
    def __init__(self) -> None:
        self._entries: dict[str, ManualBlockMetadata] = {}
        self._lock = threading.Lock()

    def mark(self, stream_name: str, created_at: str) -> None:
        with self._lock:
            self._entries[stream_name] = ManualBlockMetadata(created_at=created_at)

    def unmark(self, stream_name: str) -> None:
        with self._lock:
            self._entries.pop(stream_name, None)

    def is_manual(self, stream_name: str) -> bool:
        with self._lock:
            return stream_name in self._entries

    def count(self) -> int:
        with self._lock:
            return len(self._entries)


# Required columns in every snapshot row (in addition to key_cols)
_REQUIRED_SNAPSHOT_COLS = {"timestamp", "raw_value"}


# ---------------------------------------------------------------------------
# Registration dataclass
# ---------------------------------------------------------------------------

@dataclass
class StreamRegistration:
    """Mutable record for a registered data stream."""

    stream_name: str
    key_cols: list[str]

    # Admin-configured fields (None until admin sets them)
    scale: float | None = None
    offset: float | None = None
    exponent: float | None = None
    block: BlockConfig | None = None

    # Latest snapshot rows (list of dicts, set via API)
    snapshot_rows: list[dict[str, Any]] = field(default_factory=list)

    # Optional space_id override (bypasses auto-computation from temporal_position)
    space_id_override: str | None = None

    # Authoring metadata — not used by the pipeline. Persisted so the Stream
    # Canvas form can re-hydrate the exact draft the user last activated
    # (description text, the raw pasted sample CSV, and which column held the
    # raw value).
    description: str | None = None
    sample_csv: str | None = None
    value_column: str | None = None

    # Which (symbol, expiry) pairs this stream's blocks fan out to.
    # None (default) means "every pair in the pipeline's dim universe".
    applies_to: list[tuple[str, str]] | None = None

    # Non-destructive on/off switch. When False, the stream stays in the
    # registry with its config intact but is skipped in ``build_stream_configs``
    # so it no longer contributes to the pipeline. The trader flips this from
    # the Workbench stream list / Inspector to pause a feed without losing
    # its mapping.
    active: bool = True

    @property
    def status(self) -> str:
        if self.scale is None or self.block is None:
            return "PENDING"
        return "READY"

    @property
    def has_snapshot(self) -> bool:
        return len(self.snapshot_rows) > 0

    def to_stream_config(self) -> StreamConfig:
        """Convert to a frozen ``StreamConfig`` for pipeline consumption.

        Raises ``ValueError`` if the stream is not READY or has no snapshot.
        """
        if self.status != "READY":
            raise ValueError(f"Stream '{self.stream_name}' is not READY (status={self.status})")
        if not self.has_snapshot:
            raise ValueError(f"Stream '{self.stream_name}' has no snapshot data")

        assert self.scale is not None
        assert self.offset is not None
        assert self.exponent is not None
        assert self.block is not None

        rows = _coerce_datetime_fields(self.snapshot_rows, self.key_cols)
        snapshot_df = pl.DataFrame(rows)

        return StreamConfig(
            stream_name=self.stream_name,
            snapshot=snapshot_df,
            key_cols=list(self.key_cols),
            scale=self.scale,
            offset=self.offset,
            exponent=self.exponent,
            block=self.block,
            space_id_override=self.space_id_override,
            applies_to=(
                [tuple(p) for p in self.applies_to]
                if self.applies_to is not None
                else None
            ),
        )


# ---------------------------------------------------------------------------
# Datetime coercion helper
# ---------------------------------------------------------------------------

_DATETIME_FIELDS = {"timestamp", "start_timestamp", "expiry"}


def parse_datetime_tolerant(raw: str) -> datetime:
    """Accept ISO 8601 (``2026-03-27T00:00:00``) or DDMMMYY (``27MAR26``)."""
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, "%d%b%y")


def _coerce_datetime_fields(
    rows: list[dict[str, Any]],
    key_cols: list[str],
) -> list[dict[str, Any]]:
    """Parse ISO-format strings into ``datetime`` objects for known datetime columns.

    All datetimes are normalised to **naive** (tzinfo stripped) to match the
    codebase convention where naive datetimes represent UTC.
    """
    dt_cols = _DATETIME_FIELDS | {k for k in key_cols if k in _DATETIME_FIELDS}
    coerced: list[dict[str, Any]] = []
    for row in rows:
        out: dict[str, Any] = {}
        for k, v in row.items():
            if k in dt_cols and isinstance(v, str):
                dt = parse_datetime_tolerant(v)
                if dt.tzinfo is not None:
                    dt = dt.replace(tzinfo=None)
                out[k] = dt
            else:
                out[k] = v
        coerced.append(out)
    return coerced


# ---------------------------------------------------------------------------
# Per-user registry
# ---------------------------------------------------------------------------

class StreamRegistry:
    """One user's stream registry + manual-block metadata."""

    def __init__(self) -> None:
        self._streams: dict[str, StreamRegistration] = {}
        self._lock = threading.Lock()
        self.manual_blocks = ManualBlockStore()

    # -- Seed from StreamConfig --------------------------------------------

    def seed_stream_config(self, sc: StreamConfig) -> None:
        """Register a fully-built ``StreamConfig`` directly into the registry."""
        with self._lock:
            reg = StreamRegistration(
                stream_name=sc.stream_name,
                key_cols=list(sc.key_cols),
                scale=sc.scale,
                offset=sc.offset,
                exponent=sc.exponent,
                block=sc.block,
                snapshot_rows=sc.snapshot.to_dicts(),
            )
            self._streams[sc.stream_name] = reg
            log.info("Stream seeded from StreamConfig: %s (status=%s)", sc.stream_name, reg.status)

    # -- Read ---------------------------------------------------------------

    def list_streams(self) -> list[StreamRegistration]:
        with self._lock:
            return list(self._streams.values())

    def get(self, stream_name: str) -> StreamRegistration | None:
        with self._lock:
            return self._streams.get(stream_name)

    # -- Create -------------------------------------------------------------

    def create(self, stream_name: str, key_cols: list[str]) -> StreamRegistration:
        """Register a new stream. Raises ``ValueError`` if name already taken."""
        with self._lock:
            if stream_name in self._streams:
                raise ValueError(f"Stream '{stream_name}' already exists")
            reg = StreamRegistration(stream_name=stream_name, key_cols=list(key_cols))
            self._streams[stream_name] = reg
            log.info("Stream created: %s (key_cols=%s)", stream_name, key_cols)
            return reg

    # -- Update (user) ------------------------------------------------------

    def update(
        self,
        stream_name: str,
        *,
        new_name: str | None = None,
        new_key_cols: list[str] | None = None,
    ) -> StreamRegistration:
        """User updates stream_name and/or key_cols."""
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")

            if new_key_cols is not None and new_key_cols != reg.key_cols:
                reg.key_cols = list(new_key_cols)
                reg.snapshot_rows = []
                log.info("Stream '%s' key_cols updated to %s (snapshot cleared)", stream_name, new_key_cols)

            if new_name is not None and new_name != stream_name:
                if new_name in self._streams:
                    raise ValueError(f"Stream '{new_name}' already exists")
                del self._streams[stream_name]
                reg.stream_name = new_name
                self._streams[new_name] = reg
                log.info("Stream renamed: %s → %s", stream_name, new_name)

            return reg

    # -- Configure (admin) --------------------------------------------------

    def configure(
        self,
        stream_name: str,
        *,
        scale: float,
        offset: float,
        exponent: float,
        block: BlockConfig,
        description: str | None = None,
        sample_csv: str | None = None,
        value_column: str | None = None,
        applies_to: list[tuple[str, str]] | None = None,
    ) -> StreamRegistration:
        """Admin sets the pipeline-facing parameters → moves stream to READY."""
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")
            reg.scale = scale
            reg.offset = offset
            reg.exponent = exponent
            reg.block = block
            reg.description = description
            reg.sample_csv = sample_csv
            reg.value_column = value_column
            reg.applies_to = applies_to
            log.info("Stream '%s' configured (status=%s)", stream_name, reg.status)
            return reg

    # -- Active toggle ------------------------------------------------------

    def set_active(self, stream_name: str, active: bool) -> StreamRegistration:
        """Flip a stream between active (contributing to the pipeline) and
        inactive (held in the registry but skipped in ``build_stream_configs``).
        """
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")
            if reg.active != active:
                reg.active = active
                log.info("Stream '%s' active=%s", stream_name, active)
            return reg

    # -- Delete -------------------------------------------------------------

    def delete(self, stream_name: str) -> None:
        with self._lock:
            if stream_name not in self._streams:
                raise KeyError(f"Stream '{stream_name}' not found")
            del self._streams[stream_name]
            self.manual_blocks.unmark(stream_name)
            log.info("Stream deleted: %s", stream_name)

    # -- Snapshot ingestion -------------------------------------------------

    def ingest_snapshot(
        self,
        stream_name: str,
        rows: list[dict[str, Any]],
    ) -> int:
        """Store snapshot rows for a READY stream."""
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")
            if reg.status != "READY":
                raise ValueError(
                    f"Stream '{stream_name}' is not READY (status={reg.status}). "
                    "Admin must configure it first."
                )

            required = _REQUIRED_SNAPSHOT_COLS | set(reg.key_cols)
            for i, row in enumerate(rows):
                missing = required - set(row.keys())
                if missing:
                    raise ValueError(
                        f"Row {i} missing required columns: {sorted(missing)}. "
                        f"Expected: {sorted(required)}"
                    )

            reg.snapshot_rows = list(rows)
            log.info("Snapshot ingested for '%s': %d rows", stream_name, len(rows))
            return len(rows)

    # -- Pipeline consumption -----------------------------------------------

    def build_stream_configs(self) -> list[StreamConfig]:
        """Build ``list[StreamConfig]`` from all READY + active streams with snapshots.

        Inactive streams are skipped — the pipeline runs as if they didn't
        exist, but their config stays in the registry so the trader can flip
        them back on from the UI.
        """
        with self._lock:
            configs: list[StreamConfig] = []
            for reg in self._streams.values():
                if reg.status == "READY" and reg.has_snapshot and reg.active:
                    try:
                        configs.append(reg.to_stream_config())
                    except Exception:
                        log.exception("Failed to build StreamConfig for '%s'", reg.stream_name)
            return configs


# ---------------------------------------------------------------------------
# Per-user lookup
# ---------------------------------------------------------------------------

_registries: UserRegistry[StreamRegistry] = UserRegistry(StreamRegistry)


def get_stream_registry(user_id: str) -> StreamRegistry:
    """Return the per-user stream registry (lazily constructed)."""
    return _registries.get(user_id)


def get_manual_block_store(user_id: str) -> ManualBlockStore:
    """Shortcut for ``get_stream_registry(user_id).manual_blocks``."""
    return _registries.get(user_id).manual_blocks
