"""Library of expiry-correlation calculators.

Each calculator is a pure function from ``(expiries, params, now)`` →
list of ``(a, b, rho)`` upper-triangle entries. The router writes the
returned entries to the draft slot via the existing correlation store.

Public surface:

* ``get_calculator(name)`` — look up one calculator by registered name.
* ``list_calculators()`` — the full registry for the UI picker.
* ``CorrelationEntryTuple`` — the emitted entry shape.
* ``year_fraction(expiry, now)`` — shared tenor helper (floored).
"""

from __future__ import annotations

from server.api.correlation_calculators.base import (
    MIN_YEARS_TO_EXPIRY,
    CorrelationEntryTuple,
    ExpiryCorrelationCalculator,
    year_fraction,
)
from server.api.correlation_calculators.registry import (
    get_calculator,
    list_calculators,
)

__all__ = [
    "MIN_YEARS_TO_EXPIRY",
    "CorrelationEntryTuple",
    "ExpiryCorrelationCalculator",
    "get_calculator",
    "list_calculators",
    "year_fraction",
]
