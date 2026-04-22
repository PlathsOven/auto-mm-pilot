"""Tests for §7.2 client.events() structured event stream."""
from __future__ import annotations

import asyncio

import httpx
import pytest
import respx

from posit_sdk import PositClient, SnapshotRow


URL = "http://localhost:8000"


def _row(market_value: float | None = None) -> SnapshotRow:
    return SnapshotRow(
        timestamp="2026-01-01T00:00:00",
        raw_value=1.0,
        market_value=market_value,
        symbol="BTC",
        expiry="27MAR26",
    )


def _ready_stream_list() -> dict:
    return {"streams": [
        {"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "READY"},
    ]}


@pytest.mark.asyncio
@respx.mock
async def test_events_market_value_missing_emitted_on_push() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json=_ready_stream_list())
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": True},
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        # Start the events iterator.
        events = client.events()
        await client.ingest_snapshot("rv", [_row()])  # no market_value
        # Drain one event.
        evt = await asyncio.wait_for(anext(events), timeout=1.0)
        assert evt.type == "market_value_missing"
        assert evt.stream_name == "rv"
        assert "market_value" in evt.detail


@pytest.mark.asyncio
@respx.mock
async def test_events_positions_degraded_emitted() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )

    def _payload(ts: int) -> dict:
        return {
            "streams": [],
            "context": {"lastUpdateTimestamp": ts},
            "positions": [],
            "updates": [],
        }

    respx.get(f"{URL}/api/positions").mock(
        return_value=httpx.Response(200, json=_payload(1000)),
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        events = client.events()
        it = client.positions(poll_interval=0.0)
        await anext(it)  # triggers "positions_degraded"
        await it.aclose()
        evt = await asyncio.wait_for(anext(events), timeout=1.0)
        assert evt.type == "positions_degraded"


@pytest.mark.asyncio
@respx.mock
async def test_events_terminates_on_client_exit() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    events_iter = None
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        events_iter = client.events()
    # After exiting the context, iterating must terminate cleanly.
    async def _drain() -> list:
        out: list = []
        async for e in events_iter:
            out.append(e)
        return out
    remaining = await asyncio.wait_for(_drain(), timeout=1.0)
    assert remaining == []


@pytest.mark.asyncio
async def test_events_without_context_raises() -> None:
    client = PositClient(url=URL, api_key="ok", connect_ws=False)
    with pytest.raises(RuntimeError, match="context manager"):
        async for _ in client.events():
            pass
