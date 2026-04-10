"""Stream CRUD endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/streams", response_model=StreamResponse, status_code=201)
async def create_stream(req: CreateStreamRequest) -> StreamResponse:
    """User creates a new data stream (PENDING until admin configures it)."""
    registry = get_stream_registry()
    try:
        reg = registry.create(req.stream_name, req.key_cols)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _stream_to_response(reg)


@router.get("/api/streams", response_model=StreamListResponse)
async def list_streams() -> StreamListResponse:
    """List all registered data streams."""
    registry = get_stream_registry()
    return StreamListResponse(
        streams=[_stream_to_response(r) for r in registry.list_streams()],
    )


@router.patch("/api/streams/{stream_name}", response_model=StreamResponse)
async def update_stream(stream_name: str, req: UpdateStreamRequest) -> StreamResponse:
    """User updates stream_name and/or key_cols."""
    registry = get_stream_registry()
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
    stream_name: str, req: AdminConfigureStreamRequest,
) -> StreamResponse:
    """Admin configures pipeline-facing parameters -> moves stream to READY."""
    registry = get_stream_registry()
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
async def delete_stream(stream_name: str) -> None:
    """Remove a registered stream."""
    registry = get_stream_registry()
    try:
        registry.delete(stream_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
