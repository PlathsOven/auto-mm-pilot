"""Tests for §2.1 server-side zero-edge guard + SDK translation."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient, PositZeroEdgeBlocked, SnapshotRow


URL = "http://localhost:8000"


def _row(market_value: float | None = None) -> SnapshotRow:
    return SnapshotRow(
        timestamp="2026-01-01T00:00:00",
        raw_value=1.0,
        market_value=market_value,
        symbol="BTC",
        expiry="27MAR26",
    )


@pytest.mark.asyncio
@respx.mock
async def test_ingest_snapshot_translates_422_zero_edge_to_typed_exception() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [
                {"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "READY"},
            ]},
        )
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            422,
            json={
                "detail": {
                    "code": "ZERO_EDGE_BLOCKED",
                    "stream": "rv",
                    "missing_pairs": [{"symbol": "BTC", "expiry": "2026-03-27T00:00:00"}],
                    "hint": "...",
                },
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositZeroEdgeBlocked) as exc_info:
            await client.ingest_snapshot("rv", [_row()])
    assert exc_info.value.stream_name == "rv"
    assert exc_info.value.missing_pairs == [("BTC", "2026-03-27T00:00:00")]
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
@respx.mock
async def test_ingest_snapshot_passes_allow_zero_edge_flag() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [
                {"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "READY"},
            ]},
        )
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": True},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.ingest_snapshot(
            "rv", [_row()], allow_zero_edge=True,
        )
    assert snapshot_route.called
    body = snapshot_route.calls[-1].request.content.decode()
    assert '"allow_zero_edge":true' in body
    assert resp.rows_accepted == 1


@pytest.mark.asyncio
@respx.mock
async def test_ingest_snapshot_omits_allow_zero_edge_flag_by_default() -> None:
    """Don't send the key at all when default — keeps the body minimal."""
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [
                {"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "READY"},
            ]},
        )
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": True},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        await client.ingest_snapshot("rv", [_row(market_value=0.5)])
    body = snapshot_route.calls[-1].request.content.decode()
    assert "allow_zero_edge" not in body


@pytest.mark.asyncio
@respx.mock
async def test_push_snapshot_forwards_allow_zero_edge_through_rest_fallback() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [
                {"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "READY"},
            ]},
        )
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": True},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        await client.push_snapshot("rv", [_row()], allow_zero_edge=True)
    body = snapshot_route.calls[-1].request.content.decode()
    assert '"allow_zero_edge":true' in body


# ---------------------------------------------------------------------------
# Server-side guard — direct module tests (stand in for a server pytest)
# ---------------------------------------------------------------------------

def _server_path_insertable() -> bool:
    import os
    return os.path.exists(
        "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville/server/api/zero_edge_guard.py"
    )


@pytest.mark.skipif(
    not _server_path_insertable(),
    reason="server module not visible from this workspace",
)
def test_guard_passes_when_row_has_market_value() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.market_value_store import MarketValueStore
    from server.api.stream_registry import StreamRegistration
    from server.api.zero_edge_guard import check_zero_edge

    reg = StreamRegistration(
        stream_name="rv",
        key_cols=["symbol", "expiry"],
        scale=1.0, offset=0.0, exponent=1.0,
    )
    mv = MarketValueStore()
    # One row has market_value → guard passes.
    check_zero_edge(
        reg,
        [{"symbol": "BTC", "expiry": "27MAR26", "market_value": 0.7}],
        mv,
        allow_zero_edge=False,
    )


@pytest.mark.skipif(not _server_path_insertable(), reason="server module not visible")
def test_guard_passes_when_aggregate_mv_covers_pairs() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.market_value_store import MarketValueStore
    from server.api.stream_registry import StreamRegistration
    from server.api.zero_edge_guard import check_zero_edge

    reg = StreamRegistration(
        stream_name="rv", key_cols=["symbol", "expiry"],
        scale=1.0, offset=0.0, exponent=1.0,
    )
    mv = MarketValueStore()
    mv.set_market_value("BTC", "27MAR26", 0.7)
    # Row has no market_value, but aggregate covers (BTC, 27MAR26) → pass.
    check_zero_edge(
        reg,
        [{"symbol": "BTC", "expiry": "27MAR26"}],
        mv,
        allow_zero_edge=False,
    )


@pytest.mark.skipif(not _server_path_insertable(), reason="server module not visible")
def test_guard_passes_when_allow_zero_edge_true() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.market_value_store import MarketValueStore
    from server.api.stream_registry import StreamRegistration
    from server.api.zero_edge_guard import check_zero_edge

    reg = StreamRegistration(
        stream_name="rv", key_cols=["symbol", "expiry"],
        scale=1.0, offset=0.0, exponent=1.0,
    )
    check_zero_edge(
        reg,
        [{"symbol": "BTC", "expiry": "27MAR26"}],
        MarketValueStore(),
        allow_zero_edge=True,
    )


@pytest.mark.skipif(not _server_path_insertable(), reason="server module not visible")
def test_guard_raises_when_no_coverage_and_first_push() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.market_value_store import MarketValueStore
    from server.api.stream_registry import StreamRegistration
    from server.api.zero_edge_guard import ZeroEdgeBlocked, check_zero_edge

    reg = StreamRegistration(
        stream_name="rv", key_cols=["symbol", "expiry"],
        scale=1.0, offset=0.0, exponent=1.0,
    )
    with pytest.raises(ZeroEdgeBlocked) as exc_info:
        check_zero_edge(
            reg,
            [{"symbol": "BTC", "expiry": "27MAR26"}],
            MarketValueStore(),
            allow_zero_edge=False,
        )
    assert exc_info.value.stream_name == "rv"
    assert ("BTC", "2026-03-27T00:00:00") in exc_info.value.pairs


@pytest.mark.skipif(not _server_path_insertable(), reason="server module not visible")
def test_guard_skips_subsequent_pushes() -> None:
    """Once snapshot rows exist, the guard no longer fires."""
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.market_value_store import MarketValueStore
    from server.api.stream_registry import StreamRegistration
    from server.api.zero_edge_guard import check_zero_edge

    reg = StreamRegistration(
        stream_name="rv", key_cols=["symbol", "expiry"],
        scale=1.0, offset=0.0, exponent=1.0,
        snapshot_rows=[{"symbol": "BTC", "expiry": "27MAR26",
                        "timestamp": "2026-01-01T00:00:00", "raw_value": 1.0}],
    )
    # has_snapshot=True, guard passes even without market_value or aggregate.
    check_zero_edge(
        reg,
        [{"symbol": "BTC", "expiry": "27MAR26"}],
        MarketValueStore(),
        allow_zero_edge=False,
    )
