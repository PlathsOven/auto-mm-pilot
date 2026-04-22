"""Tests for Section 8 — REST positions + poll fallback."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient


URL = "http://localhost:8000"


def _payload(last_ts: int, pos_value: float = 100.0) -> dict:
    return {
        "streams": [],
        "context": {"lastUpdateTimestamp": last_ts},
        "positions": [
            {
                "symbol": "BTC",
                "expiry": "27MAR26",
                "edge": 1.0,
                "smoothedEdge": 1.0,
                "variance": 0.1,
                "smoothedVar": 0.1,
                "desiredPos": pos_value,
                "rawDesiredPos": pos_value,
                "currentPos": 0.0,
                "totalFair": 0.5,
                "totalMarketFair": 0.5,
                "changeMagnitude": 0.0,
                "updatedAt": last_ts,
            }
        ],
        "updates": [],
    }


@pytest.mark.asyncio
@respx.mock
async def test_get_positions_returns_latest() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/positions").mock(
        return_value=httpx.Response(200, json=_payload(1000, pos_value=42.0))
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        payload = await client.get_positions()
        assert len(payload.positions) == 1
        assert payload.positions[0].desired_pos == 42.0
        assert payload.transport == "poll"


@pytest.mark.asyncio
@respx.mock
async def test_positions_polls_when_ws_disabled() -> None:
    """connect_ws=False routes positions() through the polling path."""
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    # Three polls — value changes on the 2nd, stays the same on the 3rd.
    respx.get(f"{URL}/api/positions").mock(
        side_effect=[
            httpx.Response(200, json=_payload(1000, pos_value=10.0)),
            httpx.Response(200, json=_payload(2000, pos_value=20.0)),
            httpx.Response(200, json=_payload(3000, pos_value=20.0)),
        ]
    )

    received: list[float] = []
    transports: list[str | None] = []
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        it = client.positions(poll_interval=0.0)
        p1 = await anext(it); received.append(p1.positions[0].desired_pos); transports.append(p1.transport)
        p2 = await anext(it); received.append(p2.positions[0].desired_pos); transports.append(p2.transport)
        await it.aclose()

    assert received == [10.0, 20.0]
    assert transports == ["poll", "poll"]
