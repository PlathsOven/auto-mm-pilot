"""Expiry-correlation-calculator protocol + shared helpers.

A calculator consumes a list of canonical-ISO expiries plus a ``params``
bag and emits a full upper-triangle of ``(a, b, rho)`` entries. The
registry looks calculators up by name; the router writes the returned
entries to the draft slot via ``get_expiry_store().set_draft(...)``.

Keep this surface minimal — additional methods get added by dropping a
new module into ``server/api/correlation_calculators/`` and registering
the calculator in ``registry.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from server.api.expiry import canonical_expiry_key
from server.api.models import ExpiryCorrelationMethodSchema
from server.core.config import SECONDS_PER_YEAR


# Floor on the time-to-expiry fed into the formulas. Expiries at or past
# the current tick would otherwise divide by ~0 and blow up — 1h in
# year-fraction terms keeps the math well-behaved without materially
# distorting the intended ``√(T_short/T_long)`` shape for any realistic
# non-degenerate pair.
MIN_YEARS_TO_EXPIRY: float = 1.0 / (365.25 * 24.0)


@dataclass(frozen=True)
class CorrelationEntryTuple:
    """One ``(a, b, rho)`` upper-triangle entry — canonical ``a < b``."""
    a: str
    b: str
    rho: float


class ExpiryCorrelationCalculator(Protocol):
    """Pure-function calculator contract.

    Implementations are module-level singletons — state lives in the
    ``params`` dict, not on the calculator itself.
    """

    name: str
    title: str
    description: str

    def schema(self) -> ExpiryCorrelationMethodSchema:
        """Return the method metadata used to render the UI picker."""
        ...

    def compute_entries(
        self,
        expiries: list[str],
        params: dict[str, float],
        now: datetime,
    ) -> list[CorrelationEntryTuple]:
        """Compute every upper-triangle entry over ``expiries``.

        ``expiries`` arrives already canonicalised (ISO) and deduplicated;
        the router is responsible for that normalisation. Implementations
        must emit canonical ``(a, b)`` with ``a < b``.
        """
        ...


def year_fraction(expiry_iso: str, now: datetime) -> float:
    """Return the time from ``now`` to ``expiry_iso`` in years.

    Canonicalises defensively in case a caller bypassed the router
    normaliser. Floors at ``MIN_YEARS_TO_EXPIRY`` to keep the
    calculator formulas well-conditioned when an expiry has already
    elapsed or is at the current tick.
    """
    canonical = canonical_expiry_key(expiry_iso)
    expiry_dt = datetime.fromisoformat(canonical)
    delta_secs = (expiry_dt - now.replace(tzinfo=None)).total_seconds()
    yf = delta_secs / SECONDS_PER_YEAR
    return max(yf, MIN_YEARS_TO_EXPIRY)
