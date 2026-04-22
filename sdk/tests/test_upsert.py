"""Tests for Section 6 — upsert_stream + bootstrap_streams."""
from __future__ import annotations

import warnings

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


# ---------------------------------------------------------------------------
# FutureWarning on deprecated two-phase API
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_create_stream_emits_future_warning() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    _dims_mock()
    respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            await client.create_stream("rv", key_cols=["symbol", "expiry"])
        future = [w for w in captured if issubclass(w.category, FutureWarning)]
        assert len(future) == 1
        assert "upsert_stream" in str(future[0].message)


@pytest.mark.asyncio
@respx.mock
async def test_configure_stream_emits_future_warning() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [
                {"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
            ]},
        )
    )
    respx.post(f"{URL}/api/streams/rv/configure").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "rv",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "scale": 1.0, "offset": 0.0, "exponent": 1.0,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            await client.configure_stream("rv", scale=1.0)
        future = [w for w in captured if issubclass(w.category, FutureWarning)]
        assert len(future) == 1


@pytest.mark.asyncio
@respx.mock
async def test_upsert_stream_does_not_emit_future_warning() -> None:
    """upsert_stream is the recommended path — it must not warn."""
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    _dims_mock()
    respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={"stream_name": "rv", "key_cols": ["symbol", "expiry"], "status": "PENDING"},
        )
    )
    respx.post(f"{URL}/api/streams/rv/configure").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "rv",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "scale": 1.0, "offset": 0.0, "exponent": 1.0,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            await client.upsert_stream("rv", key_cols=["symbol", "expiry"])
        future = [w for w in captured if issubclass(w.category, FutureWarning)]
        assert future == []


# ---------------------------------------------------------------------------
# Named factories — configure_stream_for_variance / _for_linear
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_configure_stream_for_variance_sets_exponent_2() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    _dims_mock()
    respx.post(f"{URL}/api/streams").mock(
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
                "scale": 1.0, "offset": 0.0, "exponent": 2.0,
            },
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.configure_stream_for_variance(
            "rv", key_cols=["symbol", "expiry"],
        )

    assert configure_route.called
    # Last configure request should have exponent=2.0.
    body = configure_route.calls[-1].request.content.decode()
    assert '"exponent":2.0' in body
    assert resp.exponent == 2.0


@pytest.mark.asyncio
@respx.mock
async def test_configure_stream_for_linear_sets_exponent_1() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    _dims_mock()
    respx.post(f"{URL}/api/streams").mock(
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
                "scale": 0.01, "offset": 0.0, "exponent": 1.0,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.configure_stream_for_linear(
            "rv", key_cols=["symbol", "expiry"], scale=0.01,
        )
    assert configure_route.called
    body = configure_route.calls[-1].request.content.decode()
    assert '"exponent":1.0' in body
    assert '"scale":0.01' in body
    assert resp.scale == 0.01
