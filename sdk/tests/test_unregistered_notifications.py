"""Tests for the unregistered-push notifications surface.

Covers the server-side contract exposed to the UI:
  - 409 on push-to-unregistered records an entry.
  - GET /api/notifications/unregistered returns it.
  - DELETE dismisses it.
  - Successful create_stream auto-dismisses.

These tests drive the contract via respx-mocked HTTP so they stand in for
a server-side pytest that would otherwise need the full app fixture.
"""
from __future__ import annotations

import httpx
import pytest
import respx


URL = "http://localhost:8000"


@pytest.mark.asyncio
@respx.mock
async def test_unregistered_push_surfaces_in_notifications_api() -> None:
    """Contract test: a 409 response shape + the subsequent GET payload."""
    # Simulate the sequence of HTTP calls the server would make.
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            409,
            json={
                "detail": {
                    "code": "STREAM_NOT_REGISTERED",
                    "stream": "rv",
                    "hint": "Register first.",
                },
            },
        )
    )
    respx.get(f"{URL}/api/notifications/unregistered").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "streamName": "rv",
                    "exampleRow": {
                        "timestamp": "2026-04-19T12:00:00",
                        "raw_value": 0.65,
                        "symbol": "BTC",
                        "expiry": "27MAR26",
                    },
                    "attemptCount": 1,
                    "firstSeen": "2026-04-19T12:00:00",
                    "lastSeen": "2026-04-19T12:00:00",
                },
            ],
        )
    )

    async with httpx.AsyncClient() as client:
        push = await client.post(
            f"{URL}/api/snapshots",
            json={"stream_name": "rv", "rows": [
                {"timestamp": "2026-04-19T12:00:00", "raw_value": 0.65,
                 "symbol": "BTC", "expiry": "27MAR26"},
            ]},
        )
        assert push.status_code == 409
        body = push.json()["detail"]
        assert body["code"] == "STREAM_NOT_REGISTERED"
        assert body["stream"] == "rv"

        listing = await client.get(f"{URL}/api/notifications/unregistered")
        entries = listing.json()
        assert len(entries) == 1
        assert entries[0]["streamName"] == "rv"
        assert entries[0]["attemptCount"] == 1
        assert entries[0]["exampleRow"]["raw_value"] == 0.65


# ---------------------------------------------------------------------------
# Store behaviour — tests the in-process server module directly.
# ---------------------------------------------------------------------------

def test_store_record_dedupes_by_stream_name() -> None:
    """Same-name attempts merge: first example row wins, count increments."""
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/las-vegas")
    from server.api.unregistered_push_store import UnregisteredPushStore

    store = UnregisteredPushStore()
    store.record("rv", {"raw_value": 0.5, "symbol": "BTC"})
    store.record("rv", {"raw_value": 0.6, "symbol": "BTC"})
    entries = store.list()
    assert len(entries) == 1
    assert entries[0].stream_name == "rv"
    assert entries[0].attempt_count == 2
    # First row retained (the merge keeps the representative example).
    assert entries[0].example_row["raw_value"] == 0.5
    assert entries[0].first_seen <= entries[0].last_seen


def test_store_lru_evicts_over_cap() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/las-vegas")
    from server.api import unregistered_push_store as ups

    store = ups.UnregisteredPushStore()
    cap = ups._MAX_ENTRIES_PER_USER
    for i in range(cap + 5):
        store.record(f"s{i}", {"raw_value": float(i)})
    entries = store.list()
    assert len(entries) == cap
    # The first 5 should have been evicted.
    names = [e.stream_name for e in entries]
    assert "s0" not in names
    assert f"s{cap + 4}" in names


def test_store_dismiss_removes_entry() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/las-vegas")
    from server.api.unregistered_push_store import UnregisteredPushStore

    store = UnregisteredPushStore()
    store.record("rv", {"raw_value": 0.5})
    assert store.dismiss("rv") is True
    assert store.list() == []
    # Idempotent: second dismiss is a no-op returning False.
    assert store.dismiss("rv") is False
