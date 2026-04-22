"""Tests for §3.2 key_cols superset/subset migration (server-side)."""
from __future__ import annotations

import pytest


def _server_visible() -> bool:
    import os
    return os.path.exists(
        "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville/server/api/stream_registry.py"
    )


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_superset_migration_preserves_rows_with_null_added_col() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.stream_registry import StreamRegistry

    reg = StreamRegistry()
    reg.create("evt", key_cols=["symbol", "expiry"])
    r = reg.get("evt")
    r.snapshot_rows = [
        {"symbol": "BTC", "expiry": "27MAR26", "timestamp": "t1", "raw_value": 1.0},
        {"symbol": "ETH", "expiry": "27MAR26", "timestamp": "t2", "raw_value": 2.0},
    ]

    reg.update("evt", new_key_cols=["symbol", "expiry", "event_id"])

    rows = reg.get("evt").snapshot_rows
    assert len(rows) == 2
    assert rows[0]["event_id"] is None
    assert rows[1]["event_id"] is None
    assert rows[0]["symbol"] == "BTC"


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_subset_migration_drops_col_and_collapses_collisions() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.stream_registry import StreamRegistry

    reg = StreamRegistry()
    reg.create("evt", key_cols=["symbol", "expiry", "event_id"])
    r = reg.get("evt")
    r.snapshot_rows = [
        {"symbol": "BTC", "expiry": "27MAR26", "event_id": "A", "raw_value": 1.0},
        {"symbol": "BTC", "expiry": "27MAR26", "event_id": "B", "raw_value": 2.0},
        {"symbol": "ETH", "expiry": "27MAR26", "event_id": "A", "raw_value": 3.0},
    ]

    reg.update("evt", new_key_cols=["symbol", "expiry"])

    rows = reg.get("evt").snapshot_rows
    # Three rows collapsed to two (BTC/27MAR26 had 2 events; first-seen wins).
    assert len(rows) == 2
    # event_id dropped from every row.
    for row in rows:
        assert "event_id" not in row
    # First-seen per new key tuple retained.
    btc = next(r for r in rows if r["symbol"] == "BTC")
    assert btc["raw_value"] == 1.0  # A came first


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_disjoint_migration_clears_rows() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.stream_registry import StreamRegistry

    reg = StreamRegistry()
    reg.create("evt", key_cols=["symbol", "expiry"])
    r = reg.get("evt")
    r.snapshot_rows = [
        {"symbol": "BTC", "expiry": "27MAR26", "raw_value": 1.0},
    ]

    # New key_cols shares `symbol` but not `expiry` → neither superset nor
    # subset (has new `source`, loses `expiry`) → clear.
    reg.update("evt", new_key_cols=["symbol", "source"])

    assert reg.get("evt").snapshot_rows == []
    assert reg.get("evt").key_cols == ["symbol", "source"]
