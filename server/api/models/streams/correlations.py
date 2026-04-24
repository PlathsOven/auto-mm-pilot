"""
Correlation wire shapes — symbol × symbol + expiry × expiry matrices.

Matrices are transmitted as upper-triangle entry lists (``a < b`` enforced
by validator — the model swaps into canonical order on construction).
Diagonal entries are implicit (always ``1.0``) and never stored.

Per-user committed / draft slots live on the server in
``server.api.correlation_store``; this module only defines the wire
shapes and enforces the canonical ``(a, b)`` ordering at the boundary.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class CorrelationEntry(BaseModel):
    """One upper-triangle correlation entry.

    ``a < b`` is enforced by the post-init validator — if the caller
    sends ``(b, a)`` the model swaps them silently so the store can
    treat every entry as canonical. Self-pairs (``a == b``) are rejected
    because the diagonal is always ``1.0`` by construction.
    """
    a: str = Field(..., min_length=1)
    b: str = Field(..., min_length=1)
    rho: float = Field(..., ge=-1.0, le=1.0)

    @model_validator(mode="after")
    def _enforce_upper_triangle(self) -> "CorrelationEntry":
        if self.a == self.b:
            raise ValueError(
                "Diagonal entries are implicit (always 1.0) — "
                "do not include self-pairs."
            )
        if self.a > self.b:
            self.a, self.b = self.b, self.a
        return self


class SymbolCorrelationEntry(CorrelationEntry):
    """Entry in the symbol correlation matrix. ``a`` / ``b`` are symbol names."""
    pass


class ExpiryCorrelationEntry(CorrelationEntry):
    """Entry in the expiry correlation matrix.

    ``a`` / ``b`` are canonical-ISO expiry strings. The ``canonical_expiry_key``
    normaliser runs in the router before construction so DDMMMYY inputs
    land here already in ISO form; the upper-triangle swap then works
    on strings that already sort correctly.
    """
    pass


class SymbolCorrelationListResponse(BaseModel):
    """``GET /api/correlations/symbols`` — returns both committed and draft slots.

    ``draft`` is ``None`` when no draft is live. Clients render the
    committed matrix as the baseline; a non-null ``draft`` unlocks the
    Confirm / Discard affordances in the editor.
    """
    committed: list[SymbolCorrelationEntry]
    draft: list[SymbolCorrelationEntry] | None = None


class ExpiryCorrelationListResponse(BaseModel):
    """``GET /api/correlations/expiries`` — same shape as the symbol response."""
    committed: list[ExpiryCorrelationEntry]
    draft: list[ExpiryCorrelationEntry] | None = None


class SetSymbolCorrelationsRequest(BaseModel):
    """``PUT /api/correlations/symbols/draft`` — overwrites the draft matrix."""
    entries: list[SymbolCorrelationEntry]


class SetExpiryCorrelationsRequest(BaseModel):
    """``PUT /api/correlations/expiries/draft`` — overwrites the draft matrix."""
    entries: list[ExpiryCorrelationEntry]
