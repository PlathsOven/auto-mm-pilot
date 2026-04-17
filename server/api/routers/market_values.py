"""Aggregate market value endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

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
async def list_market_values() -> MarketValueListResponse:
    """Return all aggregate market values currently stored."""
    entries = [MarketValueEntry(**e) for e in get_all()]
    return MarketValueListResponse(entries=entries)


@router.put("/api/market-values", response_model=MarketValueListResponse)
async def set_market_values(req: SetMarketValueRequest) -> MarketValueListResponse:
    """Batch-set aggregate market values. Sets dirty flag for coalesced rerun."""
    set_entries([e.model_dump() for e in req.entries])
    entries = [MarketValueEntry(**e) for e in get_all()]
    return MarketValueListResponse(entries=entries)


@router.delete("/api/market-values/{symbol}/{expiry}")
async def remove_market_value(symbol: str, expiry: str) -> dict[str, bool | str]:
    """Remove the aggregate for a symbol/expiry pair."""
    existed = delete_market_value(symbol, expiry)
    if not existed:
        raise HTTPException(status_code=404, detail=f"No aggregate for {symbol}/{expiry}")
    return {"deleted": True, "symbol": symbol, "expiry": expiry}
