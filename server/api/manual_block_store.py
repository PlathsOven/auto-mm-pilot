"""
Per-user manual-block metadata store.

Tracks which streams were created from a trader's ``create_manual_block``
gesture vs. ingested from a live feed, so downstream routers can attribute
the block back to the authoring action when the trader inspects it.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass


@dataclass
class ManualBlockMetadata:
    """Tracks manually-created blocks for source attribution."""

    created_at: str


class ManualBlockStore:
    """One user's manual-block metadata map."""

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
