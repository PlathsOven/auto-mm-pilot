"""Per-user correlation singularity alert store.

Stores the latest ``SingularCorrelationError`` caught during a pipeline
rerun so the WS broadcast can carry it into the Notifications Center.
The store holds at most one alert per matrix kind (``"symbol"`` or
``"expiry"``) — a newer failure supersedes the older one. Successful
reruns clear the matching kind's alert.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from server.api.correlation_matrix import SingularCorrelationError
from server.api.user_scope import UserRegistry

log = logging.getLogger(__name__)


@dataclass
class CorrelationSingularState:
    """One stored alert per (user, matrix_kind)."""
    matrix_kind: str  # "symbol" | "expiry"
    det: float
    condition_number: float


class CorrelationAlertStore:
    """Per-user latest-singular-failure registry — at most one per kind."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._alerts: dict[str, CorrelationSingularState] = {}

    def record(self, err: SingularCorrelationError) -> None:
        """Persist the latest singularity failure for ``err.matrix_kind``."""
        with self._lock:
            self._alerts[err.matrix_kind] = CorrelationSingularState(
                matrix_kind=err.matrix_kind,
                det=err.det,
                condition_number=err.condition_number,
            )
        log.warning(
            "Correlation matrix singular: kind=%s |det|=%.3e cond=%.3e",
            err.matrix_kind, abs(err.det), err.condition_number,
        )

    def clear_all(self) -> None:
        """Clear every alert — call after a successful rerun."""
        with self._lock:
            if self._alerts:
                log.info("Correlation singular alerts cleared (%d)", len(self._alerts))
            self._alerts.clear()

    def list(self) -> list[CorrelationSingularState]:
        """Return the current alerts in a stable order (symbol, expiry)."""
        with self._lock:
            # Sorted by kind so the UI order is deterministic — symbol before
            # expiry matches the editor's top-to-bottom arrangement.
            return [self._alerts[k] for k in sorted(self._alerts)]


_alerts: UserRegistry[CorrelationAlertStore] = UserRegistry(CorrelationAlertStore)


def get_store(user_id: str) -> CorrelationAlertStore:
    """Return the per-user correlation-alert store (lazily constructed)."""
    return _alerts.get(user_id)


def record(user_id: str, err: SingularCorrelationError) -> None:
    get_store(user_id).record(err)


def clear_all(user_id: str) -> None:
    get_store(user_id).clear_all()


def list_alerts(user_id: str) -> list[CorrelationSingularState]:
    return get_store(user_id).list()
