"""Pure-function correlation matrix helpers.

Materialises a sparse ``(a, b) -> rho`` upper-triangle map into a dense
symmetric numpy matrix for a fixed label ordering. Enforces the
singularity check used by Stage H's pipeline call site.

All ``(a, b)`` keys are assumed to be canonical (``a < b`` by string
order) — the store enforces this on write. Labels not present in the
input map default to ``0.0`` (uncorrelated).
"""

from __future__ import annotations

import numpy as np


# Determinant threshold below which the matrix is flagged singular. At
# ``|det| < 1e-9`` ``np.linalg.solve`` starts producing nonsense on k≤30
# matrices; raising a typed error lets the pipeline propagate a trader-
# visible notification instead of emitting absurd positions.
SINGULAR_DET_THRESHOLD: float = 1e-9


class SingularCorrelationError(ValueError):
    """Raised when a correlation matrix is singular or near-singular.

    ``matrix_kind`` is ``"symbol"`` or ``"expiry"``. ``det`` and
    ``condition_number`` are surfaced on the wire so the Notifications
    Center can render both in the error card.
    """

    def __init__(
        self,
        matrix_kind: str,
        det: float,
        condition_number: float,
    ) -> None:
        self.matrix_kind = matrix_kind
        self.det = det
        self.condition_number = condition_number
        super().__init__(
            f"{matrix_kind.title()} correlation matrix is singular: "
            f"|det|={abs(det):.2e}, cond={condition_number:.2e}. "
            f"Check for perfect correlations (rho=±1) or redundant rows."
        )


def materialise_matrix(
    entries: dict[tuple[str, str], float],
    labels: list[str],
) -> np.ndarray:
    """Materialise a dense k×k correlation matrix for the given labels.

    Assumes every ``(a, b)`` key in ``entries`` has ``a < b`` (canonical
    upper-triangle). Diagonal is set to ``1.0``; missing off-diagonal
    entries are ``0.0``; off-diagonal entries are mirrored into the lower
    triangle so the result is symmetric. Labels referenced by ``entries``
    but not in ``labels`` are silently ignored (e.g. a correlation for a
    symbol the trader has since removed from their universe).
    """
    k = len(labels)
    label_idx = {label: i for i, label in enumerate(labels)}
    matrix = np.eye(k, dtype=np.float64)
    for (a, b), rho in entries.items():
        i = label_idx.get(a)
        j = label_idx.get(b)
        if i is None or j is None:
            continue
        matrix[i, j] = rho
        matrix[j, i] = rho
    return matrix


def check_singular(matrix: np.ndarray, matrix_kind: str) -> None:
    """Raise ``SingularCorrelationError`` if ``matrix`` is near-singular.

    No-op for the trivial 0×0 / 1×1 cases — they can't be singular by
    construction (1×1 is always ``[[1.0]]``).
    """
    if matrix.size == 0 or matrix.shape[0] <= 1:
        return
    det = float(np.linalg.det(matrix))
    if abs(det) < SINGULAR_DET_THRESHOLD:
        # Use the SVD-based condition number so the error message includes
        # a meaningful degeneracy signal even when |det| underflows.
        cond = float(np.linalg.cond(matrix))
        raise SingularCorrelationError(matrix_kind, det=det, condition_number=cond)
