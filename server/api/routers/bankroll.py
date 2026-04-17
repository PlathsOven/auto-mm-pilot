"""Bankroll configuration endpoints — scoped to the calling user."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import get_bankroll, rerun_and_broadcast, set_bankroll
from server.api.models import BankrollRequest, BankrollResponse
from server.api.stream_registry import get_stream_registry

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/config/bankroll", response_model=BankrollResponse)
async def read_bankroll(user: User = Depends(current_user)) -> BankrollResponse:
    return BankrollResponse(bankroll=get_bankroll(user.id), pipeline_rerun=False)


@router.patch("/api/config/bankroll", response_model=BankrollResponse)
async def update_bankroll(
    req: BankrollRequest,
    user: User = Depends(current_user),
) -> BankrollResponse:
    set_bankroll(user.id, req.bankroll)

    registry = get_stream_registry(user.id)
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs, bankroll=req.bankroll)
            pipeline_rerun = True
        except Exception as exc:
            log.exception("Pipeline re-run failed after bankroll update")
            raise HTTPException(
                status_code=500,
                detail=f"Bankroll updated but pipeline re-run failed: {exc}",
            ) from exc

    return BankrollResponse(
        bankroll=req.bankroll,
        pipeline_rerun=pipeline_rerun,
    )
