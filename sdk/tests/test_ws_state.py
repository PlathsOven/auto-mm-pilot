"""Tests for Section 1 — WS state machine + auth hard-block + REST fallback."""
from __future__ import annotations

import asyncio
import logging

import httpx
import pytest
import respx

from posit_sdk import (
    PositAuthError,
    PositClient,
    PositConnectionError,
    SnapshotRow,
    WsState,
)
from posit_sdk.ws import WsClient


URL = "http://localhost:8000"


# ---------------------------------------------------------------------------
# __aenter__ auth hard-block
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_aenter_raises_on_bad_rest_auth() -> None:
    """A 401 on the auth probe raises PositAuthError before the user touches anything."""
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(401, json={"detail": "Invalid or missing API key"})
    )
    client = PositClient(url=URL, api_key="bad", connect_ws=False)
    with pytest.raises(PositAuthError):
        await client.__aenter__()


@pytest.mark.asyncio
@respx.mock
async def test_aenter_succeeds_on_good_rest_auth() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        assert client._ws is None  # REST-only
        assert client._rest is not None


# ---------------------------------------------------------------------------
# WsClient.state transitions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ws_state_starts_closed() -> None:
    ws = WsClient("ws://localhost:9/ws/client", "k")
    assert ws.state is WsState.CLOSED
    assert ws.last_error is None


@pytest.mark.asyncio
async def test_ws_wait_until_open_raises_on_failed_auth_terminal() -> None:
    """If the loop already set FAILED_AUTH, wait_until_open raises immediately."""
    ws = WsClient("ws://localhost:9/ws/client", "k")
    ws.state = WsState.FAILED_AUTH
    ws.last_error = PositAuthError("rejected")
    with pytest.raises(PositAuthError):
        await ws.wait_until_open(timeout=0.1)


@pytest.mark.asyncio
async def test_ws_wait_until_open_returns_if_already_open() -> None:
    ws = WsClient("ws://localhost:9/ws/client", "k")
    ws.state = WsState.OPEN
    ws._ready.set()
    await ws.wait_until_open(timeout=0.1)  # should not raise


@pytest.mark.asyncio
async def test_ws_wait_until_open_times_out() -> None:
    ws = WsClient("ws://localhost:9/ws/client", "k")
    # state stays CONNECTING, _ready never fires
    with pytest.raises(PositConnectionError):
        await ws.wait_until_open(timeout=0.05)


# ---------------------------------------------------------------------------
# REST fallback when WS is not OPEN
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_push_snapshot_falls_back_to_rest_when_ws_down(
    caplog: pytest.LogCaptureFixture,
) -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": True},
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        assert client._ws_state() is WsState.CLOSED
        with caplog.at_level(logging.WARNING, logger="posit_sdk.client"):
            ack = await client.push_snapshot(
                "rv",
                [SnapshotRow(timestamp="2026-01-01T00:00:00Z", raw_value=1.0, symbol="BTC", expiry="27MAR26")],
            )
        assert ack.rows_accepted == 1
        assert ack.pipeline_rerun is True
        # One WARN per state transition — exactly one while state stays CLOSED.
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1

        # Second push: same state, no new WARN.
        respx.post(f"{URL}/api/snapshots").mock(
            return_value=httpx.Response(
                200,
                json={"stream_name": "rv", "rows_accepted": 2, "pipeline_rerun": False},
            )
        )
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger="posit_sdk.client"):
            await client.push_snapshot(
                "rv",
                [SnapshotRow(timestamp="2026-01-01T00:00:01Z", raw_value=2.0, symbol="BTC", expiry="27MAR26")],
            )
        assert not any(r.levelno == logging.WARNING for r in caplog.records)
