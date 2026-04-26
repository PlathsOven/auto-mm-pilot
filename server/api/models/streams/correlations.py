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


class ApplyExpiryCorrelationMethodRequest(BaseModel):
    """``POST /api/correlations/expiries/apply-method`` — populates draft from a calculator.

    ``method_name`` selects a calculator in ``server.api.correlation_calculators``;
    ``params`` is the method-specific parameter bag (e.g. ``{"alpha": 0.5}``
    for ``forward_addition_blend``). ``expiries`` is the full universe the
    calculator should compute pairs over — the server doesn't infer it from
    live positions because the correlation store is agnostic to that axis
    source. Callers pass canonical-ISO or DDMMMYY; the router canonicalises
    before the calculator runs so lex-sort matches the matrix materialiser.
    """
    method_name: str = Field(..., min_length=1)
    params: dict[str, float] = Field(default_factory=dict)
    expiries: list[str] = Field(..., min_length=2)


class ExpiryCorrelationMethodSchema(BaseModel):
    """One calculator's public-facing metadata (``GET /api/correlations/expiries/methods``).

    Clients render a picker from this list; the ``params`` schema tells the
    UI which sliders / inputs to draw. Each param carries its own bounds
    and a human-readable label so the UI doesn't need to hardcode them.
    """
    name: str
    title: str
    description: str
    params: list["ExpiryCorrelationMethodParam"]


class ExpiryCorrelationMethodParam(BaseModel):
    """One tunable parameter on a correlation-calculator method."""
    name: str
    label: str
    min: float
    max: float
    default: float


class ExpiryCorrelationMethodsResponse(BaseModel):
    """``GET /api/correlations/expiries/methods`` — the calculator library."""
    methods: list[ExpiryCorrelationMethodSchema]


ExpiryCorrelationMethodSchema.model_rebuild()
