"""Method 1 — forward-addition α-blend.

Under ``E_later = E_earlier + ForwardExpiry_{earlier, later}`` with σ as
the std of cumulative returns (σ_X ∝ √T by the Brownian-path variance
identity), the ρ=0 case collapses to the classic ``√(T_short/T_long)``
term-structure shape. ρ=1 takes every off-diagonal to 1.

The method exposes a single ``alpha ∈ [0, 1]`` knob that linearly blends
the two extreme cases so the user picks one number and a full matrix
comes out with an intuitive shape (close-expiries more correlated, far
ones less):

    Corr(E_i, E_j) = α · 1 + (1 − α) · √(T_short / T_long)

Semantic note: "σ" here is the vol *of cumulative returns*, not the
vol of vol. See ``docs/decisions.md`` (2026-04-24, expiry correlation
calculator library) for why we landed on this framing over a
vol-of-vol model.
"""

from __future__ import annotations

import math
from datetime import datetime

from server.api.models import (
    ExpiryCorrelationMethodParam,
    ExpiryCorrelationMethodSchema,
)

from server.api.correlation_calculators.base import (
    CorrelationEntryTuple,
    year_fraction,
)


NAME: str = "forward_addition_blend"
TITLE: str = "Forward-addition α-blend"
DESCRIPTION: str = (
    "Blends the ρ=0 and ρ=1 cases of the forward-addition correlation "
    "identity. At α=0 you get the standard term-structure shape "
    "√(T_short/T_long); at α=1 every off-diagonal is 1."
)
PARAM_ALPHA: str = "alpha"


class ForwardAdditionBlendCalculator:
    """See module docstring."""

    name: str = NAME
    title: str = TITLE
    description: str = DESCRIPTION

    def schema(self) -> ExpiryCorrelationMethodSchema:
        return ExpiryCorrelationMethodSchema(
            name=self.name,
            title=self.title,
            description=self.description,
            params=[
                ExpiryCorrelationMethodParam(
                    name=PARAM_ALPHA,
                    label="Blend α (0 = term structure, 1 = all-ones)",
                    min=0.0,
                    max=1.0,
                    default=0.0,
                ),
            ],
        )

    def compute_entries(
        self,
        expiries: list[str],
        params: dict[str, float],
        now: datetime,
    ) -> list[CorrelationEntryTuple]:
        alpha = float(params.get(PARAM_ALPHA, 0.0))
        if not 0.0 <= alpha <= 1.0:
            raise ValueError(f"alpha must be in [0, 1]; got {alpha}")

        # Freeze the sort order up-front — the matrix materialiser reads
        # labels in lex-order, and the upper-triangle convention is
        # ``a < b`` by string order. Canonical ISO labels already sort
        # chronologically so string order matches time order.
        ordered = sorted(set(expiries))

        # Pre-compute year-fractions once per label so the nested loop
        # is O(n²) scalar ops instead of re-parsing datetimes per pair.
        tenor_years = {label: year_fraction(label, now) for label in ordered}

        entries: list[CorrelationEntryTuple] = []
        for i, a in enumerate(ordered):
            ta = tenor_years[a]
            for b in ordered[i + 1:]:
                tb = tenor_years[b]
                t_short = min(ta, tb)
                t_long = max(ta, tb)
                corr_zero = math.sqrt(t_short / t_long)
                rho = alpha + (1.0 - alpha) * corr_zero
                # Clamp for float noise near the α=1 limit — stays in
                # the Pydantic ``[-1, 1]`` range the entry validator
                # enforces.
                rho = max(-1.0, min(1.0, rho))
                entries.append(CorrelationEntryTuple(a=a, b=b, rho=rho))
        return entries


forward_addition_blend = ForwardAdditionBlendCalculator()
