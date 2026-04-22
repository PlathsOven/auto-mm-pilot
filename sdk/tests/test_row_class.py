"""Tests for §4.2 per-stream typed SnapshotRow classes."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient, SnapshotRow


URL = "http://localhost:8000"


def _stream_state(name: str, key_cols: list[str]) -> dict:
    return {
        "stream_name": name,
        "key_cols": key_cols,
        "status": "READY",
        "scale": 1.0, "offset": 0.0, "exponent": 1.0,
        "row_count": 0,
        "last_ingest_ts": None,
    }


@pytest.mark.asyncio
@respx.mock
async def test_row_class_for_declares_stream_key_cols() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/streams/evt").mock(
        return_value=httpx.Response(
            200,
            json=_stream_state("evt", ["symbol", "expiry", "event_id"]),
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        RowCls = await client.row_class_for("evt")
        assert issubclass(RowCls, SnapshotRow)
        # Required fields declared — constructing without them fails.
        with pytest.raises(Exception):
            RowCls(timestamp="2026-01-01T00:00:00", raw_value=1.0)
        # Fully populated works.
        row = RowCls(
            timestamp="2026-01-01T00:00:00",
            raw_value=1.0,
            market_value=0.5,
            symbol="BTC",
            expiry="27MAR26",
            event_id="FOMC",
        )
        assert row.model_dump()["symbol"] == "BTC"
        assert row.model_dump()["event_id"] == "FOMC"


@pytest.mark.asyncio
@respx.mock
async def test_row_class_is_cached_per_stream() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    describe_route = respx.get(f"{URL}/api/streams/evt").mock(
        return_value=httpx.Response(
            200, json=_stream_state("evt", ["symbol", "expiry"]),
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        A = await client.row_class_for("evt")
        B = await client.row_class_for("evt")
        assert A is B  # same class, not a re-build
        assert describe_route.call_count == 1  # server called once
