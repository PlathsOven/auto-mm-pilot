"""
Stage H — exposure → position correlation inverse.

Translates the Kelly-output exposure vector into the actual position
vector the trader should put on, via two independent upper-triangle
correlation matrices:

    P = C_s⁻¹ · E · C_e⁻¹

where ``E`` is the (k × m) exposure matrix per timestamp, ``C_s`` the
symbol-symbol correlation, and ``C_e`` the expiry-expiry correlation.
Default state — both correlation stores empty — materialises to the
identity in both axes, which makes Stage H numerically equivalent to
``P = E`` for every cell.

The transform is called twice per rerun (once for ``raw_*``, once for
``smoothed_*``) so the column plumbing stays explicit. When a draft
matrix is live on either store, a second solve writes to the nullable
``*_hypothetical`` column so the WS broadcast carries both the committed
position and the preview under the draft matrices.

Singularity is a loud failure, never a silent fallback — see
``server.api.correlation_matrix.check_singular``.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from server.api.correlation_matrix import (
    check_singular,
    materialise_matrix,
)
from server.core.transforms.registry import transform


@transform(
    "exposure_to_position", "correlation_inverse",
    description=(
        "Back out actual position from exposure: "
        "P = C_s^-1 · E · C_e^-1 (separable direct inversion)."
    ),
    formula="P = C_s⁻¹ · E · C_e⁻¹",
)
def etp_correlation_inverse(
    df: pl.DataFrame,
    risk_dimension_cols: list[str],
    symbol_correlations: dict[tuple[str, str], float],
    expiry_correlations: dict[tuple[str, str], float],
    symbol_correlations_draft: dict[tuple[str, str], float] | None,
    expiry_correlations_draft: dict[tuple[str, str], float] | None,
    exposure_col: str,
    position_col: str,
    hypothetical_col: str | None,
) -> pl.DataFrame:
    """Overwrite ``position_col`` with the correlation-inverted positions.

    ``exposure_col`` is read, ``position_col`` is written (replacing any
    existing column of that name). ``hypothetical_col`` is populated only
    when at least one of the draft maps is non-``None`` — otherwise it is
    added as an all-null Float64 column so downstream serializers can
    always select it.
    """
    if df.is_empty() or exposure_col not in df.columns:
        return df
    if "symbol" not in df.columns or "expiry" not in df.columns:
        return df

    # Deterministic axis ordering — lex sort prevents the group_by
    # hash-order drift called out in tasks/lessons.md from leaking into
    # the numpy solve (which is not associativity-safe under reordering).
    symbols = sorted({s for s in df["symbol"].to_list() if s is not None})
    expiry_rows = df["expiry"].to_list()
    expiries = sorted({e for e in expiry_rows if e is not None})
    # Timestamps are naive UTC datetimes from the pipeline forward grid.
    timestamps = sorted({ts for ts in df["timestamp"].to_list() if ts is not None})

    k = len(symbols)
    m = len(expiries)
    t_count = len(timestamps)
    if k == 0 or m == 0 or t_count == 0:
        return df

    sym_to_idx = {s: i for i, s in enumerate(symbols)}
    exp_to_idx = {e: j for j, e in enumerate(expiries)}
    ts_to_idx = {ts: t for t, ts in enumerate(timestamps)}

    # Vectorised index lookup — O(N) single pass via numpy fancy indexing.
    sym_arr = df["symbol"].to_numpy()
    exp_arr = df["expiry"].to_numpy()
    ts_arr = df["timestamp"].to_numpy()
    val_arr = df[exposure_col].to_numpy().astype(np.float64, copy=False)

    t_idx = np.array([ts_to_idx[ts] for ts in ts_arr], dtype=np.int64)
    s_idx = np.array([sym_to_idx[s] for s in sym_arr], dtype=np.int64)
    e_idx = np.array([exp_to_idx[e] for e in exp_arr], dtype=np.int64)

    # Fill the dense exposure grid E[t, i, j]. Any (t, i, j) not present
    # in the frame stays 0.0 — that maps to "no exposure", which is the
    # correct neutral for the matrix solve.
    E = np.zeros((t_count, k, m), dtype=np.float64)
    # NaNs in val_arr would propagate through the solve — replace with 0
    # (matches Stage G's VAR_FLOOR sentinel which already emits zeros).
    val_arr = np.nan_to_num(val_arr, nan=0.0)
    E[t_idx, s_idx, e_idx] = val_arr

    # Committed solve.
    C_s = materialise_matrix(symbol_correlations, symbols)
    C_e = materialise_matrix(expiry_correlations, expiries)
    check_singular(C_s, "symbol")
    check_singular(C_e, "expiry")
    P = _solve_batch(C_s, E, C_e)

    out = df.with_columns(
        pl.Series(position_col, P[t_idx, s_idx, e_idx], dtype=pl.Float64),
    )

    if hypothetical_col is None:
        return out

    # Hypothetical (draft) solve — only runs when at least one slot has a
    # draft. Draft slot absent → fall back to committed matrix for that
    # axis so the solve composes cleanly.
    draft_live = (
        symbol_correlations_draft is not None
        or expiry_correlations_draft is not None
    )
    if not draft_live:
        return out.with_columns(
            pl.lit(None, dtype=pl.Float64).alias(hypothetical_col),
        )

    sym_draft = (
        symbol_correlations_draft
        if symbol_correlations_draft is not None
        else symbol_correlations
    )
    exp_draft = (
        expiry_correlations_draft
        if expiry_correlations_draft is not None
        else expiry_correlations
    )
    C_s_draft = materialise_matrix(sym_draft, symbols)
    C_e_draft = materialise_matrix(exp_draft, expiries)
    check_singular(C_s_draft, "symbol")
    check_singular(C_e_draft, "expiry")
    P_draft = _solve_batch(C_s_draft, E, C_e_draft)

    return out.with_columns(
        pl.Series(hypothetical_col, P_draft[t_idx, s_idx, e_idx], dtype=pl.Float64),
    )


def _solve_batch(C_s: np.ndarray, E: np.ndarray, C_e: np.ndarray) -> np.ndarray:
    """Compute ``C_s⁻¹ · E · C_e⁻¹`` across every timestamp slice.

    ``np.linalg.solve`` broadcasts the left inverse over the leading
    timestamp axis; the right inverse uses a second solve on the
    transpose so we never materialise ``inv(C_e)`` explicitly.
    """
    # Left solve: (k, k) against (T, k, m) → (T, k, m).
    left = np.linalg.solve(C_s, E)
    # Right solve: X = left @ C_e⁻¹  <=>  (X C_e)ᵀ = (leftᵀ) @ (C_eᵀ)
    # so solve(C_eᵀ, leftᵀ) gives Xᵀ → transpose back. Equivalent to
    # left @ inv(C_e) without the explicit matrix inverse.
    right_T = np.linalg.solve(C_e.T, left.transpose(0, 2, 1))
    return right_T.transpose(0, 2, 1)
