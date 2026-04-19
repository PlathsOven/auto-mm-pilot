"""Tests for Section 7 — describe_stream + health."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositApiError, PositClient


URL = "http://localhost:8000"


@pytest.mark.asyncio
@respx.mock
async def test_health_returns_status() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok"})
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.health()
        assert resp.status == "ok"


@pytest.mark.asyncio
@respx.mock
async def test_describe_stream_returns_full_state() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/streams/rv").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "rv",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "scale": 1.5,
                "offset": 0.0,
                "exponent": 2.0,
                "block": {
                    "annualized": True,
                    "size_type": "fixed",
                    "aggregation_logic": "average",
                    "temporal_position": "shifting",
                    "decay_end_size_mult": 1.0,
                    "decay_rate_prop_per_min": 0.0,
                    "decay_profile": "linear",
                    "var_fair_ratio": 1.0,
                },
                "row_count": 42,
                "last_ingest_ts": "2026-04-19T12:00:00",
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        state = await client.describe_stream("rv")
        assert state.stream_name == "rv"
        assert state.status == "READY"
        assert state.row_count == 42
        assert state.last_ingest_ts == "2026-04-19T12:00:00"
        assert state.scale == 1.5
        assert state.exponent == 2.0
        assert state.block is not None and state.block.annualized is True


@pytest.mark.asyncio
@respx.mock
async def test_describe_stream_404s_when_absent() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/streams/nope").mock(
        return_value=httpx.Response(404, json={"detail": "Stream 'nope' not found"})
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositApiError) as exc_info:
            await client.describe_stream("nope")
        assert exc_info.value.status_code == 404
