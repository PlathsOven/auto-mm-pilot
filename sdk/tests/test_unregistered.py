"""Tests for Section 10 — never allow push to an unregistered stream."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient, PositStreamNotRegistered, SnapshotRow


URL = "http://localhost:8000"


def _row() -> SnapshotRow:
    return SnapshotRow(
        timestamp="2026-01-01T00:00:00",
        raw_value=1.0,
        market_value=1.0,
        symbol="BTC",
        expiry="27MAR26",
    )


@pytest.mark.asyncio
@respx.mock
async def test_push_to_unregistered_raises_synchronously_no_http() -> None:
    """No push traffic leaves the process if the stream is unregistered."""
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots")

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositStreamNotRegistered) as exc_info:
            await client.push_snapshot("never_registered", [_row()])
        assert exc_info.value.stream_name == "never_registered"

    assert not snapshot_route.called


@pytest.mark.asyncio
@respx.mock
async def test_ingest_to_unregistered_raises_synchronously() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots")
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositStreamNotRegistered):
            await client.ingest_snapshot("nope", [_row()])
    assert not snapshot_route.called


@pytest.mark.asyncio
@respx.mock
async def test_push_allowed_after_create_stream() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200, json={"dimensions": [], "dimensionCols": ["symbol", "expiry"]},
        )
    )
    respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
        )
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": True},
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        await client.create_stream("rv", key_cols=["symbol", "expiry"])
        # After create_stream, push must succeed (stream is in cache).
        ack = await client.push_snapshot("rv", [_row()])
        assert ack.rows_accepted == 1


@pytest.mark.asyncio
@respx.mock
async def test_server_409_drops_cache_and_raises_not_registered() -> None:
    """When the server returns STREAM_NOT_REGISTERED, we translate + drop the cache."""
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={
                "streams": [
                    {
                        "stream_name": "rv",
                        "key_cols": ["symbol", "expiry"],
                        "status": "READY",
                    },
                ],
            },
        )
    )
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

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        # Cache is primed from __aenter__ so the synchronous check passes.
        assert "rv" in client._ready_streams
        with pytest.raises(PositStreamNotRegistered):
            await client.ingest_snapshot("rv", [_row()])
        # Cache has been invalidated — a second push without re-registering
        # must raise synchronously (no HTTP roundtrip).
        assert "rv" not in client._ready_streams
