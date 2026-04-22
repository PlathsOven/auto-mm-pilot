"""Tests for §6.1 server-assigned seq uniformity across REST + WS paths."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient, SnapshotRow


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
async def test_ingest_response_carries_server_seq() -> None:
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
            200,
            json={
                "stream_name": "rv",
                "rows_accepted": 1,
                "pipeline_rerun": True,
                "server_seq": 42,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.ingest_snapshot("rv", [_row()])
    assert resp.server_seq == 42


@pytest.mark.asyncio
@respx.mock
async def test_push_snapshot_rest_fallback_propagates_server_seq() -> None:
    """When WS is down and push falls back to REST, the WsAck carries server_seq."""
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
            200,
            json={
                "stream_name": "rv",
                "rows_accepted": 1,
                "pipeline_rerun": True,
                "server_seq": 7,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        ack = await client.push_snapshot("rv", [_row()])
    # client_seq fabricated to -1 because REST path, but server_seq is real.
    assert ack.seq == -1
    assert ack.server_seq == 7
    assert ack.rows_accepted == 1


@pytest.mark.asyncio
@respx.mock
async def test_missing_server_seq_defaults_to_zero() -> None:
    """Old servers that don't set server_seq → default 0 (not an error)."""
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
            200,
            json={
                "stream_name": "rv",
                "rows_accepted": 1,
                "pipeline_rerun": True,
                # server_seq omitted — old server
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.ingest_snapshot("rv", [_row()])
    assert resp.server_seq == 0  # default
