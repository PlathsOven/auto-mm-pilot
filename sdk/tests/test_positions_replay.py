"""Tests for §9.2 positions replay + seq gap detection."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient


URL = "http://localhost:8000"


def _payload_dict(seq: int, prev_seq: int) -> dict:
    return {
        "streams": [],
        "context": {"lastUpdateTimestamp": 1000 + seq},
        "positions": [],
        "updates": [],
        "seq": seq,
        "prevSeq": prev_seq,
    }


@pytest.mark.asyncio
@respx.mock
async def test_positions_since_returns_replay_list() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/positions/since/42").mock(
        return_value=httpx.Response(
            200,
            json={
                "payloads": [_payload_dict(43, 42), _payload_dict(44, 43)],
                "gapDetected": False,
                "latestSeq": 44,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.positions_since(42)
    assert resp.latest_seq == 44
    assert resp.gap_detected is False
    assert len(resp.payloads) == 2
    assert resp.payloads[0].seq == 43
    assert resp.payloads[0].prev_seq == 42
    assert resp.payloads[1].seq == 44


@pytest.mark.asyncio
@respx.mock
async def test_positions_since_reports_gap_when_buffer_dropped() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/positions/since/1").mock(
        return_value=httpx.Response(
            200,
            json={
                "payloads": [_payload_dict(10, 9), _payload_dict(11, 10)],
                "gapDetected": True,
                "latestSeq": 11,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.positions_since(1)
    assert resp.gap_detected is True
    assert resp.payloads[0].seq == 10


@pytest.mark.asyncio
@respx.mock
async def test_position_payload_parses_seq_fields() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/positions").mock(
        return_value=httpx.Response(200, json=_payload_dict(5, 4)),
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        payload = await client.get_positions()
    assert payload.seq == 5
    assert payload.prev_seq == 4
