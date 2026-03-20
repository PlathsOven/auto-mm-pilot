"""
Engine State Provider.

Singleton that exposes the current engine state, pipeline snapshot, and
snapshot buffer to the LLM service layer.

STATUS: PIPELINE — runs the real core pipeline from ``server.core`` using
mock scenario data.  When live data feeds replace the mock scenario, swap
out the stream configs and market pricing in ``_init()``.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import polars as pl

from server.api.config import OpenRouterConfig
from server.api.llm.snapshot_buffer import SnapshotBufferConfig, SnapshotRingBuffer
from server.core.mock_scenario import (
    MOCK_BANKROLL,
    MOCK_MARKET_PRICING,
    MOCK_NOW,
    MOCK_RISK_DIMENSION_COLS,
    MOCK_SMOOTHING_HL_SECS,
    MOCK_STREAMS,
    MOCK_TIME_GRID_INTERVAL,
)
from server.core.pipeline import run_pipeline
from server.core.serializers import engine_state_from_pipeline, snapshot_from_pipeline

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Singleton state
# ---------------------------------------------------------------------------

_snapshot_buffer: SnapshotRingBuffer | None = None
_pipeline_snapshot: dict[str, Any] | None = None
_engine_state: dict[str, Any] | None = None
_pipeline_results: dict[str, pl.DataFrame] | None = None
_mock_now: datetime = datetime(2026, 1, 1, 17, 0, 0)


# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------

def _init() -> None:
    """Run the real pipeline and initialize singleton state."""
    global _snapshot_buffer, _pipeline_snapshot, _engine_state, _pipeline_results

    log.info("Running core pipeline with mock scenario data…")

    _pipeline_results = run_pipeline(
        streams=MOCK_STREAMS,
        market_pricing=MOCK_MARKET_PRICING,
        risk_dimension_cols=MOCK_RISK_DIMENSION_COLS,
        now=MOCK_NOW,
        bankroll=MOCK_BANKROLL,
        smoothing_hl_secs=MOCK_SMOOTHING_HL_SECS,
        time_grid_interval=MOCK_TIME_GRID_INTERVAL,
    )

    log.info("Pipeline complete. Serializing snapshot at T=%s", _mock_now)

    _pipeline_snapshot = snapshot_from_pipeline(
        results=_pipeline_results,
        timestamp=_mock_now,
        risk_dimension_cols=MOCK_RISK_DIMENSION_COLS,
        bankroll=MOCK_BANKROLL,
        smoothing_hl_secs=MOCK_SMOOTHING_HL_SECS,
        now=MOCK_NOW,
    )

    _engine_state = engine_state_from_pipeline(
        results=_pipeline_results,
        timestamp=_mock_now,
        risk_dimension_cols=MOCK_RISK_DIMENSION_COLS,
    )

    config = OpenRouterConfig()
    buf_config = SnapshotBufferConfig(
        max_snapshots=config.snapshot_buffer_max,
        lookback_offsets_seconds=config.snapshot_lookback_offsets,
    )
    _snapshot_buffer = SnapshotRingBuffer(buf_config)
    _snapshot_buffer.push(_mock_now, _pipeline_snapshot)

    log.info("Engine state initialized from pipeline.")


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


def get_pipeline_results() -> dict[str, pl.DataFrame] | None:
    """Return the raw pipeline DataFrames (for WS/UI consumption)."""
    if _pipeline_results is None:
        _init()
    return _pipeline_results


def get_snapshot_buffer() -> SnapshotRingBuffer | None:
    """Return the snapshot ring buffer."""
    if _snapshot_buffer is None:
        _init()
    return _snapshot_buffer


def get_mock_now() -> datetime:
    """Return the mock 'now' timestamp used by the engine state provider."""
    return _mock_now
