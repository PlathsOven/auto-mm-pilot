"""Aggregate market value endpoints — scoped to the calling user."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.market_value_store import (
    delete_market_value,
    get_all,
    set_entries,
)
from server.api.models import (
    MarketValueEntry,
    MarketValueListResponse,
    SetMarketValueRequest,
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/market-values", response_model=MarketValueListResponse)
async def list_market_values(
    user: User = Depends(current_user),
) -> MarketValueListResponse:
    entries = [MarketValueEntry(**e) for e in get_all(user.id)]
    return MarketValueListResponse(entries=entries)


@router.put("/api/market-values", response_model=MarketValueListResponse)
async def set_market_values(
    req: SetMarketValueRequest,
    user: User = Depends(current_user),
) -> MarketValueListResponse:
    set_entries(user.id, [e.model_dump() for e in req.entries])
    entries = [MarketValueEntry(**e) for e in get_all(user.id)]
    return MarketValueListResponse(entries=entries)


@router.delete("/api/market-values/{symbol}/{expiry}")
async def remove_market_value(
    symbol: str,
    expiry: str,
    user: User = Depends(current_user),
) -> dict[str, bool | str]:
    existed = delete_market_value(user.id, symbol, expiry)
    if not existed:
        raise HTTPException(status_code=404, detail=f"No aggregate for {symbol}/{expiry}")
    return {"deleted": True, "symbol": symbol, "expiry": expiry}
