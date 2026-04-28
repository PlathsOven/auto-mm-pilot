"""Event-aware realized volatility connector.

Consumes spot-price + IV ticks per symbol, buckets log returns into bars
to compute per-bar realized variance, then subtracts variance that is
*both* priced into IV (by an annualized variance drop times tenor) and
realized in excess of a causal EWMA background. The output is the
annualized clean realized-vol estimate.

Algorithm summary (work in *variance* space, not vol space):

    RV_t       per-bar realized variance, sum(r_i^2) over the bar.
    iv_sq_t    annualized implied variance at bar close (e.g. ATM IV^2).
    T          option tenor in years matching the IV's annualization.
    H          horizons in bars (default (1, 4, 24, 72, 168) at 1h cadence).
    lam        EWMA decay for the causal background mean (~0.94 daily).

    mu_bg_t = lam * mu_bg_{t-1} + (1-lam) * (RV_{t-1} - E_{t-1})
    RV_h(t) = sum_{s=t-h+1}^{t} RV_s
    Δ_h sigma_I^2(t) = sigma_I^2(t) - sigma_I^2(t-h)
    E_h(t)  = max(0, min(-Δ_h sigma_I^2(t) * T,  RV_h(t) - sum_s mu_bg_s))

The min cap is load-bearing — IV drop without realized excess is *not*
an event payout, realized excess without IV drop is *not* an
anticipated event. Per-horizon attributions are then back-filled to
past bars proportionally to remaining capacity (rv - mu_bg - E),
shortest horizon first. Capacity-weighted (rather than raw-excess-
weighted) back-fill provably preserves three invariants:

    1. E_s >= 0
    2. E_s <= RV_s - mu_bg_s wherever E_s > 0
    3. RV~_s = RV_s - E_s >= 0

Online operation. The spec is offline (single-pass over a complete
history); the connector framework is online (incremental ``process``
calls). The mismatch is resolved with a per-symbol bounded rolling
buffer of finalised bars; on each new bar finalisation the full sweep
runs over the buffer and *only the latest bar's* cleaned vol is
emitted. Past back-fills happen inside the buffer (they shape mu_bg)
but are not re-emitted — the pipeline only consumes the latest snapshot
per (timestamp, symbol).

Limitations.
    * mu_bg retrospection. Back-fills modify past E but don't rerun
      the EWMA. Bias bounded by (1-lam) * backfill, damped by EWMA.
    * Constant-maturity IV assumed. Use a CM ATM IV^2 or varswap
      strike so -Δσ^2 * T is dimensionally correct. Fixed-expiry IV
      introduces a time-decay term we don't model.
    * Gap handling. Bars are created on demand from inbound ticks; if
      the trader's feed has hours-long gaps the model's resolution at
      long horizons degrades. Crypto 24/7 dense feeds are fine.
    * By-design non-detection: persistent regime shifts (no IV crush
      ever happens), pre-announce rumour leaks during IV-rising
      windows, events that price-and-resolve within a single bar.

Run ``python -m server.core.connectors.event_aware_rv`` to execute the
15-scenario invariant test suite (see ``_run_scenarios``).
"""
from __future__ import annotations

import math
import sys
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable

import numpy as np
import polars as pl

from server.api.datetime_parsing import parse_datetime_tolerant
from server.core.config import SECONDS_PER_YEAR, BlockConfig
from server.core.connectors.base import (
    Connector,
    ConnectorInputFieldSchema,
    ConnectorParamSchema,
    ConnectorRecommendation,
    ConnectorStateSummary,
    EmittedRow,
)


CONNECTOR_NAME = "event_aware_rv"

DEFAULT_BAR_SECONDS: int = 3600
DEFAULT_HORIZONS_BARS: tuple[int, ...] = (1, 4, 24, 72, 168)
DEFAULT_LAM: float = 0.94
DEFAULT_TENOR_DAYS: float = 30.0

# 365.25 mirrors server.core.config.SECONDS_PER_YEAR; trader-facing
# tenor stays in days and is converted to years here.
DAYS_PER_YEAR: float = 365.25

# 1e-9 ≈ 0.003 vol points — below display precision; same gating
# convention as realized_vol so the pipeline dirty-flag coalescer can
# absorb high tick rates without thrash.
VOL_EMIT_EPSILON: float = 1e-9

# Floating-point tolerance defending the proven invariants. Tighter
# than VOL_EMIT_EPSILON because invariants must hold near-exactly.
INVARIANT_TOL: float = 1e-12

# Buffer keeps 2× max horizon so rolling-sum windows are full once
# warmed and the EWMA has had several half-lives to stabilise (10
# half-lives ≈ ln(0.001)/ln(0.94) ≈ 110 bars; default max horizon 168
# already covers it).
BUFFER_MULTIPLIER: int = 2

_EPOCH = datetime(1970, 1, 1)

# Recommended block — annualized vol → variance via exponent=2 (same
# pattern as realized_vol).
_DEFAULT_BLOCK = BlockConfig(
    annualized=True,
    temporal_position="shifting",
    decay_end_size_mult=1.0,
    decay_rate_prop_per_min=0.0,
    decay_profile="linear",
    var_fair_ratio=1.0,
)


# -------------------------------------------------------------------- state

@dataclass
class _OpenBar:
    """The bar currently being filled — finalised when a tick crosses
    the boundary."""

    start_ts: datetime
    last_price_in_bar: float | None = None
    sum_squared_log_returns: float = 0.0
    last_iv: float | None = None


@dataclass
class _BarRecord:
    """A finalised bar — the inputs the sweep consumes."""

    start_ts: datetime
    rv: float
    iv_sq: float


@dataclass
class _SymbolState:
    open_bar: _OpenBar | None = None
    history: deque[_BarRecord] = field(default_factory=deque)
    last_emitted_clean_vol: float | None = None
    last_seen_ts: datetime | None = None
    # Carries across bar boundaries so the first squared log return of
    # a new bar uses the prior bar's last price (otherwise the
    # bar-boundary return is silently dropped).
    last_price_overall: float | None = None


@dataclass
class EventAwareRvState:
    per_symbol: dict[str, _SymbolState] = field(default_factory=dict)
    # Captured on each process call so state_summary (which gets no
    # params) can report the warmup target.
    max_horizon_bars: int = 0


# -------------------------------------------------------------------- connector

class _EventAwareRvConnector:
    name = CONNECTOR_NAME
    display_name = "Event-aware Realized Volatility"
    description = (
        "Push spot-price + IV ticks per symbol; the connector buckets "
        "log returns into bars to compute realized variance, then "
        "subtracts variance that is both priced into IV (-Δσ²·T) and "
        "realized in excess of an EWMA background. The output is the "
        "annualized clean realized-vol estimate."
    )
    input_key_cols = ["symbol"]
    input_value_fields = [
        ConnectorInputFieldSchema(
            name="price", type="float",
            description="Most recent spot price for the symbol (must be > 0).",
        ),
        ConnectorInputFieldSchema(
            name="iv", type="float",
            description=(
                "Most recent annualized implied volatility (fractional, "
                "e.g. 0.6 = 60%). Use a constant-maturity surface point "
                "or a varswap strike — fixed-expiry IV introduces "
                "time-decay contamination in -Δσ²·T."
            ),
        ),
    ]
    output_unit_label = "annualized clean vol (fractional)"
    params = [
        ConnectorParamSchema(
            name="bar_seconds", type="int", default=DEFAULT_BAR_SECONDS,
            description=(
                "Bar size in seconds — log returns within a bar are "
                "squared and summed into RV_t."
            ),
            min=1,
        ),
        ConnectorParamSchema(
            name="horizons_bars", type="list_int",
            default=list(DEFAULT_HORIZONS_BARS),
            description=(
                "Rolling horizons in bars. Always include 1 (catches "
                "single-bar shocks for free)."
            ),
            min=1,
        ),
        ConnectorParamSchema(
            name="lam", type="float", default=DEFAULT_LAM,
            description=(
                "EWMA decay for the background mean (RiskMetrics-style; "
                "~0.94 daily, ~0.97 hourly)."
            ),
            min=0.0,
            max=1.0,
        ),
        ConnectorParamSchema(
            name="tenor_days", type="float", default=DEFAULT_TENOR_DAYS,
            description=(
                "Option tenor in days for the variance conversion "
                "-Δσ²·T. Match this to your IV surface's nominal maturity."
            ),
            min=0.0,
        ),
    ]
    recommended = ConnectorRecommendation(
        scale=1.0,
        offset=0.0,
        exponent=2.0,
        block=_DEFAULT_BLOCK,
    )

    def initial_state(self, params: dict[str, Any]) -> EventAwareRvState:
        del params
        return EventAwareRvState()

    def process(
        self,
        state: EventAwareRvState,
        rows: list[dict[str, Any]],
        params: dict[str, Any],
    ) -> tuple[EventAwareRvState, list[EmittedRow]]:
        bar_seconds = int(params["bar_seconds"])
        horizons = _validated_horizons(params["horizons_bars"])
        lam = float(params["lam"])
        tenor_T = float(params["tenor_days"]) / DAYS_PER_YEAR
        max_horizon = max(horizons)
        max_buffer = max_horizon * BUFFER_MULTIPLIER
        state.max_horizon_bars = max_horizon

        sorted_rows = sorted(rows, key=lambda r: _parse_ts(r["timestamp"]))

        emitted: list[EmittedRow] = []
        for row in sorted_rows:
            ts = _parse_ts(row["timestamp"])
            symbol = row["symbol"]
            price = _coerce_positive_float(row, "price")
            iv = _coerce_positive_float(row, "iv")

            sym = state.per_symbol.get(symbol)
            if sym is None:
                sym = _SymbolState()
                state.per_symbol[symbol] = sym

            if sym.last_seen_ts is not None and ts <= sym.last_seen_ts:
                raise ValueError(
                    f"Row timestamp {ts.isoformat()} is not strictly "
                    f"after the previous tick for symbol {symbol!r} "
                    f"({sym.last_seen_ts.isoformat()})"
                )
            sym.last_seen_ts = ts

            current_bar_start = _bar_start(ts, bar_seconds)

            # Finalise the open bar if this tick has crossed into a
            # later bar. We do not fabricate empty bars across gaps —
            # see the docstring's "Gap handling" note.
            if (sym.open_bar is not None
                    and current_bar_start > sym.open_bar.start_ts):
                _finalize_bar(sym, max_buffer)
                emit = _maybe_emit(
                    sym, symbol, horizons, lam, tenor_T, bar_seconds,
                )
                if emit is not None:
                    emitted.append(emit)

            if sym.open_bar is None:
                sym.open_bar = _OpenBar(
                    start_ts=current_bar_start,
                    last_price_in_bar=sym.last_price_overall,
                )

            ob = sym.open_bar
            if ob.last_price_in_bar is not None:
                log_return = math.log(price / ob.last_price_in_bar)
                ob.sum_squared_log_returns += log_return * log_return
            ob.last_price_in_bar = price
            ob.last_iv = iv
            sym.last_price_overall = price

        return state, emitted

    def state_summary(self, state: EventAwareRvState) -> ConnectorStateSummary:
        warmup_threshold = float(max(state.max_horizon_bars, 1))
        if not state.per_symbol:
            return ConnectorStateSummary(
                min_n_eff=0.0,
                warmup_threshold=warmup_threshold,
                symbols_tracked=0,
            )
        # The bottleneck for trader readability is the least-warm
        # symbol's bar count (mirrors realized_vol's min-across-symbols
        # convention).
        min_n_eff = float(min(
            len(sym.history) for sym in state.per_symbol.values()
        ))
        return ConnectorStateSummary(
            min_n_eff=min_n_eff,
            warmup_threshold=warmup_threshold,
            symbols_tracked=len(state.per_symbol),
        )


# -------------------------------------------------------------------- helpers

def _parse_ts(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None) if raw.tzinfo is not None else raw
    if isinstance(raw, str):
        dt = parse_datetime_tolerant(raw)
        return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt
    raise ValueError(
        f"timestamp must be datetime or ISO string, got {type(raw).__name__}"
    )


def _coerce_positive_float(row: dict[str, Any], key: str) -> float:
    v = row[key]
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        raise ValueError(
            f"Row {key!r} must be numeric, got {type(v).__name__}"
        )
    f = float(v)
    if f <= 0:
        raise ValueError(f"Row {key!r} must be > 0, got {f}")
    return f


def _validated_horizons(raw: Any) -> list[int]:
    if not isinstance(raw, list) or not raw:
        raise ValueError(
            "horizons_bars must be a non-empty list of positive ints"
        )
    cleaned = sorted({int(v) for v in raw})
    if any(v <= 0 for v in cleaned):
        raise ValueError("horizons_bars entries must all be > 0")
    return cleaned


def _bar_start(ts: datetime, bar_seconds: int) -> datetime:
    """Floor a naive-UTC timestamp to the nearest bar boundary.

    Naive datetimes represent UTC by codebase convention; explicit
    epoch subtraction avoids ``datetime.timestamp()`` which would
    interpret a naive value as local time.
    """
    delta = (ts - _EPOCH).total_seconds()
    bar_idx = math.floor(delta / bar_seconds)
    return _EPOCH + timedelta(seconds=bar_idx * bar_seconds)


def _finalize_bar(sym: _SymbolState, max_buffer: int) -> None:
    ob = sym.open_bar
    assert ob is not None
    iv = ob.last_iv
    assert iv is not None  # set on every tick alongside price
    sym.history.append(_BarRecord(
        start_ts=ob.start_ts,
        rv=ob.sum_squared_log_returns,
        iv_sq=iv * iv,
    ))
    while len(sym.history) > max_buffer:
        sym.history.popleft()
    sym.open_bar = None


def _maybe_emit(
    sym: _SymbolState,
    symbol: str,
    horizons: list[int],
    lam: float,
    tenor_T: float,
    bar_seconds: int,
) -> EmittedRow | None:
    if not sym.history:
        return None
    df = pl.DataFrame({
        "rv": [r.rv for r in sym.history],
        "iv_sq": [r.iv_sq for r in sym.history],
    })
    out = _deevent_rv(df, horizons=tuple(horizons), lam=lam, T=tenor_T)
    rv_clean_last = float(out["rv_clean"][-1])
    # Invariant 3 guarantees rv_clean >= 0 mathematically; ULP noise
    # can land us slightly negative — floor.
    if rv_clean_last < 0.0:
        rv_clean_last = 0.0

    bars_per_year = SECONDS_PER_YEAR / bar_seconds
    clean_var_ann = rv_clean_last * bars_per_year
    clean_vol = math.sqrt(clean_var_ann)

    previous = sym.last_emitted_clean_vol
    if previous is not None and abs(clean_vol - previous) <= VOL_EMIT_EPSILON:
        return None
    sym.last_emitted_clean_vol = clean_vol

    last_bar = sym.history[-1]
    close_ts = last_bar.start_ts + timedelta(seconds=bar_seconds)
    return {
        "timestamp": close_ts.isoformat(),
        "symbol": symbol,
        "raw_value": clean_vol,
    }


# -------------------------------------------------------- math: sweep + driver

def _sweep_py(
    rv: np.ndarray,
    rv_h: np.ndarray,
    div_h: np.ndarray,
    H_arr: np.ndarray,
    lam: float,
    T: float,
    tol: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Sequential single-pass sweep — see module docstring for the math.

    Pure-NumPy reference (no Numba). Within each iteration of the time
    loop every operation is a vector slice, not a scalar Python inner
    loop, so even unaccelerated this is plenty fast for the bounded
    buffer sizes the connector uses (~max_horizon × 2).
    """
    n_t = rv.shape[0]
    n_h = H_arr.shape[0]
    E = np.zeros(n_t)
    mu_bg = np.zeros(n_t)
    if np.isfinite(rv[0]):
        mu_bg[0] = rv[0]

    for t in range(n_t):
        if t > 0:
            prev = rv[t - 1] - E[t - 1]
            if np.isfinite(prev):
                mu_bg[t] = lam * mu_bg[t - 1] + (1.0 - lam) * prev
            else:
                mu_bg[t] = mu_bg[t - 1]

        # Shortest horizon first — locally-attributed events stay
        # localized; long horizons only fill remainders.
        for hi in range(n_h):
            h = int(H_arr[hi])
            lo = t - h + 1
            if lo < 0:
                continue

            rvh = rv_h[hi, t]
            dih = div_h[hi, t]
            if not (np.isfinite(rvh) and np.isfinite(dih)):
                continue

            muh = float(mu_bg[lo:t + 1].sum())
            attributed = float(E[lo:t + 1].sum())

            E_h = -dih * T
            if (rvh - muh) < E_h:
                E_h = rvh - muh
            if E_h < 0.0:
                E_h = 0.0

            shortfall = E_h - attributed
            if shortfall <= tol:
                continue

            capacity = (rv[lo:t + 1] - mu_bg[lo:t + 1]) - E[lo:t + 1]
            np.maximum(capacity, 0.0, out=capacity)
            total_cap = float(capacity.sum())
            if total_cap > tol:
                scale = shortfall / total_cap
                # ULP defence — proof gives shortfall <= total_cap, but
                # rolling-sum vs slice-sum ordering can disagree by ~1
                # ULP and push scale just above 1.
                if scale > 1.0:
                    scale = 1.0
                E[lo:t + 1] += capacity * scale

    return E, mu_bg


def _deevent_rv(
    df: pl.DataFrame,
    *,
    rv_col: str = "rv",
    iv_sq_col: str = "iv_sq",
    horizons: tuple[int, ...] = DEFAULT_HORIZONS_BARS,
    lam: float = DEFAULT_LAM,
    T: float = DEFAULT_TENOR_DAYS / DAYS_PER_YEAR,
    tol: float = INVARIANT_TOL,
) -> pl.DataFrame:
    """Spec-fidelity batch driver — Polars precompute → NumPy sweep →
    Polars reassemble. Used by the connector against its rolling
    buffer and by the scenario harness against synthetic histories.
    """
    H = sorted(set(horizons))
    precomp = df.with_columns(
        [pl.col(rv_col).rolling_sum(h).alias(f"__rvh_{h}") for h in H]
        + [(pl.col(iv_sq_col) - pl.col(iv_sq_col).shift(h)).alias(f"__div_{h}")
           for h in H]
    )
    rv = precomp[rv_col].to_numpy().astype(np.float64, copy=False)
    rv_h = np.ascontiguousarray(
        np.stack([precomp[f"__rvh_{h}"].to_numpy() for h in H]),
        dtype=np.float64,
    )
    div_h = np.ascontiguousarray(
        np.stack([precomp[f"__div_{h}"].to_numpy() for h in H]),
        dtype=np.float64,
    )
    H_arr = np.asarray(H, dtype=np.int64)
    E, mu_bg = _sweep_py(rv, rv_h, div_h, H_arr, lam, T, tol)
    return (
        precomp.with_columns(
            pl.Series("mu_bg", mu_bg),
            pl.Series("E", E),
            pl.Series("rv_clean", rv - E),
        )
        .drop([f"__rvh_{h}" for h in H] + [f"__div_{h}" for h in H])
    )


# ---------------------------------------------------------------- registry

EVENT_AWARE_RV_CONNECTOR: Connector[EventAwareRvState] = _EventAwareRvConnector()


# ----------------------------------------------------------- scenario harness

def _check_invariants(out: pl.DataFrame, name: str) -> None:
    rv = out["rv"].to_numpy()
    E = out["E"].to_numpy()
    mu_bg = out["mu_bg"].to_numpy()
    rv_clean = out["rv_clean"].to_numpy()

    if (E < -INVARIANT_TOL).any():
        raise AssertionError(
            f"[{name}] invariant 1 (E ≥ 0) violated: min={E.min():.3e}"
        )
    if (rv_clean < -INVARIANT_TOL).any():
        raise AssertionError(
            f"[{name}] invariant 3 (rv_clean ≥ 0) violated: "
            f"min={rv_clean.min():.3e}"
        )
    active = E > INVARIANT_TOL
    if active.any():
        slack = (rv[active] - mu_bg[active]) - E[active]
        if (slack < -INVARIANT_TOL).any():
            raise AssertionError(
                f"[{name}] invariant 2 (E ≤ RV − μ_bg) violated: "
                f"min slack={slack.min():.3e}"
            )


# Synthetic-data baseline — variance per bar. ~1% per-bar vol; keeps
# spike-vs-background ratios in a regime where the algorithm exercises
# all branches without becoming numerically pathological.
_BG_VAR: float = 1.0e-4


def _bg_rv(rng: np.random.Generator, n: int, scale: float = _BG_VAR) -> np.ndarray:
    """Exponentially-distributed background RV — non-negative by
    construction, mean = scale."""
    return rng.exponential(scale, n)


def _scenario_clean_earnings(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[40:50] = np.linspace(0.5, 0.7, 10)
    iv[50:] = 0.45
    rv[50] = _BG_VAR * 50.0
    return "clean_earnings", rv, iv ** 2


def _scenario_round_trip_iv(rng):
    n = 120
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[40:60] = 0.7
    iv[60:] = 0.45
    rv[55:65] = _BG_VAR * 5.0
    return "round_trip_iv", rv, iv ** 2


def _scenario_underpriced(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[60:] = 0.48  # tiny IV drop
    rv[60] = _BG_VAR * 100.0  # huge realized
    return "underpriced", rv, iv ** 2


def _scenario_overpriced(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[60:] = 0.30  # large IV crush
    rv[60] = _BG_VAR * 1.5  # minimal realized
    return "overpriced", rv, iv ** 2


def _scenario_calm(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.linspace(0.5, 0.45, n)
    return "calm_market", rv, iv ** 2


def _scenario_unscheduled_shock(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[60:] = 0.7  # IV jumps UP — new uncertainty
    rv[60] = _BG_VAR * 50.0
    return "unscheduled_shock", rv, iv ** 2


def _scenario_multi_event_underpriced(rng):
    n = 120
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[55:] = 0.45  # event 1 priced fully
    iv[75:] = 0.43  # event 2 underpriced
    rv[55] = _BG_VAR * 30.0
    rv[75] = _BG_VAR * 80.0
    return "multi_event_underpriced", rv, iv ** 2


def _scenario_postponed(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[60:] = 0.45  # IV drops with no realized spike
    return "event_postponed", rv, iv ** 2


def _scenario_adversarial_capacity(rng):
    n = 80
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    rv[40] = _BG_VAR * 40.0
    rv[41] = _BG_VAR * 40.0
    iv[41] = 0.46
    iv[42:] = 0.42  # net Δσ² over h=2 spans both spike bars
    return "adversarial_capacity", rv, iv ** 2


def _scenario_persistent_regime(rng):
    n = 100
    rv = _bg_rv(rng, n)
    iv = np.linspace(0.4, 0.7, n)  # ratchets up; never crushes
    rv[60] = _BG_VAR * 50.0
    return "persistent_regime", rv, iv ** 2


def _scenario_multi_day_aftermath(rng):
    n = 150
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[80:] = np.linspace(0.5, 0.4, n - 80)
    rv[80:88] = _BG_VAR * np.array([60.0, 30.0, 20.0, 15.0, 10.0, 8.0, 5.0, 3.0])
    return "multi_day_aftermath", rv, iv ** 2


def _scenario_heavy_tailed(rng):
    n = 100
    rv = rng.pareto(2.5, n) * _BG_VAR
    iv = np.full(n, 0.5)
    iv[60:] = 0.42
    rv[60] = max(rv[60], _BG_VAR * 80.0)
    return "heavy_tailed", rv, iv ** 2


def _scenario_extreme_crush(rng):
    n = 80
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.8)
    iv[40:] = 0.25  # 0.64 → 0.0625 in iv²
    rv[40] = _BG_VAR * 100.0
    return "extreme_crush", rv, iv ** 2


def _scenario_back_to_back(rng):
    n = 120
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[40:] = 0.46
    iv[46:] = 0.42  # second event 6 bars after first
    rv[40] = _BG_VAR * 40.0
    rv[46] = _BG_VAR * 40.0
    return "back_to_back", rv, iv ** 2


def _scenario_short_series(rng):
    n = 30
    rv = _bg_rv(rng, n)
    iv = np.full(n, 0.5)
    iv[25:] = 0.42
    rv[25] = _BG_VAR * 30.0
    return "short_series", rv, iv ** 2


_ScenarioBuilder = Callable[[np.random.Generator], tuple[str, np.ndarray, np.ndarray]]
_SCENARIOS: tuple[_ScenarioBuilder, ...] = (
    _scenario_clean_earnings,
    _scenario_round_trip_iv,
    _scenario_underpriced,
    _scenario_overpriced,
    _scenario_calm,
    _scenario_unscheduled_shock,
    _scenario_multi_event_underpriced,
    _scenario_postponed,
    _scenario_adversarial_capacity,
    _scenario_persistent_regime,
    _scenario_multi_day_aftermath,
    _scenario_heavy_tailed,
    _scenario_extreme_crush,
    _scenario_back_to_back,
    _scenario_short_series,
)


def _run_scenarios() -> int:
    """Build the 15 spec scenarios, run ``_deevent_rv`` on each, assert
    the three invariants, and print a summary table. Returns the number
    of failed scenarios (0 = all green)."""
    rng = np.random.default_rng(42)
    failures: list[str] = []
    print(f"running {len(_SCENARIOS)} event-aware-RV scenarios:")
    for builder in _SCENARIOS:
        name, rv_arr, iv_sq_arr = builder(rng)
        df = pl.DataFrame({"rv": rv_arr, "iv_sq": iv_sq_arr})
        out = _deevent_rv(df)
        try:
            _check_invariants(out, name)
            status = " ok "
        except AssertionError as exc:
            status = "FAIL"
            failures.append(str(exc))
        total_e = float(out["E"].sum())
        min_clean = float(out["rv_clean"].min())
        print(
            f"  [{status}] {name:<26s} N={len(rv_arr):3d}  "
            f"ΣE={total_e:.3e}  min(rv_clean)={min_clean:+.3e}"
        )
    print()
    if failures:
        print(f"{len(failures)} scenario(s) failed invariant checks:")
        for f in failures:
            print(f"  - {f}")
        return len(failures)
    print(f"all {len(_SCENARIOS)} scenarios passed invariant checks")
    return 0


if __name__ == "__main__":
    sys.exit(_run_scenarios())
