"""
Thread-safe aggregate market value store.

Singleton that holds ``{(symbol, expiry): total_vol}`` with a dirty flag.
API writes update the store and set the flag; the WS ticker checks the
flag each tick and triggers a coalesced pipeline rerun when dirty.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

log = logging.getLogger(__name__)

_lock = threading.Lock()
_store: dict[tuple[str, str], float] = {}
_dirty: bool = False


# ---------------------------------------------------------------------------
# Write operations (set dirty flag)
# ---------------------------------------------------------------------------

def set_market_value(symbol: str, expiry: str, total_vol: float) -> None:
    """Set or update the aggregate total vol for a symbol/expiry pair."""
    global _dirty
    with _lock:
        _store[(symbol, expiry)] = total_vol
        _dirty = True
    log.info("Market value set: %s/%s = %.6f", symbol, expiry, total_vol)


def delete_market_value(symbol: str, expiry: str) -> bool:
    """Remove the aggregate for a symbol/expiry. Returns True if it existed."""
    global _dirty
    with _lock:
        existed = (symbol, expiry) in _store
        if existed:
            del _store[(symbol, expiry)]
            _dirty = True
    if existed:
        log.info("Market value deleted: %s/%s", symbol, expiry)
    return existed


def set_entries(entries: list[dict[str, Any]]) -> None:
    """Batch-set entries. Each dict must have symbol, expiry, total_vol."""
    global _dirty
    with _lock:
        for e in entries:
            _store[(e["symbol"], e["expiry"])] = e["total_vol"]
        _dirty = True
    log.info("Market values batch-set: %d entries", len(entries))


# ---------------------------------------------------------------------------
# Read operations
# ---------------------------------------------------------------------------

def get_all() -> list[dict[str, Any]]:
    """Return all entries as a list of dicts."""
    with _lock:
        return [
            {"symbol": k[0], "expiry": k[1], "total_vol": v}
            for k, v in sorted(_store.items())
        ]


def to_dict() -> dict[tuple[str, str], float]:
    """Return a snapshot of the store as a plain dict (for pipeline)."""
    with _lock:
        return dict(_store)


# ---------------------------------------------------------------------------
# Dirty flag
# ---------------------------------------------------------------------------

def is_dirty() -> bool:
    """Check whether the store has been modified since last clear."""
    return _dirty


def clear_dirty() -> None:
    """Clear the dirty flag (called by ticker after coalesced rerun)."""
    global _dirty
    _dirty = False
