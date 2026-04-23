"""Tests for the connector surface — list / push / upsert."""
from __future__ import annotations

import httpx
import pytest
import respx

from posit_sdk import (
    ConnectorInputRow,
    PositClient,
    PositStreamNotRegistered,
    PositValidationError,
)


URL = "http://localhost:8000"


# ---------------------------------------------------------------------------
# Catalog payload reused across tests
# ---------------------------------------------------------------------------

_CATALOG = {
    "connectors": [
        {
            "name": "realized_vol",
            "display_name": "Realized Volatility",
            "description": "...",
            "input_key_cols": ["symbol"],
            "input_value_fields": [
                {"name": "price", "type": "float", "description": "spot price"},
            ],
            "output_unit_label": "annualized vol (fractional)",
            "params": [
                {
                    "name": "halflife_minutes",
                    "type": "int",
                    "default": 1440,
                    "description": "EWMA half-life",
                    "min": 1,
                    "max": None,
                },
                {
                    "name": "snapshot_lengths_seconds",
                    "type": "list_int",
                    "default": [1, 60, 3600],
                    "description": "Return horizons",
                    "min": 1,
                    "max": None,
                },
            ],
            "recommended_scale": 1.0,
            "recommended_offset": 0.0,
            "recommended_exponent": 2.0,
            "recommended_block": {
                "annualized": True,
                "temporal_position": "shifting",
                "decay_end_size_mult": 1.0,
                "decay_rate_prop_per_min": 0.0,
                "decay_profile": "linear",
                "var_fair_ratio": 1.0,
            },
        }
    ]
}


def _dims_mock() -> None:
    respx.get(f"{URL}/api/pipeline/dimensions").mock(
        return_value=httpx.Response(
            200, json={"dimensions": [], "dimensionCols": ["symbol", "expiry"]},
        )
    )


def _empty_streams_mock() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(200, json={"streams": []})
    )


# ---------------------------------------------------------------------------
# list_connectors
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_list_connectors_returns_typed_models() -> None:
    _empty_streams_mock()
    respx.get(f"{URL}/api/connectors").mock(
        return_value=httpx.Response(200, json=_CATALOG)
    )
    async with PositClient(url=URL, api_key="ok") as client:
        catalog = await client.list_connectors()
    assert len(catalog.connectors) == 1
    rv = catalog.connectors[0]
    assert rv.name == "realized_vol"
    assert rv.display_name == "Realized Volatility"
    assert rv.recommended_exponent == 2.0
    assert rv.recommended_block.annualized is True
    assert {p.name for p in rv.params} == {"halflife_minutes", "snapshot_lengths_seconds"}


# ---------------------------------------------------------------------------
# push_connector_input — REST path (WS not connected)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_push_connector_input_round_trip() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [{
                "stream_name": "rv_btc",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "connector_name": "realized_vol",
            }]},
        )
    )
    push_route = respx.post(f"{URL}/api/streams/rv_btc/connector-input").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "rv_btc",
                "rows_accepted": 2,
                "rows_emitted": 1,
                "pipeline_rerun": True,
                "server_seq": 7,
            },
        )
    )
    async with PositClient(url=URL, api_key="ok") as client:
        resp = await client.push_connector_input(
            "rv_btc",
            [
                ConnectorInputRow(timestamp="2026-01-01T00:00:00", symbol="BTC", price=100.0),
                ConnectorInputRow(timestamp="2026-01-01T00:00:01", symbol="BTC", price=100.5),
            ],
        )
    assert push_route.called
    assert resp.rows_accepted == 2
    assert resp.rows_emitted == 1
    assert resp.pipeline_rerun is True
    assert resp.server_seq == 7
    sent = push_route.calls[0].request.read().decode()
    assert "BTC" in sent
    assert "price" in sent


@pytest.mark.asyncio
@respx.mock
async def test_push_connector_input_unregistered_stream_raises() -> None:
    _empty_streams_mock()
    async with PositClient(url=URL, api_key="ok") as client:
        with pytest.raises(PositStreamNotRegistered):
            await client.push_connector_input(
                "nope",
                [ConnectorInputRow(timestamp="2026-01-01T00:00:00", symbol="BTC", price=100.0)],
            )


@pytest.mark.asyncio
@respx.mock
async def test_push_connector_input_user_fed_stream_surfaces_validation_error() -> None:
    respx.get(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            200,
            json={"streams": [{
                "stream_name": "manual_iv",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
            }]},
        )
    )
    respx.post(f"{URL}/api/streams/manual_iv/connector-input").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {
                "code": "STREAM_IS_NOT_CONNECTOR_FED",
                "stream": "manual_iv",
                "hint": "...",
            }},
        )
    )
    async with PositClient(url=URL, api_key="ok") as client:
        with pytest.raises(PositValidationError):
            await client.push_connector_input(
                "manual_iv",
                [ConnectorInputRow(timestamp="2026-01-01T00:00:00", symbol="BTC", price=100.0)],
            )


# ---------------------------------------------------------------------------
# upsert_connector_stream
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_upsert_connector_stream_create_and_configure() -> None:
    _empty_streams_mock()
    _dims_mock()
    respx.get(f"{URL}/api/connectors").mock(
        return_value=httpx.Response(200, json=_CATALOG)
    )
    create_route = respx.post(f"{URL}/api/streams").mock(
        return_value=httpx.Response(
            201,
            json={
                "stream_name": "rv_btc",
                "key_cols": ["symbol", "expiry"],
                "status": "PENDING",
            },
        )
    )
    configure_route = respx.post(f"{URL}/api/streams/rv_btc/configure").mock(
        return_value=httpx.Response(
            200,
            json={
                "stream_name": "rv_btc",
                "key_cols": ["symbol", "expiry"],
                "status": "READY",
                "scale": 1.0,
                "offset": 0.0,
                "exponent": 2.0,
                "connector_name": "realized_vol",
                "connector_params": {
                    "halflife_minutes": 60,
                    "snapshot_lengths_seconds": [1, 60, 3600],
                },
            },
        )
    )
    async with PositClient(url=URL, api_key="ok") as client:
        resp = await client.upsert_connector_stream(
            "rv_btc",
            "realized_vol",
            key_cols=["symbol", "expiry"],
            params={"halflife_minutes": 60},
        )
    assert create_route.called
    assert configure_route.called
    assert resp.connector_name == "realized_vol"
    assert resp.exponent == 2.0
    payload = configure_route.calls[0].request.read().decode()
    assert "realized_vol" in payload
    assert "halflife_minutes" in payload


@pytest.mark.asyncio
@respx.mock
async def test_upsert_connector_stream_unknown_connector_raises() -> None:
    _empty_streams_mock()
    respx.get(f"{URL}/api/connectors").mock(
        return_value=httpx.Response(200, json=_CATALOG)
    )
    async with PositClient(url=URL, api_key="ok") as client:
        with pytest.raises(PositValidationError, match="Unknown connector"):
            await client.upsert_connector_stream(
                "rv_btc",
                "made_up_connector",
                key_cols=["symbol", "expiry"],
            )
