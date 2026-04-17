"""
Per-user scoping primitive.

``UserRegistry[T]`` wraps a factory that produces a fresh instance of ``T``
per user id. First access for a user id creates the instance lazily; every
subsequent access returns the same instance. Callers thread ``user_id``
through routers → registries instead of reaching for module-level singletons.

The primitive is intentionally minimal. Any cross-user leakage lives in the
*callers* (e.g. forgetting to pass ``user_id``) — never here.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Generic, TypeVar

T = TypeVar("T")


class UserRegistry(Generic[T]):
    """Lazy per-user instance map with a thread-safe factory."""

    def __init__(self, factory: Callable[[], T]) -> None:
        self._factory = factory
        self._by_user: dict[str, T] = {}
        self._lock = threading.Lock()

    def get(self, user_id: str) -> T:
        with self._lock:
            inst = self._by_user.get(user_id)
            if inst is None:
                inst = self._factory()
                self._by_user[user_id] = inst
            return inst

    def peek(self, user_id: str) -> T | None:
        """Return the instance for ``user_id`` without creating one."""
        with self._lock:
            return self._by_user.get(user_id)

    def drop(self, user_id: str) -> None:
        with self._lock:
            self._by_user.pop(user_id, None)

    def active_users(self) -> list[str]:
        """List user ids that currently own an instance."""
        with self._lock:
            return list(self._by_user.keys())
