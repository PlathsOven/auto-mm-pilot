"""Tests for Section 4 — client-side argument validation."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import (
    BlockConfig,
    MarketValueEntry,
    PositClient,
    PositValidationError,
    SnapshotRow,
)


URL = "http://localhost:8000"


# ---------------------------------------------------------------------------
# BlockConfig cross-field rules (mirror server `__post_init__`)
# ---------------------------------------------------------------------------

def test_blockconfig_rejects_non_annualized_with_decay_end_size_mult() -> None:
    """Default decay_end_size_mult=1.0 incompatible with annualized=False."""
    with pytest.raises(ValueError, match="decay_end_size_mult"):
        BlockConfig(annualized=False)


def test_blockconfig_accepts_non_annualized_with_zero_decay() -> None:
    cfg = BlockConfig(annualized=False, decay_end_size_mult=0.0)
    assert cfg.annualized is False


def test_blockconfig_rejects_relative_non_annualized() -> None:
    with pytest.raises(ValueError, match="relative"):
        BlockConfig(size_type="relative", annualized=False, decay_end_size_mult=0.0)


def test_blockconfig_rejects_negative_decay_rate() -> None:
    with pytest.raises(ValueError):
        BlockConfig(decay_rate_prop_per_min=-0.1)


# ---------------------------------------------------------------------------
# SnapshotRow.timestamp parseability
# ---------------------------------------------------------------------------

def test_snapshot_row_accepts_iso_timestamp() -> None:
    row = SnapshotRow(timestamp="2026-03-27T00:00:00", raw_value=1.0)
    assert row.timestamp == "2026-03-27T00:00:00"


def test_snapshot_row_accepts_ddmmmyy() -> None:
    row = SnapshotRow(timestamp="27MAR26", raw_value=1.0)
    assert row.timestamp == "27MAR26"


def test_snapshot_row_rejects_garbage_timestamp() -> None:
    with pytest.raises(ValueError, match="timestamp"):
        SnapshotRow(timestamp="yesterday", raw_value=1.0)


# ---------------------------------------------------------------------------
# MarketValueEntry — Pydantic-enforced floor
# ---------------------------------------------------------------------------

def test_market_value_entry_rejects_negative_vol() -> None:
    with pytest.raises(ValueError):
        MarketValueEntry(symbol="BTC", expiry="27MAR26", total_vol=-0.01)


# ---------------------------------------------------------------------------
# create_stream validates key_cols against server risk dimensions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_create_stream_rejects_missing_risk_dim() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200,
            json={"dimensions": [], "dimensionCols": ["symbol", "expiry"]},
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositValidationError, match="expiry"):
            await client.create_stream("events", key_cols=["symbol", "event_id"])


@pytest.mark.asyncio
@respx.mock
async def test_create_stream_rejects_empty_key_cols() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositValidationError, match="non-empty"):
            await client.create_stream("s", key_cols=[])


@pytest.mark.asyncio
@respx.mock
async def test_create_stream_rejects_duplicate_key_cols() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        with pytest.raises(PositValidationError, match="duplicate"):
            await client.create_stream("s", key_cols=["symbol", "symbol"])


@pytest.mark.asyncio
@respx.mock
async def test_create_stream_passes_when_key_cols_cover_dims() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200,
            json={"dimensions": [], "dimensionCols": ["symbol", "expiry"]},
        )
    )
    respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={
                "stream_name": "rv",
                "key_cols": ["symbol", "expiry"],
                "status": "PENDING",
            },
        )
    )

    async with PositClient(url=URL, api_key="ok", connect_ws=False) as client:
        resp = await client.create_stream("rv", key_cols=["symbol", "expiry"])
        assert resp.status == "PENDING"
