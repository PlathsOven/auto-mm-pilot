"""Regression tests for Stage H (``exposure_to_position``).

Focus: when the pipeline hands Stage H a Polars frame with a ``pl.Datetime``
``expiry`` column and the correlation store supplies ISO-keyed entries,
the materialised matrix must reflect those entries — not silently
degenerate to the identity. The original implementation compared raw
datetime labels against string keys; every lookup missed and Stage H
emitted ``P = E`` regardless of what the trader had set. The user-
visible symptom was "Apply to draft" showing zero position change.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import polars as pl

from server.core.transforms.exposure_to_position import etp_correlation_inverse


def _build_frame(expiries: list[datetime], symbols: list[str], exposure: float) -> pl.DataFrame:
    """Single-timestamp frame with one row per (symbol, expiry)."""
    ts = datetime(2026, 4, 24, 12, 0, 0)
    rows = []
    for s in symbols:
        for e in expiries:
            rows.append({
                "timestamp": ts,
                "symbol": s,
                "expiry": e,
                "raw_desired_exposure": exposure,
            })
    return pl.DataFrame(rows, schema={
        "timestamp": pl.Datetime,
        "symbol": pl.Utf8,
        "expiry": pl.Datetime,
        "raw_desired_exposure": pl.Float64,
    })


def test_identity_matrices_yield_position_equals_exposure():
    exp_a = datetime(2026, 3, 27)
    exp_b = datetime(2026, 6, 26)
    df = _build_frame([exp_a, exp_b], ["BTC"], exposure=100.0)

    out = etp_correlation_inverse(
        df=df,
        risk_dimension_cols=["symbol", "expiry"],
        symbol_correlations={},
        expiry_correlations={},
        symbol_correlations_draft=None,
        expiry_correlations_draft=None,
        exposure_col="raw_desired_exposure",
        position_col="raw_desired_pos",
        hypothetical_col="raw_desired_position_hypothetical",
    )
    for row in out.iter_rows(named=True):
        assert math.isclose(row["raw_desired_pos"], 100.0, abs_tol=1e-9)
        assert row["raw_desired_position_hypothetical"] is None


def test_expiry_correlations_affect_positions():
    """The bug this test locks down: a non-identity expiry matrix must
    actually move positions. Before the canonical_expiry_key fix, string
    keys never matched datetime labels and the solve degenerated to
    identity, so P equalled E even with rho=0.8. Under the fix, the
    canonical-ISO lookup resolves, the solve inverts, and P ≠ E."""
    exp_a = datetime(2026, 3, 27)
    exp_b = datetime(2026, 6, 26)
    df = _build_frame([exp_a, exp_b], ["BTC"], exposure=100.0)

    # Correlation store uses canonical ISO keys (``a < b`` string order).
    expiry_corr = {
        ("2026-03-27T00:00:00", "2026-06-26T00:00:00"): 0.8,
    }

    out = etp_correlation_inverse(
        df=df,
        risk_dimension_cols=["symbol", "expiry"],
        symbol_correlations={},
        expiry_correlations=expiry_corr,
        symbol_correlations_draft=None,
        expiry_correlations_draft=None,
        exposure_col="raw_desired_exposure",
        position_col="raw_desired_pos",
        hypothetical_col=None,
    )
    positions = out["raw_desired_pos"].to_list()

    # With C_e = [[1, 0.8], [0.8, 1]], inv(C_e) = (1/0.36) * [[1, -0.8], [-0.8, 1]]
    # For E = [100, 100]ᵀ, P = E · inv(C_e) = (1/0.36) · [100 - 80, 100 - 80] = ~[55.55, 55.55]
    expected = 100.0 * (1 - 0.8) / (1 - 0.8 * 0.8)
    for p in positions:
        assert math.isclose(p, expected, rel_tol=1e-6), f"expected ≈ {expected}, got {p}"


def test_expiry_correlations_match_exchange_time_of_day():
    """Crypto options expire at 08:00 UTC, not midnight. If Stage H
    canonicalised to midnight while the draft store held the real
    expiry datetime, the labels would miss and the solve would
    degenerate. Production-realistic: pipeline expiry is 08:00 UTC, the
    draft store keys on the same 08:00 UTC canonical form."""
    exp_a = datetime(2026, 3, 27, 8, 0, 0)
    exp_b = datetime(2026, 6, 26, 8, 0, 0)
    df = _build_frame([exp_a, exp_b], ["BTC"], exposure=100.0)

    # Store key matches the pipeline's 08:00 UTC expiry — not midnight.
    expiry_corr = {
        ("2026-03-27T08:00:00", "2026-06-26T08:00:00"): 0.8,
    }

    out = etp_correlation_inverse(
        df=df,
        risk_dimension_cols=["symbol", "expiry"],
        symbol_correlations={},
        expiry_correlations=expiry_corr,
        symbol_correlations_draft=None,
        expiry_correlations_draft=None,
        exposure_col="raw_desired_exposure",
        position_col="raw_desired_pos",
        hypothetical_col=None,
    )
    expected = 100.0 * (1 - 0.8) / (1 - 0.8 * 0.8)
    for p in out["raw_desired_pos"].to_list():
        assert math.isclose(p, expected, rel_tol=1e-6)


def test_midnight_store_keys_miss_against_eight_am_pipeline():
    """Proves the symptom of the original bug: midnight-keyed store
    entries don't match the pipeline's 08:00 UTC expiry labels. If this
    test starts reporting ``P != E``, the canonicaliser is silently
    stretching times across boundaries — which would be a regression."""
    exp_a = datetime(2026, 3, 27, 8, 0, 0)  # pipeline at 08:00 UTC
    exp_b = datetime(2026, 6, 26, 8, 0, 0)
    df = _build_frame([exp_a, exp_b], ["BTC"], exposure=100.0)

    # Store key at midnight — the pre-fix client would produce this from
    # a DDMMMYY label via ``canonical_expiry_key``.
    expiry_corr = {
        ("2026-03-27T00:00:00", "2026-06-26T00:00:00"): 0.8,
    }

    out = etp_correlation_inverse(
        df=df,
        risk_dimension_cols=["symbol", "expiry"],
        symbol_correlations={},
        expiry_correlations=expiry_corr,
        symbol_correlations_draft=None,
        expiry_correlations_draft=None,
        exposure_col="raw_desired_exposure",
        position_col="raw_desired_pos",
        hypothetical_col=None,
    )
    # Identity fallback → P = E.
    for p in out["raw_desired_pos"].to_list():
        assert math.isclose(p, 100.0, abs_tol=1e-9)


def test_expiry_correlations_tolerate_microseconds_in_column():
    """Pipeline datetimes sometimes carry microseconds (depending on the
    upstream parse path). ``canonical_expiry_key`` strips them — the lookup
    must still resolve."""
    exp_a = datetime(2026, 3, 27, 0, 0, 0, 123)  # microseconds set
    exp_b = datetime(2026, 6, 26, 0, 0, 0, 456)
    df = _build_frame([exp_a, exp_b], ["BTC"], exposure=100.0)

    expiry_corr = {
        ("2026-03-27T00:00:00", "2026-06-26T00:00:00"): 0.5,
    }

    out = etp_correlation_inverse(
        df=df,
        risk_dimension_cols=["symbol", "expiry"],
        symbol_correlations={},
        expiry_correlations=expiry_corr,
        symbol_correlations_draft=None,
        expiry_correlations_draft=None,
        exposure_col="raw_desired_exposure",
        position_col="raw_desired_pos",
        hypothetical_col=None,
    )
    # Expected with rho=0.5: 100 * (1 - 0.5) / (1 - 0.25) = 66.666…
    expected = 100.0 * 0.5 / 0.75
    for p in out["raw_desired_pos"].to_list():
        assert math.isclose(p, expected, rel_tol=1e-6)


def test_draft_produces_hypothetical_column():
    """With a draft on the expiry store, ``*_hypothetical`` must be
    populated. The bug would have made it equal the committed position
    because both solves degenerated to identity."""
    exp_a = datetime(2026, 3, 27)
    exp_b = datetime(2026, 6, 26)
    df = _build_frame([exp_a, exp_b], ["BTC"], exposure=100.0)

    committed = {}  # identity
    draft = {("2026-03-27T00:00:00", "2026-06-26T00:00:00"): 0.8}

    out = etp_correlation_inverse(
        df=df,
        risk_dimension_cols=["symbol", "expiry"],
        symbol_correlations={},
        expiry_correlations=committed,
        symbol_correlations_draft=None,
        expiry_correlations_draft=draft,
        exposure_col="raw_desired_exposure",
        position_col="raw_desired_pos",
        hypothetical_col="raw_desired_position_hypothetical",
    )
    committed_positions = out["raw_desired_pos"].to_list()
    hyp_positions = out["raw_desired_position_hypothetical"].to_list()

    # Committed is identity → P = E.
    for p in committed_positions:
        assert math.isclose(p, 100.0, abs_tol=1e-9)

    # Draft with rho=0.8 → 100 * 0.2 / 0.36 ≈ 55.55.
    expected_hyp = 100.0 * 0.2 / 0.36
    for p in hyp_positions:
        assert p is not None
        assert math.isclose(p, expected_hyp, rel_tol=1e-6)

    # The two must differ — that's the whole point of the hypothetical column.
    assert not math.isclose(committed_positions[0], hyp_positions[0], rel_tol=1e-3)
