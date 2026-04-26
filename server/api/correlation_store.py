"""
Per-user correlation store — committed + draft slots.

Two stores per user: one for symbol correlations, one for expiry
correlations. Each holds a sparse upper-triangle ``(a, b) -> rho`` map
for the committed matrix plus an optional draft map. Writes set the
dirty flag; the WS ticker coalesces reruns the same way it does for
``MarketValueStore``.

Canonicalisation of labels (expiry DDMMMYY → ISO) happens at the router
layer — this module treats every ``(a, b)`` pair as opaque strings and
only requires that callers have already sorted them so ``a < b``.
"""

from __future__ import annotations

import logging
import threading

from server.api.user_scope import UserRegistry

log = logging.getLogger(__name__)


# Correlations with ``|rho| >= 1`` produce a matrix that is either
# exactly singular (rho == 1) or indefinite (|rho| > 1). The matrix-side
# singularity check (``server.api.correlation_matrix``) catches this,
# but the store rejects values outside ``[-1, 1]`` defensively too —
# Pydantic validation at the router already enforces it, so this only
# fires on a bug in the caller.
_RHO_MIN = -1.0
_RHO_MAX = 1.0


class CorrelationStore:
    """One user's committed + draft correlation matrix slots.

    ``_committed`` and ``_draft`` are sparse upper-triangle maps — the
    zero entries (non-correlated pairs) are absent. The pipeline-side
    matrix materialiser fills missing entries with ``0.0``. Diagonal is
    implicit (always ``1.0``).

    ``_draft`` is ``None`` when no draft is live; the Confirm flow
    promotes ``_draft`` → ``_committed`` atomically and clears the slot.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._committed: dict[tuple[str, str], float] = {}
        self._draft: dict[tuple[str, str], float] | None = None
        self._dirty: bool = False

    # -- draft writes ------------------------------------------------------

    def set_draft(self, entries: list[tuple[str, str, float]]) -> None:
        """Overwrite the draft slot with ``(a, b, rho)`` entries.

        Expects ``a < b`` on every tuple — the router enforces this via
        Pydantic. Duplicate pairs overwrite silently (last one wins).
        """
        for a, b, rho in entries:
            if a >= b:
                raise ValueError(f"Non-canonical pair: a={a!r}, b={b!r} (expected a < b)")
            if rho < _RHO_MIN or rho > _RHO_MAX:
                raise ValueError(f"rho out of range: {rho}")
        with self._lock:
            self._draft = {(a, b): rho for a, b, rho in entries}
            self._dirty = True
        log.info("Correlation draft set: %d entries", len(entries))

    def discard_draft(self) -> bool:
        """Clear the draft slot. Returns ``True`` if a draft existed."""
        with self._lock:
            had = self._draft is not None
            self._draft = None
            if had:
                self._dirty = True
        if had:
            log.info("Correlation draft discarded")
        return had

    def confirm_draft(self) -> bool:
        """Promote draft → committed atomically. Returns ``True`` if promoted.

        Returns ``False`` when no draft is live (caller should 409).
        """
        with self._lock:
            if self._draft is None:
                return False
            self._committed = dict(self._draft)
            self._draft = None
            self._dirty = True
        log.info("Correlation draft confirmed: %d entries now committed",
                 len(self._committed))
        return True

    # -- reads -------------------------------------------------------------

    def committed_entries(self) -> list[tuple[str, str, float]]:
        """Return the committed upper-triangle as a sorted ``(a, b, rho)`` list."""
        with self._lock:
            return [(a, b, rho) for (a, b), rho in sorted(self._committed.items())]

    def draft_entries(self) -> list[tuple[str, str, float]] | None:
        """Return the draft upper-triangle, or ``None`` when no draft is live."""
        with self._lock:
            if self._draft is None:
                return None
            return [(a, b, rho) for (a, b), rho in sorted(self._draft.items())]

    def committed_map(self) -> dict[tuple[str, str], float]:
        """Return a copy of the committed map — safe for pipeline-side use."""
        with self._lock:
            return dict(self._committed)

    def draft_map(self) -> dict[tuple[str, str], float] | None:
        with self._lock:
            if self._draft is None:
                return None
            return dict(self._draft)

    # -- dirty flag --------------------------------------------------------

    def is_dirty(self) -> bool:
        return self._dirty

    def clear_dirty(self) -> None:
        self._dirty = False


# ---------------------------------------------------------------------------
# Per-user registries — one for symbols, one for expiries.
# ---------------------------------------------------------------------------

_symbol_correlations: UserRegistry[CorrelationStore] = UserRegistry(CorrelationStore)
_expiry_correlations: UserRegistry[CorrelationStore] = UserRegistry(CorrelationStore)


def get_symbol_store(user_id: str) -> CorrelationStore:
    """Return the per-user symbol correlation store (lazily constructed)."""
    return _symbol_correlations.get(user_id)


def get_expiry_store(user_id: str) -> CorrelationStore:
    """Return the per-user expiry correlation store (lazily constructed)."""
    return _expiry_correlations.get(user_id)


def is_any_dirty(user_id: str) -> bool:
    """True if either the symbol or expiry store is dirty for this user."""
    return (
        get_symbol_store(user_id).is_dirty()
        or get_expiry_store(user_id).is_dirty()
    )


def clear_all_dirty(user_id: str) -> None:
    """Clear the dirty flag on both stores for this user."""
    get_symbol_store(user_id).clear_dirty()
    get_expiry_store(user_id).clear_dirty()
