"""Zero-edge guard — refuses a first push that would silently zero positions.

The most common failure mode for a new integrator is "positions come back
all zero, no error anywhere." The root cause is always the same: rows
pushed without ``market_value`` and no aggregate market value set, so each
block's market defaults to its own fair, edge collapses to 0,
``desired_pos = edge · bankroll / var`` collapses to 0. Stream looks healthy;
positions silently flatline.

We fail closed on the *first* push of a freshly-configured stream unless
either (a) a row carries ``market_value``, (b) every covered (symbol,
expiry) pair has an aggregate market value, or (c) the caller passed
``allow_zero_edge=True``.

Subsequent pushes are not gated — the integrator has already set the
pattern with push #1.
"""

from __future__ import annotations

from typing import Any

from server.api.expiry import canonical_expiry_key
from server.api.market_value_store import MarketValueStore
from server.api.stream_registry import StreamRegistration


ZERO_EDGE_CODE = "ZERO_EDGE_BLOCKED"


class ZeroEdgeBlocked(Exception):
    """First push on a fresh stream would produce zero edge for every block."""

    def __init__(self, stream_name: str, pairs: list[tuple[str, str]]) -> None:
        self.stream_name = stream_name
        self.pairs = pairs
        super().__init__(
            f"Stream '{stream_name}': first push has no market_value on any "
            f"row and no aggregate market value is set for pair(s) "
            f"{pairs!r}. Add market_value to rows, call set_market_values() "
            f"for the missing pair(s), or pass allow_zero_edge=true to "
            f"confirm zero positions are expected."
        )


def check_zero_edge(
    reg: StreamRegistration,
    rows: list[dict[str, Any]],
    mv_store: MarketValueStore,
    *,
    allow_zero_edge: bool,
) -> None:
    """Raise ``ZeroEdgeBlocked`` if the first push would zero every position."""
    if allow_zero_edge:
        return
    if reg.has_snapshot:
        # Not the first push — we trust whatever pattern was established
        # on push #1. Gating every push would be too noisy.
        return
    if any(r.get("market_value") is not None for r in rows):
        return

    pairs = _covered_pairs(reg.key_cols, rows)
    if not pairs:
        # The stream's key_cols don't include symbol+expiry — cannot
        # determine coverage. Downstream validation handles this case.
        return

    mv_keys = set(mv_store.to_dict().keys())
    missing = [p for p in pairs if p not in mv_keys]
    if not missing:
        return

    raise ZeroEdgeBlocked(reg.stream_name, missing)


def _covered_pairs(
    key_cols: list[str],
    rows: list[dict[str, Any]],
) -> list[tuple[str, str]]:
    """Extract unique (symbol, canonical_expiry) pairs from the incoming rows.

    Returns ``[]`` when the stream's ``key_cols`` don't carry both symbol and
    expiry — the guard relies on that dimensionality to look up aggregate
    coverage, so streams keyed otherwise fall through.
    """
    if "symbol" not in key_cols or "expiry" not in key_cols:
        return []
    seen: set[tuple[str, str]] = set()
    for r in rows:
        sym = r.get("symbol")
        exp = r.get("expiry")
        if sym is None or exp is None:
            continue
        seen.add((str(sym), canonical_expiry_key(str(exp))))
    return sorted(seen)
