"""Tests for §7.1 diagnose_zero_positions()."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import PositClient


URL = "http://localhost:8000"


def _diag_payload(reason: str, symbol: str = "BTC", expiry: str = "2026-03-27T00:00:00") -> dict:
    return {
        "bankroll": 1000.0,
        "tickTimestamp": 1700000000000,
        "diagnostics": [
            {
                "symbol": symbol,
                "expiry": expiry,
                "rawEdge": 0.0,
                "rawVariance": 0.04,
                "desiredPos": 0.0,
                "totalFair": 0.42,
                "totalMarketFair": 0.42,
                "aggregateMarketValue": None,
                "reason": reason,
                "hint": "fix it by doing X",
            },
        ],
    }


@pytest.mark.asyncio
@respx.mock
async def test_diagnose_parses_no_market_value() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/diagnostics/zero-positions").mock(
        return_value=httpx.Response(200, json=_diag_payload("no_market_value"))
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.diagnose_zero_positions()
    assert resp.bankroll == 1000.0
    assert len(resp.diagnostics) == 1
    d = resp.diagnostics[0]
    assert d.symbol == "BTC"
    assert d.reason == "no_market_value"
    assert d.aggregate_market_value is None
    assert "X" in d.hint


@pytest.mark.asyncio
@respx.mock
async def test_diagnose_parses_all_reasons() -> None:
    for reason in [
        "no_market_value", "zero_variance", "zero_bankroll",
        "no_active_blocks", "edge_coincidence", "unknown",
    ]:
        respx.get(f"{URL}/api/streams").mock(
            return_value=httpx.Response(200, json={"streams": []})
        )
        respx.get(f"{URL}/api/diagnostics/zero-positions").mock(
            return_value=httpx.Response(200, json=_diag_payload(reason))
        )
        async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
            resp = await client.diagnose_zero_positions()
        assert resp.diagnostics[0].reason == reason


@pytest.mark.asyncio
@respx.mock
async def test_diagnose_empty_response() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/diagnostics/zero-positions").mock(
        return_value=httpx.Response(
            200,
            json={"bankroll": 1000.0, "tickTimestamp": None, "diagnostics": []},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.diagnose_zero_positions()
    assert resp.diagnostics == []
    assert resp.tick_timestamp is None


# ---------------------------------------------------------------------------
# Server-side classifier — direct tests
# ---------------------------------------------------------------------------

def _server_visible() -> bool:
    import os
    return os.path.exists(
        "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville/server/api/routers/diagnostics.py"
    )


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_classify_no_active_blocks_takes_precedence() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.diagnostics_classify import classify

    reason, _ = classify(
        desired_pos=0.0, raw_edge=0.0, raw_variance=0.0,
        total_fair=0.0, total_market_fair=0.0,
        aggregate_market_value=None,
        has_active_blocks=False, bankroll=1000.0,
    )
    assert reason == "no_active_blocks"


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_classify_zero_bankroll() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.diagnostics_classify import classify

    reason, _ = classify(
        desired_pos=0.0, raw_edge=0.5, raw_variance=0.04,
        total_fair=0.5, total_market_fair=0.0,
        aggregate_market_value=None,
        has_active_blocks=True, bankroll=0.0,
    )
    assert reason == "zero_bankroll"


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_classify_zero_variance() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.diagnostics_classify import classify

    reason, _ = classify(
        desired_pos=0.0, raw_edge=0.5, raw_variance=0.0,
        total_fair=0.5, total_market_fair=0.0,
        aggregate_market_value=None,
        has_active_blocks=True, bankroll=1000.0,
    )
    assert reason == "zero_variance"


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_classify_no_market_value() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.diagnostics_classify import classify

    # edge=0, no aggregate, fair==market (the footgun signature).
    reason, hint = classify(
        desired_pos=0.0, raw_edge=0.0, raw_variance=0.04,
        total_fair=0.42, total_market_fair=0.42,
        aggregate_market_value=None,
        has_active_blocks=True, bankroll=1000.0,
    )
    assert reason == "no_market_value"
    assert "market_value" in hint


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_classify_edge_coincidence_when_mv_set() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.diagnostics_classify import classify

    # edge=0 AND aggregate IS set → pipeline genuinely thinks fair = market.
    reason, _ = classify(
        desired_pos=0.0, raw_edge=0.0, raw_variance=0.04,
        total_fair=0.42, total_market_fair=0.42,
        aggregate_market_value=0.42,
        has_active_blocks=True, bankroll=1000.0,
    )
    assert reason == "edge_coincidence"


@pytest.mark.skipif(not _server_visible(), reason="server module not visible")
def test_classify_unknown_catch_all() -> None:
    import sys
    sys.path.insert(0, "/Users/seangong/conductor/workspaces/auto-mm-pilot/seville")
    from server.api.diagnostics_classify import classify

    reason, _ = classify(
        desired_pos=0.0, raw_edge=0.5, raw_variance=0.04,
        total_fair=0.5, total_market_fair=0.0,
        aggregate_market_value=None,
        has_active_blocks=True, bankroll=1000.0,
    )
    assert reason == "unknown"
