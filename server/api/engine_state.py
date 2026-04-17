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

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import polars as pl

from server.api.config import POSIT_MODE, SNAPSHOT_BUFFER_MAX_DEFAULT, SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT
from server.api.llm.snapshot_buffer import SnapshotBufferConfig, SnapshotRingBuffer
from server.core.mock_scenario import (
    MOCK_AGGREGATE_MARKET_VALUES,
    MOCK_BANKROLL,
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
_transform_config: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Mock initialization
# ---------------------------------------------------------------------------

def init_mock() -> None:
    """Seed mock streams into the registry and run the pipeline.

    Called once at server startup from the FastAPI lifespan handler. Uses
    ``rerun_pipeline()`` so the startup path and subsequent re-runs share
    the exact same code — mock streams live in the registry and are
    included in every future ``build_stream_configs()`` call.
    """
    log.info("Seeding mock streams into registry…")

    from server.api.stream_registry import get_stream_registry
    registry = get_stream_registry()
    for sc in MOCK_STREAMS:
        registry.seed_stream_config(sc)

    # Seed mock aggregate market values into the store
    from server.api.market_value_store import set_market_value, clear_dirty
    for (symbol, expiry), total_vol in MOCK_AGGREGATE_MARKET_VALUES.items():
        set_market_value(symbol, expiry, total_vol)
    clear_dirty()  # Don't trigger a dirty rerun on startup

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
    bankroll: float | None = None,
    transform_config: dict[str, Any] | None = None,
) -> dict[str, pl.DataFrame]:
    """Re-run the full pipeline with the given streams and update all state.

    Parameters
    ----------
    streams : list[StreamConfig]
        Built from the stream registry (``registry.build_stream_configs()``).
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
    global _snapshot_buffer, _pipeline_snapshot, _engine_state, _pipeline_results, _bankroll, _transform_config

    if not streams:
        raise ValueError("Cannot rerun pipeline with zero streams")

    if bankroll is not None:
        _bankroll = bankroll
    if transform_config is not None:
        _transform_config = transform_config

    now = MOCK_NOW if POSIT_MODE == "mock" else datetime.now(timezone.utc).replace(tzinfo=None)

    log.info(
        "Re-running pipeline: %d streams, bankroll=%.2f, now=%s, default_interval=%s",
        len(streams), _bankroll, now, TIME_GRID_INTERVAL,
    )

    from server.api.market_value_store import to_dict as mv_to_dict
    _pipeline_results = run_pipeline(
        streams=streams,
        risk_dimension_cols=RISK_DIMENSION_COLS,
        now=now,
        bankroll=_bankroll,
        smoothing_hl_secs=SMOOTHING_HL_SECS,
        time_grid_interval=TIME_GRID_INTERVAL,
        transform_config=_transform_config,
        aggregate_market_values=mv_to_dict(),
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


def get_bankroll() -> float:
    """Return the current bankroll."""
    return _bankroll


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_engine_state() -> dict[str, Any]:
    """Return the current engine state dict."""
    if _engine_state is None:
        return {}
    return _engine_state


def get_pipeline_snapshot() -> dict[str, Any] | None:
    """Return the current pipeline snapshot."""
    return _pipeline_snapshot


def get_pipeline_results() -> dict[str, pl.DataFrame] | None:
    """Return the raw pipeline DataFrames (for WS/UI consumption)."""
    return _pipeline_results


def get_snapshot_buffer() -> SnapshotRingBuffer | None:
    """Return the snapshot ring buffer."""
    return _snapshot_buffer


def get_mock_now() -> datetime:
    """Return the mock 'now' timestamp used by the engine state provider."""
    return _mock_now


def get_transform_config() -> dict[str, Any] | None:
    """Return the current transform configuration dict."""
    return _transform_config


def set_transform_config(config: dict[str, Any]) -> None:
    """Update the stored transform configuration."""
    global _transform_config
    _transform_config = config
    log.info("Transform config updated: %s", list(config.keys()))


# ---------------------------------------------------------------------------
# Atomic rerun + broadcast helper
# ---------------------------------------------------------------------------

async def rerun_and_broadcast(
    stream_configs: list,
    *,
    bankroll: float | None = None,
    transform_config: dict | None = None,
) -> None:
    """Re-run the pipeline and restart the WS ticker as an atomic pair.

    Every code path that previously called ``rerun_pipeline`` followed
    by ``restart_ticker`` must call this instead.  Forgetting the
    second call leaves the UI showing stale data.

    The ticker restart import is done lazily to avoid circular imports
    between ``engine_state`` and ``ws``.
    """
    # Lazy import — hoisting to module top triggers a circular import
    # (engine_state → ws → engine_state).
    from server.api.ws import restart_ticker

    kwargs: dict[str, Any] = {}
    if bankroll is not None:
        kwargs["bankroll"] = bankroll
    if transform_config is not None:
        kwargs["transform_config"] = transform_config

    await asyncio.to_thread(rerun_pipeline, stream_configs, **kwargs)
    await restart_ticker()
