"""Per-user connector state — opaque ``state`` objects keyed by stream name.

Connectors are stateless singletons; the per-stream state lives here. The
store mediates between API rows (validated against the connector's input
schema) and connector-layer state objects (whose shape is opaque). On
stream delete, the store evicts the matching state.

Lifecycle:
    1. Stream configured with ``connector_name`` → store lazily allocates
       state on the first ``process()`` call.
    2. Subsequent ``process()`` calls fold rows into the same state.
    3. Stream deleted → ``evict(stream_name)`` drops the state.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

from server.api.user_scope import UserRegistry
from server.core.connectors import (
    EmittedRow,
    get_connector,
    resolve_params,
)
from server.core.connectors.base import ConnectorStateSummary

log = logging.getLogger(__name__)


@dataclass
class _StreamSlot:
    """Holds one stream's connector reference + its opaque state object."""

    connector_name: str
    state: Any


class ConnectorStateStore:
    """Per-user store of connector states keyed by stream name."""

    def __init__(self) -> None:
        self._slots: dict[str, _StreamSlot] = {}
        self._lock = threading.Lock()

    def process(
        self,
        stream_name: str,
        connector_name: str,
        params: dict[str, Any],
        rows: list[dict[str, Any]],
    ) -> list[EmittedRow]:
        """Fold ``rows`` into the stream's state and return any emitted rows.

        Lazily initialises state on the first call for ``stream_name``.
        Validates that the row payload carries the connector's input fields;
        ``ValueError`` is the canonical "bad input" signal — the caller
        translates it to HTTP 422.
        """
        connector = get_connector(connector_name)
        if connector is None:
            raise ValueError(f"Unknown connector {connector_name!r}")

        resolved_params = resolve_params(connector.params, params)
        validated_rows = _validate_rows(connector, rows)

        with self._lock:
            slot = self._slots.get(stream_name)
            if slot is None:
                slot = _StreamSlot(
                    connector_name=connector_name,
                    state=connector.initial_state(resolved_params),
                )
                self._slots[stream_name] = slot
            elif slot.connector_name != connector_name:
                # Defensive — caller should never hand us conflicting names
                # for the same stream. If it ever does, we replace the state
                # rather than corrupting the previous connector's invariants.
                log.warning(
                    "ConnectorStateStore: stream %r switched connector %r → %r; "
                    "evicting old state",
                    stream_name, slot.connector_name, connector_name,
                )
                slot = _StreamSlot(
                    connector_name=connector_name,
                    state=connector.initial_state(resolved_params),
                )
                self._slots[stream_name] = slot

            new_state, emitted = connector.process(slot.state, validated_rows, resolved_params)
            slot.state = new_state

        return emitted

    def summary(
        self, stream_name: str, connector_name: str,
    ) -> ConnectorStateSummary | None:
        """Return the connector's state summary, or ``None`` if no state yet."""
        connector = get_connector(connector_name)
        if connector is None:
            return None
        with self._lock:
            slot = self._slots.get(stream_name)
            if slot is None or slot.connector_name != connector_name:
                return None
            return connector.state_summary(slot.state)

    def evict(self, stream_name: str) -> None:
        """Drop the state for ``stream_name`` (no-op if absent)."""
        with self._lock:
            self._slots.pop(stream_name, None)


def _validate_rows(connector, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Lightweight per-row schema check before delegating to the connector.

    The connector's ``process`` does its own deeper validation (price > 0,
    monotonic timestamp, etc.); here we only ensure the required fields are
    present so the connector code can assume a well-shaped row dict.
    """
    if not rows:
        raise ValueError("connector input requires at least one row")
    required = {"timestamp", *connector.input_key_cols, *(f.name for f in connector.input_value_fields)}
    cleaned: list[dict[str, Any]] = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"Row {i} is not a dict")
        missing = required - set(row.keys())
        if missing:
            raise ValueError(
                f"Row {i} missing required fields {sorted(missing)} "
                f"(connector input schema: {sorted(required)})"
            )
        cleaned.append(row)
    return cleaned


_stores: UserRegistry[ConnectorStateStore] = UserRegistry(ConnectorStateStore)


def get_connector_state_store(user_id: str) -> ConnectorStateStore:
    """Return the per-user connector state store (lazily constructed)."""
    return _stores.get(user_id)
