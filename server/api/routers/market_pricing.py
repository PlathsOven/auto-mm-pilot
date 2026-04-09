"""Market pricing endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from server.api.engine_state import (
    get_market_pricing,
    rerun_and_broadcast,
    set_market_pricing,
)
from server.api.models import MarketPricingRequest, MarketPricingResponse
from server.api.stream_registry import get_stream_registry

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/market-pricing")
async def read_market_pricing() -> dict:
    """Return the current market pricing dict (all space_id -> price entries)."""
    return {"pricing": get_market_pricing()}


@router.post("/api/market-pricing", response_model=MarketPricingResponse)
async def update_market_pricing(req: MarketPricingRequest) -> MarketPricingResponse:
    """Merge new market pricing entries and re-run pipeline if streams are available."""
    registry = get_stream_registry()
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await rerun_and_broadcast(stream_configs, market_pricing=req.pricing)
            pipeline_rerun = True
        except Exception as exc:
            log.exception("Pipeline re-run failed after market pricing update")
            raise HTTPException(
                status_code=500,
                detail=f"Pricing updated but pipeline re-run failed: {exc}",
            ) from exc
    else:
        # No streams ready yet — store pricing for use in future pipeline runs
        set_market_pricing(req.pricing)

    return MarketPricingResponse(
        spaces_updated=len(req.pricing),
        pipeline_rerun=pipeline_rerun,
    )
