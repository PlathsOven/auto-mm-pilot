"""
Per-user aggregate market value store.

Each user owns a ``{(symbol, expiry): total_vol}`` map + a dirty flag. API
writes mutate the calling user's store and set their dirty flag; the WS
ticker checks the flag per user and triggers coalesced reruns.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from server.api.expiry import canonical_expiry_key
from server.api.user_scope import UserRegistry

log = logging.getLogger(__name__)


class MarketValueStore:
    """One user's aggregate market value store."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._store: dict[tuple[str, str], float] = {}
        self._dirty: bool = False

    # -- writes ------------------------------------------------------------

    def set_market_value(self, symbol: str, expiry: str, total_vol: float) -> None:
        key_expiry = canonical_expiry_key(expiry)
        with self._lock:
            self._store[(symbol, key_expiry)] = total_vol
            self._dirty = True
        log.info("Market value set: %s/%s = %.6f", symbol, key_expiry, total_vol)

    def delete_market_value(self, symbol: str, expiry: str) -> bool:
        key_expiry = canonical_expiry_key(expiry)
        with self._lock:
            existed = (symbol, key_expiry) in self._store
            if existed:
                del self._store[(symbol, key_expiry)]
                self._dirty = True
        if existed:
            log.info("Market value deleted: %s/%s", symbol, key_expiry)
        return existed

    def set_entries(self, entries: list[dict[str, Any]]) -> None:
        with self._lock:
            for e in entries:
                self._store[(e["symbol"], canonical_expiry_key(e["expiry"]))] = e["total_vol"]
            self._dirty = True
        log.info("Market values batch-set: %d entries", len(entries))

    # -- reads -------------------------------------------------------------

    def get_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {"symbol": k[0], "expiry": k[1], "total_vol": v}
                for k, v in sorted(self._store.items())
            ]

    def to_dict(self) -> dict[tuple[str, str], float]:
        with self._lock:
            return dict(self._store)

    # -- dirty flag --------------------------------------------------------

    def is_dirty(self) -> bool:
        return self._dirty

    def clear_dirty(self) -> None:
        self._dirty = False


_market_values: UserRegistry[MarketValueStore] = UserRegistry(MarketValueStore)


def get_store(user_id: str) -> MarketValueStore:
    """Return the per-user market value store (lazily constructed)."""
    return _market_values.get(user_id)


# ---------------------------------------------------------------------------
# Convenience shims — thin delegates to keep caller sites concise
# ---------------------------------------------------------------------------

def set_market_value(user_id: str, symbol: str, expiry: str, total_vol: float) -> None:
    get_store(user_id).set_market_value(symbol, expiry, total_vol)


def delete_market_value(user_id: str, symbol: str, expiry: str) -> bool:
    return get_store(user_id).delete_market_value(symbol, expiry)


def set_entries(user_id: str, entries: list[dict[str, Any]]) -> None:
    get_store(user_id).set_entries(entries)


def get_all(user_id: str) -> list[dict[str, Any]]:
    return get_store(user_id).get_all()


def to_dict(user_id: str) -> dict[tuple[str, str], float]:
    return get_store(user_id).to_dict()


def is_dirty(user_id: str) -> bool:
    return get_store(user_id).is_dirty()


def clear_dirty(user_id: str) -> None:
    get_store(user_id).clear_dirty()
