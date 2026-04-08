"""
In-memory stream registry — manages stream definitions and snapshot data.

Lifecycle:
    1. User creates stream (stream_name + key_cols) → PENDING
    2. Admin configures pipeline params (scale, offset, exponent, BlockConfig) → READY
    3. Client pushes snapshot rows for READY streams → stored here, consumed by engine

Thread-safety: This module uses a simple lock for concurrent access from
async FastAPI handlers.  For production persistence, swap the dict backend
for a database.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import polars as pl

from server.core.config import BlockConfig, StreamConfig

log = logging.getLogger(__name__)

# Required columns in every snapshot row (in addition to key_cols)
_REQUIRED_SNAPSHOT_COLS = {"timestamp", "raw_value"}

# Default test stream — always exists on init so the client can verify connectivity
TEST_STREAM_NAME = "__test__"
_TEST_STREAM_KEY_COLS = ["symbol"]


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

        # Parse timestamp / datetime strings into Python datetimes
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
        )


# ---------------------------------------------------------------------------
# Datetime coercion helper
# ---------------------------------------------------------------------------

_DATETIME_FIELDS = {"timestamp", "start_timestamp", "expiry"}


def _parse_datetime_tolerant(raw: str) -> datetime:
    """Accept ISO 8601 (``2026-03-27T00:00:00``) or DDMMMYY (``27MAR26``).

    The WS payload normalises expiries to DDMMMYY via ``_format_expiry`` in
    ``ws.py``, so users routinely paste that format into manual block forms.
    Falling back to DDMMMYY here lets the server accept either form.
    """
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
    codebase convention where naive datetimes represent UTC.  This prevents
    Polars ``datetime[μs]`` vs ``datetime[μs, UTC]`` supertype mismatches
    when manual blocks are combined with mock/existing streams.
    """
    dt_cols = _DATETIME_FIELDS | {k for k in key_cols if k in _DATETIME_FIELDS}
    coerced: list[dict[str, Any]] = []
    for row in rows:
        out: dict[str, Any] = {}
        for k, v in row.items():
            if k in dt_cols and isinstance(v, str):
                dt = _parse_datetime_tolerant(v)
                if dt.tzinfo is not None:
                    dt = dt.replace(tzinfo=None)
                out[k] = dt
            else:
                out[k] = v
        coerced.append(out)
    return coerced


# ---------------------------------------------------------------------------
# Registry singleton
# ---------------------------------------------------------------------------

class StreamRegistry:
    """In-memory registry of stream definitions and their latest snapshots."""

    def __init__(self) -> None:
        self._streams: dict[str, StreamRegistration] = {}
        self._lock = threading.Lock()
        self._seed_test_stream()

    def _seed_test_stream(self) -> None:
        """Create a pre-configured READY test stream for connectivity verification.

        Uses identity transform (scale=1, offset=0, exponent=1) and default
        BlockConfig so the client can immediately send snapshot rows without
        needing admin configuration.
        """
        reg = StreamRegistration(
            stream_name=TEST_STREAM_NAME,
            key_cols=list(_TEST_STREAM_KEY_COLS),
            scale=1.0,
            offset=0.0,
            exponent=1.0,
            block=BlockConfig(),
        )
        self._streams[TEST_STREAM_NAME] = reg
        log.info("Test stream '%s' seeded (status=%s)", TEST_STREAM_NAME, reg.status)

    # -- Seed from StreamConfig --------------------------------------------

    def seed_stream_config(self, sc: StreamConfig) -> None:
        """Register a fully-built ``StreamConfig`` directly into the registry.

        Used to seed mock/startup streams so they are included in
        ``build_stream_configs()`` alongside any streams added later.
        Overwrites any existing stream with the same name.
        """
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
        """User updates stream_name and/or key_cols.

        If key_cols change, existing snapshot rows are cleared (schema mismatch).
        """
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")

            if new_key_cols is not None and new_key_cols != reg.key_cols:
                reg.key_cols = list(new_key_cols)
                reg.snapshot_rows = []  # invalidate stale snapshot
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
            log.info("Stream '%s' configured by admin (status=%s)", stream_name, reg.status)
            return reg

    # -- Delete -------------------------------------------------------------

    def delete(self, stream_name: str) -> None:
        with self._lock:
            if stream_name not in self._streams:
                raise KeyError(f"Stream '{stream_name}' not found")
            del self._streams[stream_name]
            log.info("Stream deleted: %s", stream_name)

    # -- Snapshot ingestion -------------------------------------------------

    def ingest_snapshot(
        self,
        stream_name: str,
        rows: list[dict[str, Any]],
    ) -> int:
        """Store snapshot rows for a READY stream.

        Validates that every row contains the required columns.
        Returns the number of rows accepted.
        Raises ``ValueError`` on validation failure, ``KeyError`` if not found.
        """
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
        """Build ``list[StreamConfig]`` from all READY streams that have snapshots."""
        with self._lock:
            configs: list[StreamConfig] = []
            for reg in self._streams.values():
                if reg.status == "READY" and reg.has_snapshot:
                    try:
                        configs.append(reg.to_stream_config())
                    except Exception:
                        log.exception("Failed to build StreamConfig for '%s'", reg.stream_name)
            return configs


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_registry: StreamRegistry | None = None


def get_stream_registry() -> StreamRegistry:
    """Return the global stream registry (created on first call)."""
    global _registry
    if _registry is None:
        _registry = StreamRegistry()
    return _registry
