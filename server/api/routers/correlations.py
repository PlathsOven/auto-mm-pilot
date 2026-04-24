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

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.correlation_store import (
    get_expiry_store,
    get_symbol_store,
)
from server.api.expiry import canonical_expiry_key
from server.api.models import (
    ExpiryCorrelationEntry,
    ExpiryCorrelationListResponse,
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
