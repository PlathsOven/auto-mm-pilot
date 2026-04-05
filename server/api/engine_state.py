"""
Engine State Provider.

Singleton that exposes the current engine state, pipeline snapshot, and
snapshot buffer to the LLM service layer.

Supports two modes:
  1. **Mock init** — runs the pipeline once at startup with mock scenario data
     (default, for development).
  2. **Live ingestion** — ``rerun_pipeline()`` rebuilds state from the
     stream registry + client-supplied market pricing & bankroll.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import polars as pl

from server.api.config import APT_MODE, SNAPSHOT_BUFFER_MAX_DEFAULT, SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT
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
# Server-side config (not client-settable)
# ---------------------------------------------------------------------------

RISK_DIMENSION_COLS: list[str] = list(MOCK_RISK_DIMENSION_COLS)
SMOOTHING_HL_SECS: int = MOCK_SMOOTHING_HL_SECS
TIME_GRID_INTERVAL: str = MOCK_TIME_GRID_INTERVAL

# ---------------------------------------------------------------------------
# Mutable state
# ---------------------------------------------------------------------------

_snapshot_buffer: SnapshotRingBuffer | None = None
_pipeline_snapshot: dict[str, Any] | None = None
_engine_state: dict[str, Any] | None = None
_pipeline_results: dict[str, pl.DataFrame] | None = None
_mock_now: datetime = datetime(2026, 1, 1, 17, 0, 0)

# Client-settable parameters (initialised from mock defaults)
_bankroll: float = MOCK_BANKROLL
_market_pricing: dict[str, float] = dict(MOCK_MARKET_PRICING)


# ---------------------------------------------------------------------------
# Mock initialization (development fallback)
# ---------------------------------------------------------------------------

def _init_mock() -> None:
    """Seed mock streams into the registry and run the pipeline.

    Uses ``rerun_pipeline()`` so the startup path and subsequent re-runs
    share the exact same code — mock streams live in the registry and
    are included in every future ``build_stream_configs()`` call.
    """
    log.info("Seeding mock streams into registry…")

    from server.api.stream_registry import get_stream_registry
    registry = get_stream_registry()
    for sc in MOCK_STREAMS:
        registry.seed_stream_config(sc)

    stream_configs = registry.build_stream_configs()
    if not stream_configs:
        log.error("No READY streams after seeding — mock init aborted")
        return

    rerun_pipeline(stream_configs)
    log.info("Engine state initialized from mock pipeline.")


# ---------------------------------------------------------------------------
# Live pipeline re-execution
# ---------------------------------------------------------------------------

def rerun_pipeline(
    streams: list[Any],
    market_pricing: dict[str, float] | None = None,
    bankroll: float | None = None,
) -> dict[str, pl.DataFrame]:
    """Re-run the full pipeline with the given streams and update all state.

    Parameters
    ----------
    streams : list[StreamConfig]
        Built from the stream registry (``registry.build_stream_configs()``).
    market_pricing : dict[str, float] | None
        If provided, merged into the stored market pricing.
    bankroll : float | None
        If provided, replaces the stored bankroll.

    Returns
    -------
    dict[str, pl.DataFrame]
        The raw pipeline results.

    Raises
    ------
    ValueError
        If ``streams`` is empty or the pipeline fails.
    """
    global _snapshot_buffer, _pipeline_snapshot, _engine_state, _pipeline_results, _bankroll, _market_pricing

    if not streams:
        raise ValueError("Cannot rerun pipeline with zero streams")

    if market_pricing is not None:
        _market_pricing.update(market_pricing)
    if bankroll is not None:
        _bankroll = bankroll

    now = MOCK_NOW if APT_MODE == "mock" else datetime.now(timezone.utc).replace(tzinfo=None)

    # Pick a time-grid interval that keeps total grid points manageable.
    # Target ~1500 points per instrument to stay under a few seconds.
    max_ttx_secs = 0.0
    for sc in streams:
        if "expiry" in sc.snapshot.columns:
            expiries = sc.snapshot["expiry"].unique().to_list()
            for exp in expiries:
                if hasattr(exp, "timestamp"):
                    ttx = (exp - now).total_seconds()
                    if ttx > max_ttx_secs:
                        max_ttx_secs = ttx

    if max_ttx_secs <= 2 * 86400:          # ≤ 2 days  → 1m  (up to 2880 pts)
        grid_interval = TIME_GRID_INTERVAL
    elif max_ttx_secs <= 30 * 86400:       # ≤ 30 days → 15m
        grid_interval = "15m"
    elif max_ttx_secs <= 365 * 86400:      # ≤ 1 year  → 1h
        grid_interval = "1h"
    else:                                   # > 1 year  → 4h
        grid_interval = "4h"

    log.info(
        "Re-running pipeline: %d streams, %d market prices, bankroll=%.2f, now=%s, interval=%s (max_ttx=%.0fs)",
        len(streams), len(_market_pricing), _bankroll, now, grid_interval, max_ttx_secs,
    )

    _pipeline_results = run_pipeline(
        streams=streams,
        market_pricing=_market_pricing,
        risk_dimension_cols=RISK_DIMENSION_COLS,
        now=now,
        bankroll=_bankroll,
        smoothing_hl_secs=SMOOTHING_HL_SECS,
        time_grid_interval=grid_interval,
    )

    _pipeline_snapshot = snapshot_from_pipeline(
        results=_pipeline_results,
        timestamp=now,
        risk_dimension_cols=RISK_DIMENSION_COLS,
        bankroll=_bankroll,
        smoothing_hl_secs=SMOOTHING_HL_SECS,
        now=now,
    )

    _engine_state = engine_state_from_pipeline(
        results=_pipeline_results,
        timestamp=now,
        risk_dimension_cols=RISK_DIMENSION_COLS,
    )

    # Push to snapshot buffer (create if first live run)
    if _snapshot_buffer is None:
        buf_config = SnapshotBufferConfig(
            max_snapshots=SNAPSHOT_BUFFER_MAX_DEFAULT,
            lookback_offsets_seconds=SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT,
        )
        _snapshot_buffer = SnapshotRingBuffer(buf_config)

    _snapshot_buffer.push(now, _pipeline_snapshot)

    log.info("Pipeline re-run complete at T=%s", now)
    return _pipeline_results


# ---------------------------------------------------------------------------
# Bankroll & market pricing accessors
# ---------------------------------------------------------------------------

def set_bankroll(value: float) -> None:
    """Update the bankroll (does NOT trigger a pipeline re-run)."""
    global _bankroll
    _bankroll = value
    log.info("Bankroll updated to %.2f", value)


def set_market_pricing(pricing: dict[str, float]) -> None:
    """Merge new entries into market pricing (does NOT trigger a pipeline re-run).

    Uses ``update()`` so that existing entries (e.g. mock pricing for
    "shifting" / "static_*") are preserved when clients add pricing for
    new space IDs.
    """
    global _market_pricing
    _market_pricing.update(pricing)
    log.info("Market pricing merged: %d new/updated entries, %d total", len(pricing), len(_market_pricing))


# ---------------------------------------------------------------------------
# Public API (unchanged signatures for existing consumers)
# ---------------------------------------------------------------------------

def _maybe_init() -> None:
    """Trigger mock init if in mock mode and state is uninitialized."""
    if APT_MODE == "mock" and _pipeline_results is None:
        _init_mock()


def get_engine_state() -> dict[str, Any]:
    """Return the current engine state dict."""
    _maybe_init()
    if _engine_state is None:
        return {}
    return _engine_state


def get_pipeline_snapshot() -> dict[str, Any] | None:
    """Return the current pipeline snapshot."""
    _maybe_init()
    return _pipeline_snapshot


def get_pipeline_results() -> dict[str, pl.DataFrame] | None:
    """Return the raw pipeline DataFrames (for WS/UI consumption)."""
    _maybe_init()
    return _pipeline_results


def get_snapshot_buffer() -> SnapshotRingBuffer | None:
    """Return the snapshot ring buffer."""
    _maybe_init()
    return _snapshot_buffer


def get_mock_now() -> datetime:
    """Return the mock 'now' timestamp used by the engine state provider."""
    return _mock_now
