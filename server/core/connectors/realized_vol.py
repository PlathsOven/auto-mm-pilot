"""Realized volatility connector.

Consumes spot-price ticks per symbol and produces an annualized realized
vol estimate by aggregating time-decayed EWMA variance estimators across
multiple return horizons (default ``[1s, 60s, 3600s]``). Each horizon's
EWMA accounts for both sample age (time-decayed weight) and sample size
(effective sample count), so a horizon that has only just begun to receive
data contributes less than a fully warmed one.

The connector emits the per-symbol ``avg_rv`` (mean of ``sqrt(ewma_var)``
across warmed horizons) into the stream's ``snapshot_rows`` whenever the
value changes by more than ``RV_EMIT_EPSILON`` — a tight gate that lets
the existing pipeline dirty-flag coalescer absorb high tick rates without
pipeline thrash.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

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


# Module constants — tuned conservatively. ``N_EFF_WARMUP_THRESHOLD`` of 1.0
# means a horizon contributes the moment its first full-interval sample
# lands. ``RV_EMIT_EPSILON`` of 1e-9 corresponds to ~0.0001 vol points; below
# that the pipeline output is identical at display precision so emitting is
# pure noise.
N_EFF_WARMUP_THRESHOLD: float = 1.0
RV_EMIT_EPSILON: float = 1e-9

CONNECTOR_NAME = "realized_vol"

# Default block config matches the spec's "Recommended stream defaults"
# table — annualized, shifting, no decay, var_fair_ratio 1.0.
_DEFAULT_BLOCK = BlockConfig(
    annualized=True,
    temporal_position="shifting",
    decay_end_size_mult=1.0,
    decay_rate_prop_per_min=0.0,
    decay_profile="linear",
    var_fair_ratio=1.0,
)


@dataclass
class _SnapshotLengthState:
    """EWMA variance estimator for a single return horizon."""

    last_ts: datetime | None = None
    last_price: float | None = None
    ewma_ann_var: float = 0.0
    n_eff: float = 0.0


@dataclass
class _SymbolState:
    """Per-symbol realized-vol state — one EWMA per configured horizon."""

    per_length: dict[int, _SnapshotLengthState] = field(default_factory=dict)
    last_emitted_rv: float | None = None
    last_seen_ts: datetime | None = None


@dataclass
class RealizedVolState:
    """Top-level connector state — one entry per observed symbol."""

    per_symbol: dict[str, _SymbolState] = field(default_factory=dict)


class _RealizedVolConnector:
    """Realized-vol connector implementation.

    Stateless singleton — every instance method threads opaque state in
    and out. Instantiated once at module import and registered into
    ``CONNECTOR_REGISTRY``.
    """

    name = CONNECTOR_NAME
    display_name = "Realized Volatility"
    description = (
        "Push spot-price ticks per symbol; the connector emits an "
        "annualized realized-vol estimate by aggregating time-decayed EWMA "
        "variance estimators across multiple return horizons."
    )
    input_key_cols = ["symbol"]
    input_value_fields = [
        ConnectorInputFieldSchema(
            name="price",
            type="float",
            description="Most recent spot price for the symbol (must be > 0).",
        ),
    ]
    output_unit_label = "annualized vol (fractional)"
    params = [
        ConnectorParamSchema(
            name="halflife_minutes",
            type="int",
            default=1440,
            description=(
                "EWMA half-life in minutes — controls how quickly old samples "
                "decay out of the variance estimate."
            ),
            min=1,
        ),
        ConnectorParamSchema(
            name="snapshot_lengths_seconds",
            type="list_int",
            default=[1, 60, 3600],
            description=(
                "Return horizons in seconds. The estimate is the mean of the "
                "per-horizon EWMA volatilities once each horizon has at least "
                "one warm sample."
            ),
            min=1,
        ),
    ]
    recommended = ConnectorRecommendation(
        scale=1.0,
        offset=0.0,
        exponent=2.0,
        block=_DEFAULT_BLOCK,
    )

    def initial_state(self, params: dict[str, Any]) -> RealizedVolState:
        # ``params`` is unused at construction — state is built lazily per
        # symbol on the first row that mentions it. We still accept the
        # argument to satisfy the Protocol shape.
        del params
        return RealizedVolState()

    def process(
        self,
        state: RealizedVolState,
        rows: list[dict[str, Any]],
        params: dict[str, Any],
    ) -> tuple[RealizedVolState, list[EmittedRow]]:
        lengths = _validated_lengths(params["snapshot_lengths_seconds"])
        halflife_seconds = float(params["halflife_minutes"]) * 60.0
        # τ in seconds. Halflife → exponential decay constant via
        # ``decay = exp(-elapsed/τ)`` where ``τ = halflife / ln(2)``.
        tau = halflife_seconds / math.log(2.0)

        # Sort the inbound batch by timestamp — the algorithm assumes
        # strictly-increasing per-symbol timestamps. Cross-symbol order is
        # irrelevant because state is per-symbol.
        sorted_rows = sorted(rows, key=lambda r: _parse_ts(r["timestamp"]))

        emitted: list[EmittedRow] = []
        for row in sorted_rows:
            ts = _parse_ts(row["timestamp"])
            symbol = row["symbol"]
            price = row["price"]

            if not isinstance(price, (int, float)) or isinstance(price, bool):
                raise ValueError(f"Row price must be numeric, got {type(price).__name__}")
            price = float(price)
            if price <= 0:
                raise ValueError(f"Row price must be > 0, got {price}")

            sym_state = state.per_symbol.get(symbol)
            if sym_state is None:
                sym_state = _SymbolState()
                state.per_symbol[symbol] = sym_state

            if sym_state.last_seen_ts is not None and ts <= sym_state.last_seen_ts:
                raise ValueError(
                    f"Row timestamp {ts.isoformat()} is not strictly after "
                    f"the previous tick for symbol {symbol!r} "
                    f"({sym_state.last_seen_ts.isoformat()})"
                )
            sym_state.last_seen_ts = ts

            for length in lengths:
                length_state = sym_state.per_length.get(length)
                if length_state is None:
                    length_state = _SnapshotLengthState()
                    sym_state.per_length[length] = length_state
                _update_length_state(length_state, ts, price, length, tau)

            avg_rv = _compute_avg_rv(sym_state)
            if avg_rv is None:
                continue

            previous = sym_state.last_emitted_rv
            if previous is not None and abs(avg_rv - previous) <= RV_EMIT_EPSILON:
                continue

            sym_state.last_emitted_rv = avg_rv
            emitted.append({
                "timestamp": row["timestamp"],
                "symbol": symbol,
                "raw_value": avg_rv,
            })

        return state, emitted

    def state_summary(self, state: RealizedVolState) -> ConnectorStateSummary:
        if not state.per_symbol:
            return ConnectorStateSummary(
                min_n_eff=0.0,
                warmup_threshold=N_EFF_WARMUP_THRESHOLD,
                symbols_tracked=0,
            )
        # Warmup is gated by the *least*-warm horizon across every symbol —
        # that's the bottleneck for the trader being able to read the value.
        min_n_eff = min(
            (
                ls.n_eff
                for sym in state.per_symbol.values()
                for ls in sym.per_length.values()
            ),
            default=0.0,
        )
        return ConnectorStateSummary(
            min_n_eff=min_n_eff,
            warmup_threshold=N_EFF_WARMUP_THRESHOLD,
            symbols_tracked=len(state.per_symbol),
        )


def _parse_ts(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        # Strip tz to match codebase convention (naive datetimes represent UTC).
        return raw.replace(tzinfo=None) if raw.tzinfo is not None else raw
    if isinstance(raw, str):
        dt = parse_datetime_tolerant(raw)
        return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt
    raise ValueError(f"timestamp must be datetime or ISO string, got {type(raw).__name__}")


def _validated_lengths(raw: Any) -> list[int]:
    """Defensive re-validation in case state is reused across configure calls."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("snapshot_lengths_seconds must be a non-empty list of positive ints")
    cleaned = sorted({int(v) for v in raw})
    if any(v <= 0 for v in cleaned):
        raise ValueError("snapshot_lengths_seconds entries must all be > 0")
    return cleaned


def _update_length_state(
    s: _SnapshotLengthState,
    ts: datetime,
    price: float,
    length_seconds: int,
    tau: float,
) -> None:
    """Time-decayed EWMA update for a single return horizon."""
    if s.last_ts is None or s.last_price is None:
        s.last_ts = ts
        s.last_price = price
        return

    elapsed = (ts - s.last_ts).total_seconds()
    if elapsed < length_seconds:
        return

    log_return = math.log(price / s.last_price)
    annualized_var_sample = (log_return * log_return) * (SECONDS_PER_YEAR / elapsed)
    decay = math.exp(-elapsed / tau)
    n_eff_new = 1.0 + decay * s.n_eff
    ewma_new = (annualized_var_sample + decay * s.n_eff * s.ewma_ann_var) / n_eff_new

    s.last_ts = ts
    s.last_price = price
    s.ewma_ann_var = ewma_new
    s.n_eff = n_eff_new


def _compute_avg_rv(sym: _SymbolState) -> float | None:
    """Mean of ``sqrt(ewma_var)`` across warm horizons, or ``None`` if cold."""
    warm = [
        ls
        for ls in sym.per_length.values()
        if ls.n_eff >= N_EFF_WARMUP_THRESHOLD and ls.ewma_ann_var >= 0.0
    ]
    if not warm:
        return None
    total = 0.0
    for ls in warm:
        total += math.sqrt(ls.ewma_ann_var)
    return total / len(warm)


REALIZED_VOL_CONNECTOR: Connector[RealizedVolState] = _RealizedVolConnector()
