"""Registry of expiry-correlation calculators.

Flat ``name -> calculator`` dict. Adding a new method means dropping its
module into this package and appending one entry below; no other wiring.
"""

from __future__ import annotations

from server.api.correlation_calculators.base import ExpiryCorrelationCalculator
from server.api.correlation_calculators.forward_addition_blend import (
    forward_addition_blend,
)


_CALCULATORS: dict[str, ExpiryCorrelationCalculator] = {
    forward_addition_blend.name: forward_addition_blend,
}


def get_calculator(name: str) -> ExpiryCorrelationCalculator:
    """Return the calculator registered under ``name``.

    Raises ``KeyError`` if unknown — the router translates that into a
    404 so the client picker never ships a name the server can't honour.
    """
    return _CALCULATORS[name]


def list_calculators() -> list[ExpiryCorrelationCalculator]:
    """Return every registered calculator. Order matches insertion order."""
    return list(_CALCULATORS.values())
