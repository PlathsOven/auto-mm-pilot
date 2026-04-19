"""Tests for Section 5 — one-shot market_value WARN per stream."""
from __future__ import annotations

import logging

import httpx
import pytest
import respx

from posit_sdk import PositClient, SnapshotRow


URL = "http://localhost:8000"


def _row(i: int, *, market_value: float | None = None) -> SnapshotRow:
    return SnapshotRow(
        timestamp=f"2026-01-01T00:00:{i:02d}",
        raw_value=1.0,
        market_value=market_value,
        symbol="BTC",
        expiry="27MAR26",
    )


@pytest.mark.asyncio
@respx.mock
async def test_warn_fires_once_per_stream_when_market_value_missing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 10, "pipeline_rerun": True},
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with caplog.at_level(logging.WARNING, logger="posit_sdk.client"):
            await client.ingest_snapshot("rv", [_row(i) for i in range(10)])
            await client.ingest_snapshot("rv", [_row(i + 10) for i in range(10)])

        mv_warnings = [
            r for r in caplog.records
            if r.levelno == logging.WARNING and "market_value" in r.getMessage()
        ]
        assert len(mv_warnings) == 1
        assert "'rv'" in mv_warnings[0].getMessage()
        assert "10" in mv_warnings[0].getMessage()


@pytest.mark.asyncio
@respx.mock
async def test_no_warn_when_market_value_present(
    caplog: pytest.LogCaptureFixture,
) -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "rv", "rows_accepted": 1, "pipeline_rerun": False},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with caplog.at_level(logging.WARNING, logger="posit_sdk.client"):
            await client.ingest_snapshot("rv", [_row(0, market_value=0.5)])
        mv_warnings = [
            r for r in caplog.records if "market_value" in r.getMessage()
        ]
        assert mv_warnings == []


@pytest.mark.asyncio
@respx.mock
async def test_warn_separate_per_stream(
    caplog: pytest.LogCaptureFixture,
) -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.post(f"{URL}/api/snapshots").mock(
        return_value=httpx.Response(
            200,
            json={"stream_name": "s", "rows_accepted": 1, "pipeline_rerun": False},
        )
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with caplog.at_level(logging.WARNING, logger="posit_sdk.client"):
            await client.ingest_snapshot("s1", [_row(0)])
            await client.ingest_snapshot("s2", [_row(1)])
        mv_warnings = [
            r for r in caplog.records if "market_value" in r.getMessage()
        ]
        assert len(mv_warnings) == 2
