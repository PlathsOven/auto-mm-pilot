"""Unit tests for the realized-vol connector math.

Covers:
* Constant prices → ``avg_rv ≈ 0`` after warmup.
* Geometric Brownian motion with known σ → estimator converges to σ.
* Step-change spike → variance bursts in the shortest horizon, decays per
  the configured halflife.
* Irregular sampling → annualisation uses the actual elapsed time, not the
  nominal horizon length.
* Multiple horizons → each warms independently; ``avg_rv`` is the mean.
* Warmup behaviour → no emission until the shortest horizon spans one
  full interval.
* Out-of-order tick → raises ValueError.
* Non-positive price → raises ValueError.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta

import pytest

from server.core.config import SECONDS_PER_YEAR
from server.core.connectors import resolve_params
from server.core.connectors.realized_vol import (
    N_EFF_WARMUP_THRESHOLD,
    REALIZED_VOL_CONNECTOR,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CONNECTOR = REALIZED_VOL_CONNECTOR


def _params(**overrides) -> dict:
    """Resolve params using the same path the API layer uses."""
    return resolve_params(CONNECTOR.params, overrides or None)


def _row(ts: datetime, symbol: str, price: float) -> dict:
    return {"timestamp": ts.isoformat(), "symbol": symbol, "price": price}


def _push(state, params, rows):
    return CONNECTOR.process(state, list(rows), params)


# ---------------------------------------------------------------------------
# Constant price → zero realized vol
# ---------------------------------------------------------------------------

def test_constant_price_yields_zero_rv() -> None:
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)

    start = datetime(2026, 1, 1)
    rows = [_row(start + timedelta(seconds=i), "BTC", 100.0) for i in range(50)]
    state, emitted = _push(state, params, rows)

    assert emitted, "constant prices still cross the emission threshold once warmed"
    # Every emission after warmup is a zero — sqrt(0) = 0.
    assert all(r["raw_value"] == 0.0 for r in emitted)
    summary = CONNECTOR.state_summary(state)
    assert summary.symbols_tracked == 1
    assert summary.min_n_eff >= N_EFF_WARMUP_THRESHOLD


# ---------------------------------------------------------------------------
# GBM with known σ — estimator should converge.
# ---------------------------------------------------------------------------

def test_gbm_estimator_converges_to_sigma() -> None:
    # σ = 50% annualised. One return per second for ~3 hours → 10800 samples.
    sigma = 0.5
    dt = 1.0  # seconds
    sigma_per_step = sigma * math.sqrt(dt / SECONDS_PER_YEAR)
    rng = random.Random(42)

    # Long halflife so the EWMA approaches a simple unweighted average.
    params = _params(
        halflife_minutes=24 * 60 * 30,
        snapshot_lengths_seconds=[1],
    )
    state = CONNECTOR.initial_state(params)

    start = datetime(2026, 1, 1)
    price = 100.0
    rows = []
    for i in range(10800):
        log_return = rng.gauss(0.0, sigma_per_step)
        price = price * math.exp(log_return)
        rows.append(_row(start + timedelta(seconds=i + 1), "BTC", price))

    state, emitted = _push(state, params, rows)
    assert emitted, "GBM feed should produce emissions"
    final_rv = emitted[-1]["raw_value"]
    # 10% relative tolerance — single-horizon EWMA on a single seed is noisy.
    assert abs(final_rv - sigma) / sigma < 0.10, (
        f"GBM estimator {final_rv:.4f} should be within 10% of σ={sigma}"
    )


# ---------------------------------------------------------------------------
# Step change spike → variance jumps then decays per the halflife.
# ---------------------------------------------------------------------------

def test_step_change_spike_decays_per_halflife() -> None:
    """One spike against a steady-state-warmed EWMA decays by ~1/2 per halflife.

    With ``n_eff`` near its steady-state value ``1/(1-decay)`` the post-spike
    flat ticks (zero-return) shrink the EWMA by approximately ``decay`` per
    tick. After ``halflife`` seconds at 1-second cadence: ``decay^halflife =
    exp(-halflife · ln2 / halflife) = 1/2``. The spike's annualised variance
    halves; the emitted ``avg_rv`` (a square-root) drops by ``1/√2``.
    """
    halflife_min = 1
    halflife_seconds = halflife_min * 60
    params = _params(
        halflife_minutes=halflife_min,
        snapshot_lengths_seconds=[1],
    )
    state = CONNECTOR.initial_state(params)

    # Warm n_eff to near steady state (10× halflife is ≥ 99.9% saturated).
    start = datetime(2026, 1, 1)
    warmup_seconds = halflife_seconds * 10
    warmup = [_row(start + timedelta(seconds=i), "BTC", 100.0) for i in range(warmup_seconds)]
    state, _ = _push(state, params, warmup)

    spike_ts = start + timedelta(seconds=warmup_seconds)
    state, spike_emit = _push(state, params, [_row(spike_ts, "BTC", 101.0)])
    assert spike_emit, "step jump should emit an updated rv"
    rv_at_spike = spike_emit[-1]["raw_value"]
    assert rv_at_spike > 0, f"expected positive rv at spike, got {rv_at_spike}"

    later = [_row(spike_ts + timedelta(seconds=i), "BTC", 101.0) for i in range(1, halflife_seconds + 1)]
    state, late_emit = _push(state, params, later)
    rv_after_halflife = late_emit[-1]["raw_value"]

    expected_ratio = 1.0 / math.sqrt(2.0)
    actual_ratio = rv_after_halflife / rv_at_spike
    assert abs(actual_ratio - expected_ratio) < 0.05, (
        f"vol ratio after one halflife was {actual_ratio:.4f}, expected ~{expected_ratio:.4f}"
    )


# ---------------------------------------------------------------------------
# Irregular sampling — annualisation uses real elapsed time.
# ---------------------------------------------------------------------------

def test_irregular_sampling_uses_actual_elapsed() -> None:
    # Snapshot length = 1 second. Push at 0.0s, 0.3s, 0.7s, 1.1s.
    # Only the row at 1.1s should trigger an EWMA update (elapsed = 1.1s,
    # > 1.0s threshold); the others fall short of the horizon.
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)

    start = datetime(2026, 1, 1)
    rows = [
        _row(start, "BTC", 100.0),
        _row(start + timedelta(milliseconds=300), "BTC", 100.5),
        _row(start + timedelta(milliseconds=700), "BTC", 100.7),
        _row(start + timedelta(milliseconds=1100), "BTC", 101.0),
    ]
    state, emitted = _push(state, params, rows)
    assert len(emitted) == 1, "exactly one emission — only the 1.1s row clears the horizon"

    # Verify annualisation uses 1.1s, not the nominal 1.0s. Reproduce the
    # math the connector should have applied.
    sym = state.per_symbol["BTC"]
    ls = sym.per_length[1]
    expected_log_ret = math.log(101.0 / 100.0)
    expected_var = expected_log_ret * expected_log_ret * (SECONDS_PER_YEAR / 1.1)
    assert math.isclose(ls.ewma_ann_var, expected_var, rel_tol=1e-12)
    assert math.isclose(emitted[-1]["raw_value"], math.sqrt(expected_var), rel_tol=1e-12)


# ---------------------------------------------------------------------------
# Multiple horizons each warm independently.
# ---------------------------------------------------------------------------

def test_multiple_horizons_average_after_each_warms() -> None:
    params = _params(snapshot_lengths_seconds=[1, 60])
    state = CONNECTOR.initial_state(params)

    start = datetime(2026, 1, 1)
    short_rows = [_row(start + timedelta(seconds=i), "BTC", 100.0 + i * 0.0001) for i in range(30)]
    state, short_emit = _push(state, params, short_rows)
    assert short_emit, "shorter horizon should warm and emit"

    # The 60s horizon hasn't crossed its threshold yet — only the 1s
    # horizon contributes to avg_rv.
    sym = state.per_symbol["BTC"]
    assert sym.per_length[1].n_eff >= N_EFF_WARMUP_THRESHOLD
    assert sym.per_length[60].n_eff == 0.0

    # Push 60s + 1 more — long horizon should now warm too.
    long_rows = [_row(start + timedelta(seconds=30 + i), "BTC", 100.0 + i * 0.0001) for i in range(1, 60)]
    state, _ = _push(state, params, long_rows)
    assert state.per_symbol["BTC"].per_length[60].n_eff >= N_EFF_WARMUP_THRESHOLD


# ---------------------------------------------------------------------------
# Warmup gating — first tick alone never emits.
# ---------------------------------------------------------------------------

def test_first_tick_does_not_emit() -> None:
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)
    state, emitted = _push(state, params, [_row(datetime(2026, 1, 1), "BTC", 100.0)])
    assert emitted == [], "first tick has no return → no emission"
    summary = CONNECTOR.state_summary(state)
    # last_ts seeded but n_eff still 0.
    assert summary.min_n_eff == 0.0


def test_second_tick_after_horizon_emits() -> None:
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)
    start = datetime(2026, 1, 1)
    state, _ = _push(state, params, [_row(start, "BTC", 100.0)])
    state, emitted = _push(state, params, [_row(start + timedelta(seconds=1), "BTC", 100.5)])
    assert len(emitted) == 1
    assert emitted[0]["raw_value"] > 0


# ---------------------------------------------------------------------------
# Hard validation errors
# ---------------------------------------------------------------------------

def test_out_of_order_tick_raises() -> None:
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)
    start = datetime(2026, 1, 1)
    state, _ = _push(state, params, [_row(start + timedelta(seconds=10), "BTC", 100.0)])
    with pytest.raises(ValueError, match="not strictly after"):
        _push(state, params, [_row(start + timedelta(seconds=5), "BTC", 100.0)])


def test_duplicate_timestamp_raises() -> None:
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)
    ts = datetime(2026, 1, 1)
    state, _ = _push(state, params, [_row(ts, "BTC", 100.0)])
    with pytest.raises(ValueError, match="not strictly after"):
        _push(state, params, [_row(ts, "BTC", 100.5)])


def test_non_positive_price_raises() -> None:
    params = _params()
    state = CONNECTOR.initial_state(params)
    with pytest.raises(ValueError, match="must be > 0"):
        _push(state, params, [_row(datetime(2026, 1, 1), "BTC", 0.0)])
    with pytest.raises(ValueError, match="must be > 0"):
        _push(state, params, [_row(datetime(2026, 1, 1), "BTC", -1.0)])


def test_unknown_param_raises() -> None:
    with pytest.raises(ValueError, match="Unknown connector params"):
        resolve_params(CONNECTOR.params, {"not_a_real_param": 1})


def test_negative_halflife_raises() -> None:
    with pytest.raises(ValueError, match="halflife_minutes"):
        resolve_params(CONNECTOR.params, {"halflife_minutes": 0})


def test_zero_horizon_raises() -> None:
    with pytest.raises(ValueError, match="snapshot_lengths_seconds"):
        resolve_params(CONNECTOR.params, {"snapshot_lengths_seconds": [0, 60]})


# ---------------------------------------------------------------------------
# Cross-symbol independence
# ---------------------------------------------------------------------------

def test_each_symbol_has_independent_state() -> None:
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)
    start = datetime(2026, 1, 1)
    rows = [
        _row(start, "BTC", 100.0),
        _row(start, "ETH", 1000.0),
        _row(start + timedelta(seconds=1), "BTC", 100.5),
        _row(start + timedelta(seconds=1), "ETH", 1010.0),
    ]
    state, emitted = _push(state, params, rows)
    assert {row["symbol"] for row in emitted} == {"BTC", "ETH"}
    assert state.per_symbol["BTC"].last_emitted_rv != state.per_symbol["ETH"].last_emitted_rv


# ---------------------------------------------------------------------------
# Emit-only-on-change gate
# ---------------------------------------------------------------------------

def test_constant_price_emits_zero_then_skips_duplicates() -> None:
    """After warmup at 0, subsequent 0-rv ticks are within RV_EMIT_EPSILON."""
    params = _params(snapshot_lengths_seconds=[1])
    state = CONNECTOR.initial_state(params)

    start = datetime(2026, 1, 1)
    rows = [_row(start + timedelta(seconds=i), "BTC", 100.0) for i in range(10)]
    state, emitted = _push(state, params, rows)

    # First non-trivial emission lands once horizon clears; subsequent rows
    # produce identical zero so should be deduped.
    nonzero_emissions = [e for e in emitted if e["raw_value"] != 0.0]
    assert nonzero_emissions == []
    assert len(emitted) == 1, (
        f"expected exactly one zero emission after warmup, got {len(emitted)}"
    )
