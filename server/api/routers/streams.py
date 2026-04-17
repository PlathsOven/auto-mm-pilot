"""Stream CRUD endpoints — scoped to the calling user."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.models import (
    AdminConfigureStreamRequest,
    BlockConfigPayload,
    CreateStreamRequest,
    StreamListResponse,
    StreamResponse,
    UpdateStreamRequest,
)
from server.api.stream_registry import StreamRegistration, get_stream_registry
from server.core.config import BlockConfig

log = logging.getLogger(__name__)

router = APIRouter()


def _stream_to_response(reg: StreamRegistration) -> StreamResponse:
    """Convert a StreamRegistration to its API response model."""
    block_payload = None
    if reg.block is not None:
        block_payload = BlockConfigPayload(
            annualized=reg.block.annualized,
            size_type=reg.block.size_type,
            aggregation_logic=reg.block.aggregation_logic,
            temporal_position=reg.block.temporal_position,
            decay_end_size_mult=reg.block.decay_end_size_mult,
            decay_rate_prop_per_min=reg.block.decay_rate_prop_per_min,
            decay_profile=reg.block.decay_profile,
            var_fair_ratio=reg.block.var_fair_ratio,
        )
    return StreamResponse(
        stream_name=reg.stream_name,
        key_cols=reg.key_cols,
        status=reg.status,
        scale=reg.scale,
        offset=reg.offset,
        exponent=reg.exponent,
        block=block_payload,
    )


@router.post("/api/streams", response_model=StreamResponse, status_code=201)
async def create_stream(
    req: CreateStreamRequest,
    user: User = Depends(current_user),
) -> StreamResponse:
    registry = get_stream_registry(user.id)
    try:
        reg = registry.create(req.stream_name, req.key_cols)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _stream_to_response(reg)


@router.get("/api/streams", response_model=StreamListResponse)
async def list_streams(
    user: User = Depends(current_user),
) -> StreamListResponse:
    registry = get_stream_registry(user.id)
    return StreamListResponse(
        streams=[_stream_to_response(r) for r in registry.list_streams()],
    )


@router.patch("/api/streams/{stream_name}", response_model=StreamResponse)
async def update_stream(
    stream_name: str,
    req: UpdateStreamRequest,
    user: User = Depends(current_user),
) -> StreamResponse:
    registry = get_stream_registry(user.id)
    try:
        reg = registry.update(
            stream_name,
            new_name=req.stream_name,
            new_key_cols=req.key_cols,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _stream_to_response(reg)


@router.post("/api/streams/{stream_name}/configure", response_model=StreamResponse)
async def configure_stream(
    stream_name: str,
    req: AdminConfigureStreamRequest,
    user: User = Depends(current_user),
) -> StreamResponse:
    registry = get_stream_registry(user.id)
    try:
        block = BlockConfig(
            annualized=req.block.annualized,
            size_type=req.block.size_type,
            aggregation_logic=req.block.aggregation_logic,
            temporal_position=req.block.temporal_position,
            decay_end_size_mult=req.block.decay_end_size_mult,
            decay_rate_prop_per_min=req.block.decay_rate_prop_per_min,
            decay_profile=req.block.decay_profile,
            var_fair_ratio=req.block.var_fair_ratio,
        )
    except (AssertionError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid BlockConfig: {exc}") from exc

    try:
        reg = registry.configure(
            stream_name,
            scale=req.scale,
            offset=req.offset,
            exponent=req.exponent,
            block=block,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _stream_to_response(reg)


@router.delete("/api/streams/{stream_name}", status_code=204)
async def delete_stream(
    stream_name: str,
    user: User = Depends(current_user),
) -> None:
    registry = get_stream_registry(user.id)
    try:
        registry.delete(stream_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
