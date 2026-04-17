"""
Mock scenario data for pipeline development and testing.

Provides the same stream definitions, scenario parameters, and market
pricing used in ``prototyping/mvp_new.ipynb``.  Import these to run
the pipeline with deterministic test data.
"""

from __future__ import annotations

import datetime as dt

import polars as pl

from server.core.config import BlockConfig, StreamConfig

# ── Scenario parameters ─────────────────────────────────────────────────

MOCK_NOW: dt.datetime = dt.datetime(2026, 1, 1)
MOCK_BANKROLL: float = 100_000
MOCK_SMOOTHING_HL_SECS: int = 60 * 30  # 30-minute EWM half-life
MOCK_TIME_GRID_INTERVAL: str = "1m"
MOCK_RISK_DIMENSION_COLS: list[str] = ["symbol", "expiry"]

# ── Stream definitions ──────────────────────────────────────────────────

_SYMBOL = "BTC"
_EXPIRY = dt.datetime(2026, 1, 2)

MOCK_RV_STREAM = StreamConfig(
    stream_name="rv",
    snapshot=pl.DataFrame({
        "timestamp": [MOCK_NOW],
        "symbol": [_SYMBOL],
        "expiry": [_EXPIRY],
        "raw_value": [0.45],
        "market_value": [0.55],
    }),
    key_cols=["symbol", "expiry"],
    scale=1.0, offset=0.0, exponent=2,
    block=BlockConfig(annualized=True),
)

MOCK_MEAN_IV_STREAM = StreamConfig(
    stream_name="mean_iv",
    snapshot=pl.DataFrame({
        "timestamp": [MOCK_NOW],
        "symbol": [_SYMBOL],
        "expiry": [_EXPIRY],
        "raw_value": [0.50],
        "market_value": [0.55],
    }),
    key_cols=["symbol", "expiry"],
    scale=1.0, offset=0.0, exponent=2,
    block=BlockConfig(
        annualized=True,
        aggregation_logic="offset",
        size_type="relative",
        decay_end_size_mult=0.0,
        decay_rate_prop_per_min=0.01,
        var_fair_ratio=2.0,
    ),
)

_NUM_EVENTS = 5
_EVENT_STARTS = [MOCK_NOW + dt.timedelta(hours=i * 4) for i in range(_NUM_EVENTS)]

MOCK_EVENTS_STREAM = StreamConfig(
    stream_name="events",
    snapshot=pl.DataFrame({
        "timestamp": [MOCK_NOW] * _NUM_EVENTS,
        "symbol": [_SYMBOL] * _NUM_EVENTS,
        "expiry": [_EXPIRY] * _NUM_EVENTS,
        "event_id": [f"event_{i}" for i in range(_NUM_EVENTS)],
        "raw_value": [2.5, 3.1, 1.8, 4.0, 2.0],
        "market_value": [0.30, 0.25, 0.40, 0.35, 0.20],
        "start_timestamp": _EVENT_STARTS,
    }),
    key_cols=["symbol", "expiry", "event_id"],
    scale=1 / 100, offset=0.0, exponent=2,
    block=BlockConfig(
        annualized=False,
        aggregation_logic="offset",
        temporal_position="static",
        decay_end_size_mult=0.0,
        decay_rate_prop_per_min=0.01,
        var_fair_ratio=3.0,
    ),
)

MOCK_STREAMS: list[StreamConfig] = [
    MOCK_RV_STREAM,
    MOCK_MEAN_IV_STREAM,
    MOCK_EVENTS_STREAM,
]

# Aggregate market values for testing — total vol per (symbol, expiry_str)
# Expiry is stored as a string (ISO format) matching the API representation.
MOCK_AGGREGATE_MARKET_VALUES: dict[tuple[str, str], float] = {
    (_SYMBOL, _EXPIRY.isoformat()): 0.55,
}
