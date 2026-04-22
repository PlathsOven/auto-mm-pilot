"""Pure-Python classifier for the zero-position diagnostic.

Kept separate from ``routers/diagnostics.py`` so tests can import and call
``classify`` without booting the FastAPI + SQLAlchemy stack.
"""

from __future__ import annotations

from typing import Literal

ZeroPositionReason = Literal[
    "no_market_value",
    "zero_variance",
    "zero_bankroll",
    "no_active_blocks",
    "edge_coincidence",
    "unknown",
]


# Near-zero thresholds — matched to pipeline float precision. desired_pos
# is displayed at 2dp and Kelly outputs can be on the order of
# bankroll / var (typically >>1), so 1e-6 is a safe "effectively zero" cutoff.
POS_ZERO_TOL = 1e-6
EDGE_ZERO_TOL = 1e-9
VAR_ZERO_TOL = 1e-12
BANKROLL_ZERO_TOL = 1e-9
MV_MATCH_TOL = 1e-9


def classify(
    *,
    desired_pos: float,
    raw_edge: float,
    raw_variance: float,
    total_fair: float,
    total_market_fair: float,
    aggregate_market_value: float | None,
    has_active_blocks: bool,
    bankroll: float,
) -> tuple[ZeroPositionReason, str]:
    """Return (reason, human-readable hint) for a near-zero desired_pos."""
    if not has_active_blocks:
        return (
            "no_active_blocks",
            "No active blocks contribute to this (symbol, expiry). "
            "Register a stream whose blocks fan out here, or flip an inactive "
            "stream back on.",
        )
    if abs(bankroll) <= BANKROLL_ZERO_TOL:
        return (
            "zero_bankroll",
            "Bankroll is zero. Call client.set_bankroll(...) with a positive "
            "value so the Kelly formula can produce a position.",
        )
    if abs(raw_variance) <= VAR_ZERO_TOL:
        return (
            "zero_variance",
            "Variance is zero — all contributing blocks have var=0. Check "
            "var_fair_ratio on your BlockConfig and that raw_value has been "
            "pushed recently.",
        )
    if abs(raw_edge) <= EDGE_ZERO_TOL:
        markets_match = abs(total_fair - total_market_fair) <= MV_MATCH_TOL
        if aggregate_market_value is None and markets_match:
            return (
                "no_market_value",
                "No market_value on rows AND no aggregate set for this pair. "
                "Pass market_value on your SnapshotRow or call "
                "set_market_values(...) — see the §7.1 diagnostic notes.",
            )
        return (
            "edge_coincidence",
            "edge = 0 but market values ARE set. The pipeline thinks fair "
            "genuinely matches market; this may be expected.",
        )
    return (
        "unknown",
        f"desired_pos≈0 but edge={raw_edge:.6g}, var={raw_variance:.6g}, "
        f"bankroll={bankroll:.2f} are non-zero. Inspect the smoothing / "
        f"position-sizing transforms.",
    )
