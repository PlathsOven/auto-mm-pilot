"""Unit tests for the ``forward_addition_blend`` expiry correlation calculator.

Checks:
* α=0 matches the classic ``√(T_short/T_long)`` term-structure shape
  (close-long → high, far → low).
* α=1 forces every off-diagonal to exactly 1.
* Intermediate α produces a linear blend between the two endpoints.
* Canonical ``a < b`` upper-triangle output.
* Param out of ``[0, 1]`` raises ``ValueError``.
* Elapsed expiry (``T_short`` below floor) doesn't explode — ``MIN_YEARS_TO_EXPIRY``
  clamp keeps the ratio in a sensible range.
* ``(n*(n-1))/2`` entries emitted for n distinct expiries.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

import pytest

from server.api.correlation_calculators import MIN_YEARS_TO_EXPIRY
from server.api.correlation_calculators.forward_addition_blend import (
    forward_addition_blend,
)


NOW = datetime(2026, 4, 24, 0, 0, 0)


def _iso_in_days(days: float) -> str:
    return (NOW + timedelta(days=days)).isoformat()


def _entries_by_pair(entries):
    return {(t.a, t.b): t.rho for t in entries}


# ---------------------------------------------------------------------------
# α = 0 → pure term structure
# ---------------------------------------------------------------------------


def test_alpha_zero_nearby_long_highly_correlated():
    t_i = _iso_in_days(90)
    t_j = _iso_in_days(97)
    entries = forward_addition_blend.compute_entries(
        expiries=[t_i, t_j],
        params={"alpha": 0.0},
        now=NOW,
    )
    pair = _entries_by_pair(entries)[(min(t_i, t_j), max(t_i, t_j))]
    # √(90/97) ≈ 0.9637
    assert math.isclose(pair, math.sqrt(90.0 / 97.0), rel_tol=1e-3)


def test_alpha_zero_far_pair_low_correlation():
    t_i = _iso_in_days(7)
    t_j = _iso_in_days(180)
    entries = forward_addition_blend.compute_entries(
        expiries=[t_i, t_j],
        params={"alpha": 0.0},
        now=NOW,
    )
    pair = _entries_by_pair(entries)[(min(t_i, t_j), max(t_i, t_j))]
    # √(7/180) ≈ 0.1972
    assert math.isclose(pair, math.sqrt(7.0 / 180.0), rel_tol=1e-3)


def test_alpha_zero_nearby_short_moderate_correlation():
    t_i = _iso_in_days(7)
    t_j = _iso_in_days(14)
    entries = forward_addition_blend.compute_entries(
        expiries=[t_i, t_j],
        params={"alpha": 0.0},
        now=NOW,
    )
    pair = _entries_by_pair(entries)[(min(t_i, t_j), max(t_i, t_j))]
    # √(7/14) ≈ 0.7071
    assert math.isclose(pair, math.sqrt(0.5), rel_tol=1e-3)


# ---------------------------------------------------------------------------
# α = 1 → all off-diagonals exactly 1
# ---------------------------------------------------------------------------


def test_alpha_one_all_ones():
    labels = [_iso_in_days(d) for d in (7, 30, 90, 180)]
    entries = forward_addition_blend.compute_entries(
        expiries=labels,
        params={"alpha": 1.0},
        now=NOW,
    )
    for t in entries:
        assert t.rho == 1.0


# ---------------------------------------------------------------------------
# Intermediate α → linear blend
# ---------------------------------------------------------------------------


def test_alpha_blend_is_linear_between_endpoints():
    t_i = _iso_in_days(7)
    t_j = _iso_in_days(180)
    alpha = 0.35

    def _rho(a):
        pair_map = _entries_by_pair(
            forward_addition_blend.compute_entries(
                expiries=[t_i, t_j],
                params={"alpha": a},
                now=NOW,
            )
        )
        return pair_map[(min(t_i, t_j), max(t_i, t_j))]

    expected = alpha * 1.0 + (1.0 - alpha) * math.sqrt(7.0 / 180.0)
    assert math.isclose(_rho(alpha), expected, rel_tol=1e-6)


# ---------------------------------------------------------------------------
# Canonical ordering + emitted count
# ---------------------------------------------------------------------------


def test_entries_are_upper_triangle_canonical():
    labels = [_iso_in_days(d) for d in (180, 7, 30)]
    entries = forward_addition_blend.compute_entries(
        expiries=labels,
        params={"alpha": 0.0},
        now=NOW,
    )
    for t in entries:
        assert t.a < t.b


def test_entry_count_matches_upper_triangle():
    labels = [_iso_in_days(d) for d in (7, 14, 30, 60, 90)]
    entries = forward_addition_blend.compute_entries(
        expiries=labels,
        params={"alpha": 0.5},
        now=NOW,
    )
    n = len(labels)
    assert len(entries) == n * (n - 1) // 2


def test_duplicate_expiries_deduped():
    t = _iso_in_days(30)
    other = _iso_in_days(60)
    entries = forward_addition_blend.compute_entries(
        expiries=[t, t, other, other],
        params={"alpha": 0.0},
        now=NOW,
    )
    # Two distinct labels → 1 pair.
    assert len(entries) == 1


# ---------------------------------------------------------------------------
# Parameter validation
# ---------------------------------------------------------------------------


def test_alpha_out_of_range_raises():
    labels = [_iso_in_days(7), _iso_in_days(30)]
    with pytest.raises(ValueError):
        forward_addition_blend.compute_entries(
            expiries=labels, params={"alpha": 1.5}, now=NOW,
        )
    with pytest.raises(ValueError):
        forward_addition_blend.compute_entries(
            expiries=labels, params={"alpha": -0.1}, now=NOW,
        )


def test_missing_alpha_defaults_to_zero():
    t_i = _iso_in_days(7)
    t_j = _iso_in_days(14)
    entries = forward_addition_blend.compute_entries(
        expiries=[t_i, t_j], params={}, now=NOW,
    )
    pair = _entries_by_pair(entries)[(min(t_i, t_j), max(t_i, t_j))]
    assert math.isclose(pair, math.sqrt(0.5), rel_tol=1e-3)


# ---------------------------------------------------------------------------
# Elapsed / near-now expiry clamp
# ---------------------------------------------------------------------------


def test_elapsed_short_expiry_clamped_not_nan():
    elapsed = (NOW - timedelta(days=5)).isoformat()
    future = _iso_in_days(90)
    entries = forward_addition_blend.compute_entries(
        expiries=[elapsed, future],
        params={"alpha": 0.0},
        now=NOW,
    )
    rho = next(iter(entries)).rho
    # Short leg floored at ``MIN_YEARS_TO_EXPIRY`` (≈1h); the ratio is very
    # small so the correlation is very small. Finite + in [0, 1].
    assert math.isfinite(rho)
    assert 0.0 <= rho <= 1.0
    assert rho < 0.05


def test_zero_tenor_leg_uses_floor():
    # Both tenors floored → identical → Corr at α=0 is √1 = 1.
    both_elapsed_a = (NOW - timedelta(days=5)).isoformat()
    both_elapsed_b = (NOW - timedelta(days=3)).isoformat()
    entries = forward_addition_blend.compute_entries(
        expiries=[both_elapsed_a, both_elapsed_b],
        params={"alpha": 0.0},
        now=NOW,
    )
    rho = next(iter(entries)).rho
    assert math.isclose(rho, 1.0, abs_tol=1e-9)


def test_min_years_floor_is_small_but_positive():
    assert 0 < MIN_YEARS_TO_EXPIRY < 1e-3


# ---------------------------------------------------------------------------
# Schema metadata
# ---------------------------------------------------------------------------


def test_schema_exposes_alpha_param():
    schema = forward_addition_blend.schema()
    assert schema.name == "forward_addition_blend"
    names = [p.name for p in schema.params]
    assert "alpha" in names
    alpha_param = next(p for p in schema.params if p.name == "alpha")
    assert alpha_param.min == 0.0
    assert alpha_param.max == 1.0
    assert alpha_param.default == 0.0
