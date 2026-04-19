"""Tests for Section 6 — upsert_stream + bootstrap_streams."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import BlockConfig, PositClient, StreamSpec


URL = "http://localhost:8000"


def _dims_mock() -> None:
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200, json={"dimensions": [], "dimensionCols": ["symbol", "expiry"]},
        )
    )


@pytest.mark.asyncio
@respx.mock
async def test_upsert_creates_when_absent() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    _dims_mock()
    create_route = respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
        )
    )
    configure_route = respx.post(f"{URL}/api/streams/rv/configure").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "rv",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "scale": 1.0,
                "offset": 0.0,
                "exponent": 1.0,
            },
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.upsert_stream("rv", key_cols=["symbol", "expiry"])

    assert create_route.called
    assert configure_route.called
    assert resp.status == "READY"


@pytest.mark.asyncio
@respx.mock
async def test_upsert_reconfigures_when_key_cols_match() -> None:
    existing = {
        "stream_name": "rv",
        "key_cols": ["symbol", "expiry"],
        "status": "READY",
        "scale": 1.0,
        "offset": 0.0,
        "exponent": 1.0,
    }
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": [existing]})
    )
    _dims_mock()
    create_route = respx.post(f"{URL}/api/streams")
    delete_route = respx.delete(f"{URL}/api/streams/rv")
    configure_route = respx.post(f"{URL}/api/streams/rv/configure").mock(
        return_value=httpx.Response(200, json=existing)
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        await client.upsert_stream(
            "rv", key_cols=["symbol", "expiry"], scale=2.0,
        )

    assert not create_route.called
    assert not delete_route.called
    assert configure_route.called


@pytest.mark.asyncio
@respx.mock
async def test_upsert_recreates_when_key_cols_change() -> None:
    existing = {
        "stream_name": "evt",
        "key_cols": ["symbol", "expiry"],
        "status": "READY",
        "scale": 1.0,
        "offset": 0.0,
        "exponent": 1.0,
    }
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": [existing]})
    )
    _dims_mock()
    delete_route = respx.delete(f"{URL}/api/streams/evt").mock(
        return_value=httpx.Response(204)
    )
    create_route = respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={
                "stream_name": "evt",
                "key_cols": ["symbol", "expiry", "event_id"],
                "status": "PENDING",
            },
        )
    )
    configure_route = respx.post(f"{URL}/api/streams/evt/configure").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "evt",
                "key_cols": ["symbol", "expiry", "event_id"],
                "status": "READY",
                "scale": 1.0,
                "offset": 0.0,
                "exponent": 1.0,
            },
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.upsert_stream(
            "evt", key_cols=["symbol", "expiry", "event_id"],
        )

    assert delete_route.called
    assert create_route.called
    assert configure_route.called
    assert resp.key_cols == ["symbol", "expiry", "event_id"]


@pytest.mark.asyncio
@respx.mock
async def test_bootstrap_streams_rolls_back_created_on_failure() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    _dims_mock()

    # s1: create + configure succeed.
    respx.post(f"{URL}/api/streams", name="create_all").mock(
        side_effect=[
            httpx.Response(
                201,
                json={"stream_name": "s1", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
            ),
            httpx.Response(
                201,
                json={"stream_name": "s2", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
            ),
        ]
    )
    respx.post(f"{URL}/api/streams/s1/configure").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "s1",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "scale": 1.0,
                "offset": 0.0,
                "exponent": 1.0,
            },
        )
    )
    # s2 configure fails → should trigger rollback of both s1 and s2.
    respx.post(f"{URL}/api/streams/s2/configure").mock(
        return_value=httpx.Response(422, json={"detail": "boom"})
    )
    delete_s1 = respx.delete(f"{URL}/api/streams/s1").mock(
        return_value=httpx.Response(204)
    )
    delete_s2 = respx.delete(f"{URL}/api/streams/s2").mock(
        return_value=httpx.Response(204)
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(Exception):
            await client.bootstrap_streams([
                StreamSpec(stream_name="s1", key_cols=["symbol", "expiry"]),
                StreamSpec(stream_name="s2", key_cols=["symbol", "expiry"]),
            ])

    assert delete_s1.called
    assert delete_s2.called


def test_stream_spec_rejects_duplicate_key_cols() -> None:
    with pytest.raises(ValueError):
        StreamSpec(stream_name="x", key_cols=["symbol", "symbol"])


def test_stream_spec_accepts_block_config() -> None:
    spec = StreamSpec(
        stream_name="x",
        key_cols=["symbol", "expiry"],
        block=BlockConfig(annualized=True, decay_end_size_mult=0.5),
    )
    assert spec.block is not None
    assert spec.block.annualized is True
