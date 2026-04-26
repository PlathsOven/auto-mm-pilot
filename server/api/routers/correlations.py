"""Correlation matrix endpoints — scoped to the calling user.

Two parallel surfaces (symbols + expiries). Each exposes GET (both
slots), PUT draft (overwrite), POST confirm (promote → committed),
POST discard (clear draft). All four write paths set the dirty flag
on the matching store; the WS ticker triggers a rerun the same way it
does for ``MarketValueStore``.

Expiry labels are canonicalised to ISO via ``canonical_expiry_key``
before hitting the Pydantic validator — the upper-triangle swap relies
on consistent string ordering.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.correlation_calculators import get_calculator, list_calculators
from server.api.correlation_store import (
    get_expiry_store,
    get_symbol_store,
)
from server.api.expiry import canonical_expiry_key
from server.api.models import (
    ApplyExpiryCorrelationMethodRequest,
    ExpiryCorrelationEntry,
    ExpiryCorrelationListResponse,
    ExpiryCorrelationMethodsResponse,
    SetExpiryCorrelationsRequest,
    SetSymbolCorrelationsRequest,
    SymbolCorrelationEntry,
    SymbolCorrelationListResponse,
)

log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Symbol correlations
# ---------------------------------------------------------------------------

@router.get(
    "/api/correlations/symbols",
    response_model=SymbolCorrelationListResponse,
)
async def list_symbol_correlations(
    user: User = Depends(current_user),
) -> SymbolCorrelationListResponse:
    store = get_symbol_store(user.id)
    committed = [
        SymbolCorrelationEntry(a=a, b=b, rho=rho)
        for a, b, rho in store.committed_entries()
    ]
    draft_raw = store.draft_entries()
    draft = (
        [SymbolCorrelationEntry(a=a, b=b, rho=rho) for a, b, rho in draft_raw]
        if draft_raw is not None else None
    )
    return SymbolCorrelationListResponse(committed=committed, draft=draft)


@router.put(
    "/api/correlations/symbols/draft",
    response_model=SymbolCorrelationListResponse,
)
async def set_symbol_correlations_draft(
    req: SetSymbolCorrelationsRequest,
    user: User = Depends(current_user),
) -> SymbolCorrelationListResponse:
    store = get_symbol_store(user.id)
    store.set_draft([(e.a, e.b, e.rho) for e in req.entries])
    return await list_symbol_correlations(user=user)


@router.post(
    "/api/correlations/symbols/confirm",
    response_model=SymbolCorrelationListResponse,
)
async def confirm_symbol_correlations(
    user: User = Depends(current_user),
) -> SymbolCorrelationListResponse:
    store = get_symbol_store(user.id)
    if not store.confirm_draft():
        raise HTTPException(
            status_code=409,
            detail="No symbol-correlation draft to confirm.",
        )
    return await list_symbol_correlations(user=user)


@router.post(
    "/api/correlations/symbols/discard",
    response_model=SymbolCorrelationListResponse,
)
async def discard_symbol_correlations(
    user: User = Depends(current_user),
) -> SymbolCorrelationListResponse:
    get_symbol_store(user.id).discard_draft()
    return await list_symbol_correlations(user=user)


# ---------------------------------------------------------------------------
# Expiry correlations
# ---------------------------------------------------------------------------

def _canonicalise_expiry_request(
    entries: list[ExpiryCorrelationEntry],
) -> list[ExpiryCorrelationEntry]:
    """Re-run ``canonical_expiry_key`` on each entry and rebuild the model.

    The Pydantic validator enforces ``a < b`` by string comparison — if one
    side is DDMMMYY and the other ISO, the ordering is wrong even though
    both parse to the same date. Canonicalising here keeps every stored
    entry in the same format the pipeline's matrix materialiser will see.
    """
    out: list[ExpiryCorrelationEntry] = []
    for e in entries:
        a_iso = canonical_expiry_key(e.a)
        b_iso = canonical_expiry_key(e.b)
        out.append(ExpiryCorrelationEntry(a=a_iso, b=b_iso, rho=e.rho))
    return out


@router.get(
    "/api/correlations/expiries",
    response_model=ExpiryCorrelationListResponse,
)
async def list_expiry_correlations(
    user: User = Depends(current_user),
) -> ExpiryCorrelationListResponse:
    # Store + wire are both canonical ISO. The client's correlation axis is
    # sourced from ``DesiredPosition.expiryIso`` (same canonicaliser) so
    # grid lookups resolve 1:1 with stored entries. DDMMMYY on the wire
    # would lose time-of-day (08:00 UTC for crypto expiries) and misalign
    # against the pipeline's expiry column — see the 2026-04-24 fix.
    store = get_expiry_store(user.id)
    committed = [
        ExpiryCorrelationEntry(a=a, b=b, rho=rho)
        for a, b, rho in store.committed_entries()
    ]
    draft_raw = store.draft_entries()
    draft = (
        [ExpiryCorrelationEntry(a=a, b=b, rho=rho) for a, b, rho in draft_raw]
        if draft_raw is not None else None
    )
    return ExpiryCorrelationListResponse(committed=committed, draft=draft)


@router.put(
    "/api/correlations/expiries/draft",
    response_model=ExpiryCorrelationListResponse,
)
async def set_expiry_correlations_draft(
    req: SetExpiryCorrelationsRequest,
    user: User = Depends(current_user),
) -> ExpiryCorrelationListResponse:
    store = get_expiry_store(user.id)
    canonical = _canonicalise_expiry_request(req.entries)
    store.set_draft([(e.a, e.b, e.rho) for e in canonical])
    return await list_expiry_correlations(user=user)


@router.post(
    "/api/correlations/expiries/confirm",
    response_model=ExpiryCorrelationListResponse,
)
async def confirm_expiry_correlations(
    user: User = Depends(current_user),
) -> ExpiryCorrelationListResponse:
    store = get_expiry_store(user.id)
    if not store.confirm_draft():
        raise HTTPException(
            status_code=409,
            detail="No expiry-correlation draft to confirm.",
        )
    return await list_expiry_correlations(user=user)


@router.post(
    "/api/correlations/expiries/discard",
    response_model=ExpiryCorrelationListResponse,
)
async def discard_expiry_correlations(
    user: User = Depends(current_user),
) -> ExpiryCorrelationListResponse:
    get_expiry_store(user.id).discard_draft()
    return await list_expiry_correlations(user=user)


# ---------------------------------------------------------------------------
# Expiry correlation calculator library
# ---------------------------------------------------------------------------

@router.get(
    "/api/correlations/expiries/methods",
    response_model=ExpiryCorrelationMethodsResponse,
)
async def list_expiry_correlation_methods(
    user: User = Depends(current_user),
) -> ExpiryCorrelationMethodsResponse:
    """Return every registered calculator + its param schema.

    Used by the UI picker to render method name + sliders. Public to every
    authenticated user — calculators are code-owned, not per-user.
    """
    del user  # unused — method list is global
    return ExpiryCorrelationMethodsResponse(
        methods=[calc.schema() for calc in list_calculators()],
    )


@router.post(
    "/api/correlations/expiries/apply-method",
    response_model=ExpiryCorrelationListResponse,
)
async def apply_expiry_correlation_method(
    req: ApplyExpiryCorrelationMethodRequest,
    user: User = Depends(current_user),
) -> ExpiryCorrelationListResponse:
    """Compute a full draft upper-triangle via a named calculator.

    Flow: canonicalise expiry labels → look up calculator → run → write
    entries to the draft slot via ``set_draft``. The existing Confirm /
    Discard endpoints handle promotion — this route never commits.
    """
    try:
        calculator = get_calculator(req.method_name)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown calculator: {req.method_name!r}.",
        )

    canonical_expiries = [canonical_expiry_key(e) for e in req.expiries]
    # De-duplication happens inside the calculator, but guard the router
    # so a single-unique-expiry payload produces a clear 400 instead of
    # an empty draft silently.
    if len(set(canonical_expiries)) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least two distinct expiries are required.",
        )

    try:
        tuples = calculator.compute_entries(
            expiries=canonical_expiries,
            params=req.params,
            now=datetime.utcnow(),
        )
    except ValueError as exc:
        # Param-range or canonicalisation failures surface as 400.
        raise HTTPException(status_code=400, detail=str(exc))

    store = get_expiry_store(user.id)
    store.set_draft([(t.a, t.b, t.rho) for t in tuples])
    log.info(
        "Applied calculator %r: %d draft entries over %d expiries for user %s",
        req.method_name, len(tuples), len(canonical_expiries), user.id,
    )
    return await list_expiry_correlations(user=user)
