"""Tests for §4.1 push_fanned_snapshot helper."""
from __future__ import annotations

import json

import httpx
import pytest
import respx

from posit_sdk import PositClient, PositValidationError, SnapshotRow


URL = "http://localhost:8000"


def _stream_list() -> dict:
    return {"streams": [
        {"stream_name": "ev", "key_cols": ["symbol", "expiry"], "status": "READY"},
    ]}


@pytest.mark.asyncio
@respx.mock
async def test_fan_out_explicit_universe() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json=_stream_list())
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "ev", "rows_accepted": 4, "pipeline_rerun": True},
        )
    )
    universe = [("BTC", "27MAR26"), ("ETH", "27MAR26")]

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        await client.push_fanned_snapshot(
            "ev",
            [SnapshotRow(timestamp="2026-01-01T00:00:00", raw_value=1.0, market_value=0.5),
             SnapshotRow(timestamp="2026-01-01T00:00:01", raw_value=2.0, market_value=0.5)],
            universe=universe,
        )

    body = json.loads(snapshot_route.calls[-1].request.content.decode())
    assert body["stream_name"] == "ev"
    # 2 rows × 2 pairs = 4 fanned rows.
    assert len(body["rows"]) == 4
    pairs_seen = {(r["symbol"], r["expiry"]) for r in body["rows"]}
    assert pairs_seen == {("BTC", "27MAR26"), ("ETH", "27MAR26")}


@pytest.mark.asyncio
@respx.mock
async def test_fan_out_fetches_universe_when_none() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json=_stream_list())
    )
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200,
            json={
                "dimensions": [
                    {"symbol": "BTC", "expiry": "27MAR26"},
                    {"symbol": "ETH", "expiry": "28JUN26"},
                ],
                "dimensionCols": ["symbol", "expiry"],
            },
        )
    )
    snapshot_route = respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "ev", "rows_accepted": 2, "pipeline_rerun": True},
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        await client.push_fanned_snapshot(
            "ev",
            [SnapshotRow(timestamp="2026-01-01T00:00:00", raw_value=1.0, market_value=0.5)],
        )

    body = json.loads(snapshot_route.calls[-1].request.content.decode())
    pairs_seen = {(r["symbol"], r["expiry"]) for r in body["rows"]}
    assert pairs_seen == {("BTC", "27MAR26"), ("ETH", "28JUN26")}


@pytest.mark.asyncio
@respx.mock
async def test_fan_out_rejects_rows_carrying_symbol_expiry() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json=_stream_list())
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositValidationError, match="already carries"):
            await client.push_fanned_snapshot(
                "ev",
                [SnapshotRow(timestamp="2026-01-01T00:00:00",
                             raw_value=1.0, market_value=0.5,
                             symbol="BTC", expiry="27MAR26")],
                universe=[("BTC", "27MAR26")],
            )


@pytest.mark.asyncio
@respx.mock
async def test_fan_out_rejects_empty_universe() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json=_stream_list())
    )
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200,
            json={"dimensions": [], "dimensionCols": ["symbol", "expiry"]},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositValidationError, match="universe is empty"):
            await client.push_fanned_snapshot(
                "ev",
                [SnapshotRow(timestamp="2026-01-01T00:00:00",
                             raw_value=1.0, market_value=0.5)],
            )


@pytest.mark.asyncio
@respx.mock
async def test_fan_out_rejects_no_rows() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json=_stream_list())
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositValidationError, match="at least one row"):
            await client.push_fanned_snapshot("ev", [], universe=[("BTC", "27MAR26")])
