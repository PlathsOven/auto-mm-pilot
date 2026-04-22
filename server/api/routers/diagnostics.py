"""Integrator diagnostics endpoint.

``GET /api/diagnostics/zero-positions`` walks the latest pipeline output for
the calling user and returns one entry per ``(symbol, expiry)`` whose
``desired_pos`` is (near-)zero, with a closed-enum reason + the scalars
that produced it. Built to close the audit's §7.1 pain — "my positions are
all zero and there's no error anywhere."

Reasons (closed enum):
  - ``no_market_value`` — ``edge ≈ 0`` because per-row ``market_value`` is
    absent and no aggregate market value is set for this pair.
  - ``zero_variance`` — ``var ≈ 0``; Kelly sizing can't produce a non-zero
    position regardless of edge.
  - ``zero_bankroll`` — user bankroll is zero/near-zero.
  - ``no_active_blocks`` — no active blocks contribute to this pair.
  - ``edge_coincidence`` — ``edge = 0`` but market values ARE set; the
    pipeline genuinely thinks fair matches market. Rare; not a bug.
  - ``unknown`` — residual catch-all (edge/var/bankroll non-zero but
    desired_pos is still ~0). Inspect the response scalars.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import polars as pl
from fastapi import APIRouter, Depends

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.diagnostics_classify import POS_ZERO_TOL, classify
from server.api.engine_state import get_engine
from server.api.expiry import canonical_expiry_key
from server.api.market_value_store import get_store as get_market_value_store
from server.api.models import (
    ZeroPositionDiagnostic,
    ZeroPositionDiagnosticsResponse,
)

log = logging.getLogger(__name__)

router = APIRouter()


def _active_pair_set(blocks_df: pl.DataFrame | None) -> set[tuple[str, str]]:
    """Extract the (symbol, expiry) pairs that have active-block coverage."""
    if blocks_df is None or blocks_df.is_empty():
        return set()
    if "symbol" not in blocks_df.columns or "expiry" not in blocks_df.columns:
        return set()
    pairs = blocks_df.select(["symbol", "expiry"]).unique().to_dicts()
    return {
        (str(p["symbol"]), canonical_expiry_key(str(p["expiry"])))
        for p in pairs
    }


@router.get(
    "/api/diagnostics/zero-positions",
    response_model=ZeroPositionDiagnosticsResponse,
)
async def zero_position_diagnostics(
    user: User = Depends(current_user),
) -> ZeroPositionDiagnosticsResponse:
    """Explain every zero (symbol, expiry) the integrator sees on this tick."""
    engine = get_engine(user.id)
    results = engine.pipeline_results
    if results is None or "desired_pos_df" not in results:
        return ZeroPositionDiagnosticsResponse(
            bankroll=engine.bankroll,
            tick_timestamp=None,
            diagnostics=[],
        )

    desired_pos_df = results["desired_pos_df"]
    if desired_pos_df.is_empty():
        return ZeroPositionDiagnosticsResponse(
            bankroll=engine.bankroll,
            tick_timestamp=None,
            diagnostics=[],
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    at_or_before = desired_pos_df.filter(pl.col("timestamp") <= now)
    if at_or_before.is_empty():
        return ZeroPositionDiagnosticsResponse(
            bankroll=engine.bankroll,
            tick_timestamp=None,
            diagnostics=[],
        )

    # Latest row per (symbol, expiry).
    latest = (
        at_or_before.sort("timestamp")
        .group_by(["symbol", "expiry"])
        .agg(pl.all().last())
    )

    mv_map = get_market_value_store(user.id).to_dict()
    active_pairs = _active_pair_set(results.get("blocks_df"))

    tick_ts_ms = int(
        at_or_before["timestamp"].max().replace(tzinfo=timezone.utc).timestamp() * 1000
    ) if at_or_before.height else None

    diagnostics: list[ZeroPositionDiagnostic] = []
    for row in latest.iter_rows(named=True):
        desired = float(row.get("smoothed_desired_position") or 0.0)
        if abs(desired) > POS_ZERO_TOL:
            continue

        symbol = str(row["symbol"])
        expiry_raw = row["expiry"]
        expiry_iso = canonical_expiry_key(str(expiry_raw))
        aggregate = mv_map.get((symbol, expiry_iso))
        has_active = (symbol, expiry_iso) in active_pairs

        raw_edge = float(row.get("edge") or 0.0)
        raw_var = float(row.get("var") or 0.0)
        total_fair = float(row.get("total_fair") or 0.0)
        total_mkt_fair = float(row.get("total_market_fair") or 0.0)

        reason, hint = classify(
            desired_pos=desired,
            raw_edge=raw_edge,
            raw_variance=raw_var,
            total_fair=total_fair,
            total_market_fair=total_mkt_fair,
            aggregate_market_value=aggregate,
            has_active_blocks=has_active,
            bankroll=engine.bankroll,
        )

        diagnostics.append(ZeroPositionDiagnostic(
            symbol=symbol,
            expiry=expiry_iso,
            raw_edge=raw_edge,
            raw_variance=raw_var,
            desired_pos=desired,
            total_fair=total_fair,
            total_market_fair=total_mkt_fair,
            aggregate_market_value=aggregate,
            reason=reason,
            hint=hint,
        ))

    return ZeroPositionDiagnosticsResponse(
        bankroll=engine.bankroll,
        tick_timestamp=tick_ts_ms,
        diagnostics=diagnostics,
    )
