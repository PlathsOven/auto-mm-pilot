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
from typing import TYPE_CHECKING, Any

import polars as pl

from server.api.datetime_parsing import coerce_datetime_fields
from server.api.manual_block_store import ManualBlockStore
from server.api.stream_history import StreamHistoryBuffer
from server.api.user_scope import UserRegistry
from server.core.config import BlockConfig, StreamConfig

if TYPE_CHECKING:  # pragma: no cover
    from server.api.connector_state import ConnectorStateStore

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Connector / snapshot routing errors — caller translates to HTTP 409.
# ---------------------------------------------------------------------------


class StreamIsConnectorFed(Exception):
    """Raised when a snapshot push targets a connector-fed stream."""

    def __init__(self, stream_name: str, connector_name: str) -> None:
        self.stream_name = stream_name
        self.connector_name = connector_name
        super().__init__(
            f"Stream '{stream_name}' is connector-fed by '{connector_name}'; "
            f"use POST /api/streams/{stream_name}/connector-input instead."
        )


class StreamIsNotConnectorFed(Exception):
    """Raised when a connector-input push targets a user-fed stream."""

    def __init__(self, stream_name: str) -> None:
        self.stream_name = stream_name
        super().__init__(
            f"Stream '{stream_name}' is not connector-fed; "
            f"use POST /api/snapshots instead."
        )


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

    # Per-key raw_value ring buffer — fed on every ingest so the Inspector
    # can render an accumulating time series even when producers push one
    # row at a time (``snapshot_rows`` is replaced, not appended).
    history: StreamHistoryBuffer = field(default_factory=StreamHistoryBuffer)

    # Connector wiring. When ``connector_name`` is non-None the stream is
    # connector-fed: snapshot pushes are rejected, and ingest happens via
    # ``ingest_connector_input`` which delegates to ConnectorStateStore.
    connector_name: str | None = None
    connector_params: dict[str, Any] | None = None

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

        rows = coerce_datetime_fields(self.snapshot_rows, self.key_cols)
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
            seed_rows = sc.snapshot.to_dicts()
            reg = StreamRegistration(
                stream_name=sc.stream_name,
                key_cols=list(sc.key_cols),
                scale=sc.scale,
                offset=sc.offset,
                exponent=sc.exponent,
                block=sc.block,
                snapshot_rows=seed_rows,
            )
            reg.history.push_rows(reg.key_cols, seed_rows)
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

        ``key_cols`` changes:
          - **Superset** (new ⊇ old): rows are preserved; added columns are
            populated with None on existing rows. The producer is expected
            to backfill the new columns on the next push.
          - **Subset** (new ⊂ old): rows are preserved; dropped columns are
            removed from each row. Collisions on the new key set collapse
            deterministically — first-seen wins per (new_key_tuple).
          - **Disjoint / overlap** (neither superset nor subset): rows are
            cleared. Zero-surprise fallback for the cases where migration
            is ambiguous.
        """
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")

            if new_key_cols is not None and new_key_cols != reg.key_cols:
                old = set(reg.key_cols)
                new = set(new_key_cols)
                if new.issuperset(old):
                    added = new - old
                    for row in reg.snapshot_rows:
                        for col in added:
                            row.setdefault(col, None)
                    reg.key_cols = list(new_key_cols)
                    log.info(
                        "Stream '%s' key_cols superset migration %s → %s; "
                        "%d rows preserved with None in %s.",
                        stream_name, sorted(old), new_key_cols,
                        len(reg.snapshot_rows), sorted(added),
                    )
                elif new.issubset(old):
                    dropped = old - new
                    seen: dict[tuple, dict[str, Any]] = {}
                    for row in reg.snapshot_rows:
                        stripped = {
                            k: v for k, v in row.items() if k not in dropped
                        }
                        key_tuple = tuple(stripped.get(k) for k in new_key_cols)
                        if key_tuple not in seen:
                            seen[key_tuple] = stripped
                    reg.snapshot_rows = list(seen.values())
                    reg.key_cols = list(new_key_cols)
                    log.info(
                        "Stream '%s' key_cols subset migration %s → %s; "
                        "%d rows preserved (dropped %s), collisions collapsed "
                        "first-seen.",
                        stream_name, sorted(old), new_key_cols,
                        len(reg.snapshot_rows), sorted(dropped),
                    )
                else:
                    reg.key_cols = list(new_key_cols)
                    reg.snapshot_rows = []
                    reg.history.clear()
                    log.info(
                        "Stream '%s' key_cols disjoint migration %s → %s; "
                        "rows cleared (no deterministic mapping).",
                        stream_name, sorted(old), new_key_cols,
                    )

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
        connector_name: str | None = None,
        connector_params: dict[str, Any] | None = None,
    ) -> StreamRegistration:
        """Admin sets the pipeline-facing parameters → moves stream to READY.

        ``connector_name`` (optional) flags the stream as connector-fed so
        ``ingest_snapshot`` rejects snapshot pushes; the matching
        ``ingest_connector_input`` is the only valid ingest path.
        """
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
            reg.connector_name = connector_name
            reg.connector_params = connector_params
            log.info(
                "Stream '%s' configured (status=%s, connector=%s)",
                stream_name, reg.status, connector_name,
            )
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

    def delete(
        self,
        stream_name: str,
        connector_store: "ConnectorStateStore | None" = None,
    ) -> None:
        """Delete a stream; optionally evict its connector state."""
        with self._lock:
            if stream_name not in self._streams:
                raise KeyError(f"Stream '{stream_name}' not found")
            del self._streams[stream_name]
            self.manual_blocks.unmark(stream_name)
            log.info("Stream deleted: %s", stream_name)
        if connector_store is not None:
            connector_store.evict(stream_name)

    # -- Snapshot ingestion -------------------------------------------------

    def ingest_snapshot(
        self,
        stream_name: str,
        rows: list[dict[str, Any]],
    ) -> int:
        """Store snapshot rows for a READY, user-fed stream."""
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None:
                raise KeyError(f"Stream '{stream_name}' not found")
            if reg.status != "READY":
                raise ValueError(
                    f"Stream '{stream_name}' is not READY (status={reg.status}). "
                    "Admin must configure it first."
                )
            if reg.connector_name is not None:
                raise StreamIsConnectorFed(stream_name, reg.connector_name)

            required = _REQUIRED_SNAPSHOT_COLS | set(reg.key_cols)
            for i, row in enumerate(rows):
                missing = required - set(row.keys())
                if missing:
                    raise ValueError(
                        f"Row {i} missing required columns: {sorted(missing)}. "
                        f"Expected: {sorted(required)}"
                    )

            reg.snapshot_rows = list(rows)
            reg.history.push_rows(reg.key_cols, rows)
            log.info("Snapshot ingested for '%s': %d rows", stream_name, len(rows))
            return len(rows)

    def ingest_connector_input(
        self,
        stream_name: str,
        rows: list[dict[str, Any]],
        connector_store: "ConnectorStateStore",
    ) -> tuple[int, int]:
        """Push connector inputs to ``stream_name``; emit snapshot rows.

        Returns ``(rows_accepted, rows_emitted)`` — accepted is the inbound
        row count (the connector consumed all of them, raising on bad
        input); emitted is how many ``SnapshotRow`` entries actually landed
        in the stream's ``snapshot_rows`` after the State Store fans
        per-symbol output across the current dim universe (one row per
        ``(symbol, expiry)`` in the universe). When the universe is empty
        the emit count is zero and no pipeline rerun fires — see the
        "Implementation note" in ``tasks/spec-connectors.md`` for the
        bootstrapping limitation.
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
            if reg.connector_name is None:
                raise StreamIsNotConnectorFed(stream_name)
            connector_name = reg.connector_name
            connector_params = dict(reg.connector_params or {})
            stream_key_cols = list(reg.key_cols)

        # Connector mutation runs outside the registry lock — the connector
        # store has its own lock, and the connector's process() can be slow.
        emitted = connector_store.process(
            stream_name, connector_name, connector_params, rows,
        )

        # Fan emitted per-symbol rows across (symbol, expiry) pairs in the
        # current dim universe so the pipeline sees per-(symbol, expiry)
        # rows like any other stream.
        fanned = self._fan_emit_rows(emitted, stream_key_cols)

        if fanned:
            with self._lock:
                reg = self._streams.get(stream_name)
                if reg is None:
                    # Stream was deleted between the connector call and now;
                    # drop the emit silently — the evict will have cleared
                    # state already.
                    return len(rows), 0
                reg.snapshot_rows = fanned
                reg.history.push_rows(reg.key_cols, fanned)

        log.info(
            "Connector input ingested for '%s' via %s: %d rows in, %d emitted, "
            "%d fanned across dim universe",
            stream_name, connector_name, len(rows), len(emitted), len(fanned),
        )
        return len(rows), len(fanned)

    def _fan_emit_rows(
        self,
        emitted: list[dict[str, Any]],
        stream_key_cols: list[str],
    ) -> list[dict[str, Any]]:
        """Replicate connector emit rows across the current dim universe.

        The connector emits rows tagged with its ``input_key_cols`` (e.g.
        ``["symbol"]`` for realized_vol). The stream's ``key_cols`` are the
        full risk-dimension set (``["symbol", "expiry"]``). For every
        emitted row, replicate it once per ``expiry`` value the same symbol
        already has in the dim universe — read from every other configured
        stream's snap rows. Returns ``[]`` when the universe is empty.
        """
        if not emitted:
            return []

        # Collect (symbol, expiry) pairs from every *other* stream's snap
        # rows. We skip the connector-fed stream itself to avoid the
        # bootstrap chicken-and-egg of "the universe is what I emitted".
        universe_by_symbol: dict[Any, set[Any]] = {}
        with self._lock:
            for reg in self._streams.values():
                if reg.connector_name is not None:
                    continue
                if "symbol" not in reg.key_cols or "expiry" not in reg.key_cols:
                    continue
                for row in reg.snapshot_rows:
                    sym = row.get("symbol")
                    exp = row.get("expiry")
                    if sym is None or exp is None:
                        continue
                    universe_by_symbol.setdefault(sym, set()).add(exp)

        if not universe_by_symbol:
            return []

        # For per-symbol emits, replicate across that symbol's expiries.
        # If the connector emitted for a symbol not in the universe (e.g.
        # the trader pushes ETH ticks but only BTC has expiries), the row
        # is dropped silently — same shape as the universe-empty case.
        fanned: list[dict[str, Any]] = []
        missing_keys = [k for k in stream_key_cols if k not in {"symbol", "expiry"}]
        for row in emitted:
            sym = row.get("symbol")
            expiries = universe_by_symbol.get(sym, set())
            for exp in expiries:
                fan_row = dict(row)
                fan_row.setdefault("expiry", exp)
                # Anything else the stream's key_cols requires that the
                # connector didn't emit — set to None so the missing-cols
                # validator passes (the pipeline tolerates Nulls in extra
                # key columns).
                for k in missing_keys:
                    fan_row.setdefault(k, None)
                fanned.append(fan_row)
        return fanned

    def connector_state_summary(
        self, stream_name: str, connector_store: "ConnectorStateStore",
    ):
        """Return the connector's state summary for ``stream_name`` or None."""
        with self._lock:
            reg = self._streams.get(stream_name)
            if reg is None or reg.connector_name is None:
                return None
            connector_name = reg.connector_name
        return connector_store.summary(stream_name, connector_name)

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
