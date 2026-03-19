"""
Engine State Provider.

Singleton that exposes the current engine state, pipeline snapshot, and
snapshot buffer to the LLM service layer.

STATUS: MOCK — returns hardcoded data derived from test_investigation.py.
When the real pipeline in server/core/ is operational, replace the mock
functions with live reads from the pipeline output.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from server.api.config import OpenRouterConfig
from server.api.llm.snapshot_buffer import SnapshotBufferConfig, SnapshotRingBuffer


# ---------------------------------------------------------------------------
# Singleton state
# ---------------------------------------------------------------------------

_snapshot_buffer: SnapshotRingBuffer | None = None
_pipeline_snapshot: dict[str, Any] | None = None
_engine_state: dict[str, Any] | None = None
_mock_now: datetime = datetime(2026, 1, 1, 17, 0, 0)


# ---------------------------------------------------------------------------
# Mock data builders (from test_investigation.py)
# ---------------------------------------------------------------------------

def _build_mock_pipeline_snapshot() -> dict[str, Any]:
    """Hardcoded pipeline snapshot matching the notebook scenario at T=17:00."""
    return {
        "block_summary": [
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "rv",
                "stream_name": "rv",
                "space_id": "shifting",
                "aggregation_logic": "average",
                "raw_value": 0.45,
                "target_value": 0.2025,
                "target_market_value": 0.30250000000000005,
                "var_fair_ratio": 1.0,
                "annualized": True,
                "size_type": "fixed",
                "temporal_position": "shifting",
                "decay_end_size_mult": 1.0,
                "decay_rate_prop_per_min": 0.0,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "mean_iv",
                "stream_name": "mean_iv",
                "space_id": "shifting",
                "aggregation_logic": "offset",
                "raw_value": 0.5,
                "target_value": 0.25,
                "target_market_value": 0.30250000000000005,
                "var_fair_ratio": 2.0,
                "annualized": True,
                "size_type": "relative",
                "temporal_position": "shifting",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_0",
                "stream_name": "events",
                "space_id": "static_20260101_000000",
                "aggregation_logic": "offset",
                "raw_value": 2.5,
                "target_value": 0.0006250000000000001,
                "target_market_value": 9e-06,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_1",
                "stream_name": "events",
                "space_id": "static_20260101_040000",
                "aggregation_logic": "offset",
                "raw_value": 3.1,
                "target_value": 0.0009610000000000002,
                "target_market_value": 6.25e-06,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_2",
                "stream_name": "events",
                "space_id": "static_20260101_080000",
                "aggregation_logic": "offset",
                "raw_value": 1.8,
                "target_value": 0.00032400000000000007,
                "target_market_value": 1.6e-05,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_3",
                "stream_name": "events",
                "space_id": "static_20260101_120000",
                "aggregation_logic": "offset",
                "raw_value": 4.0,
                "target_value": 0.0016,
                "target_market_value": 1.2249999999999998e-05,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_4",
                "stream_name": "events",
                "space_id": "static_20260101_160000",
                "aggregation_logic": "offset",
                "raw_value": 2.0,
                "target_value": 0.0004,
                "target_market_value": 4e-06,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
        ],
        "current_agg": {
            "symbol": "BTC",
            "expiry": "2026-01-02 00:00:00",
            "timestamp": "2026-01-01 17:00:00",
            "total_fair": 4.3850102669404515e-06,
            "total_market_fair": 6.151387938246256e-07,
            "edge": 3.7698714731158265e-06,
            "var": 1.2385010266940453e-05,
        },
        "current_position": {
            "smoothed_edge": 2.2342497634247776e-06,
            "smoothed_var": 7.731552482277452e-06,
            "raw_desired_position": 30438.985449845102,
            "smoothed_desired_position": 28897.815394077796,
        },
        "scenario": {
            "bankroll": 100_000,
            "smoothing_hl_secs": 1800,
            "now": "2026-01-01 00:00:00",
            "risk_dimension": {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
            },
        },
    }


def _build_mock_engine_state() -> dict[str, Any]:
    """Mock engine state matching the investigation interface."""
    return {
        "positions": [
            {
                "asset": "BTC",
                "expiry": "2026-01-02",
                "desiredVega": 28897.82,
                "previousDesiredVega": 28500.00,
                "changeMagnitude": 397.82,
                "updatedAt": "2026-01-01T17:00:00Z",
            },
        ],
        "streams": [
            {"id": "stream-realized-vol", "status": "active", "lastUpdate": "2026-01-01T00:00:00Z"},
            {"id": "stream-scheduled-events", "status": "active", "lastUpdate": "2026-01-01T00:00:00Z"},
            {"id": "stream-historical-iv", "status": "active", "lastUpdate": "2025-12-31T18:00:00Z"},
            {"id": "stream-vol-flow", "status": "active", "lastUpdate": "2026-01-01T00:00:00Z"},
            {"id": "stream-correlation", "status": "active", "lastUpdate": "2025-12-31T23:00:00Z"},
        ],
        "context": {
            "operatingSpace": "BTC variance",
            "now": "2026-01-01T00:00:00Z",
            "riskDimensions": [{"symbol": "BTC", "expiry": "2026-01-02"}],
        },
    }


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------

def _init() -> None:
    """Initialize the singleton state from exported snapshots or mock data."""
    global _snapshot_buffer, _pipeline_snapshot, _engine_state

    config = OpenRouterConfig()
    buf_config = SnapshotBufferConfig(
        max_snapshots=config.snapshot_buffer_max,
        lookback_offsets_seconds=config.snapshot_lookback_offsets,
    )

    _pipeline_snapshot = _build_mock_pipeline_snapshot()
    _snapshot_buffer = SnapshotRingBuffer(buf_config)
    _snapshot_buffer.push(_mock_now, _pipeline_snapshot)

    _engine_state = _build_mock_engine_state()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_engine_state() -> dict[str, Any]:
    """Return the current engine state dict."""
    if _engine_state is None:
        _init()
    assert _engine_state is not None
    return _engine_state


def get_pipeline_snapshot() -> dict[str, Any] | None:
    """Return the current pipeline snapshot."""
    if _pipeline_snapshot is None:
        _init()
    return _pipeline_snapshot


def get_snapshot_buffer() -> SnapshotRingBuffer | None:
    """Return the snapshot ring buffer."""
    if _snapshot_buffer is None:
        _init()
    return _snapshot_buffer


def get_mock_now() -> datetime:
    """Return the mock 'now' timestamp used by the engine state provider."""
    return _mock_now
