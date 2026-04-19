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
    StreamKeyTimeseries,
    StreamListResponse,
    StreamResponse,
    StreamStateResponse,
    StreamTimeseriesPoint,
    StreamTimeseriesResponse,
    UpdateStreamRequest,
)
from server.api.stream_registry import StreamRegistration, get_stream_registry
from server.api.unregistered_push_store import get_store as get_unregistered_push_store
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
    # Operator closed the loop — the notification for this stream is no
    # longer actionable. Safe to call even if no entry exists (dismiss is a
    # no-op on missing keys).
    get_unregistered_push_store(user.id).dismiss(req.stream_name)
    return _stream_to_response(reg)


@router.get("/api/streams", response_model=StreamListResponse)
async def list_streams(
    user: User = Depends(current_user),
) -> StreamListResponse:
    registry = get_stream_registry(user.id)
    return StreamListResponse(
        streams=[_stream_to_response(r) for r in registry.list_streams()],
    )


@router.get("/api/streams/{stream_name}", response_model=StreamStateResponse)
async def describe_stream(
    stream_name: str,
    user: User = Depends(current_user),
) -> StreamStateResponse:
    """Return extended stream metadata — config + ingestion state.

    Used by the SDK's ``describe_stream`` helper. Sourced entirely from the
    in-memory registry; does not touch the pipeline results.
    """
    registry = get_stream_registry(user.id)
    reg = registry.get(stream_name)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_name}' not found")

    last_ts: str | None = None
    if reg.snapshot_rows:
        # Rows are coerced to native datetimes at seed-time; raw pushes may
        # still be ISO strings. Handle both.
        candidate = max(
            (r.get("timestamp") for r in reg.snapshot_rows if r.get("timestamp") is not None),
            default=None,
        )
        if candidate is not None:
            last_ts = candidate.isoformat() if hasattr(candidate, "isoformat") else str(candidate)

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

    return StreamStateResponse(
        stream_name=reg.stream_name,
        key_cols=list(reg.key_cols),
        status=reg.status,
        scale=reg.scale,
        offset=reg.offset,
        exponent=reg.exponent,
        block=block_payload,
        row_count=len(reg.snapshot_rows),
        last_ingest_ts=last_ts,
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


@router.get("/api/streams/{stream_name}/timeseries", response_model=StreamTimeseriesResponse)
async def stream_timeseries(
    stream_name: str,
    user: User = Depends(current_user),
) -> StreamTimeseriesResponse:
    """Return per-key-combination time series of raw/market values for a stream.

    Sourced from the in-memory snapshot rows on the per-user stream registry —
    no new storage. Snapshot rows are grouped by their key-column values so the
    Inspector can render one chart per (symbol, expiry) (or whatever the
    stream's ``key_cols`` define).
    """
    registry = get_stream_registry(user.id)
    reg = registry.get(stream_name)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_name}' not found")

    grouped: dict[tuple[str, ...], list[StreamTimeseriesPoint]] = {}
    key_specs: dict[tuple[str, ...], dict[str, str]] = {}
    for row in reg.snapshot_rows:
        key_values = tuple(str(row.get(k, "")) for k in reg.key_cols)
        ts_raw = row.get("timestamp")
        ts_str = ts_raw.isoformat() if hasattr(ts_raw, "isoformat") else str(ts_raw)
        try:
            raw_value = float(row.get("raw_value", 0.0))
        except (TypeError, ValueError):
            continue
        mv_raw = row.get("market_value")
        market_value: float | None
        try:
            market_value = float(mv_raw) if mv_raw is not None else None
        except (TypeError, ValueError):
            market_value = None
        grouped.setdefault(key_values, []).append(
            StreamTimeseriesPoint(timestamp=ts_str, raw_value=raw_value, market_value=market_value)
        )
        key_specs.setdefault(
            key_values, {k: str(row.get(k, "")) for k in reg.key_cols}
        )

    series = [
        StreamKeyTimeseries(key=key_specs[k], points=sorted(pts, key=lambda p: p.timestamp))
        for k, pts in grouped.items()
    ]
    series.sort(key=lambda s: tuple(s.key.values()))

    return StreamTimeseriesResponse(
        stream_name=reg.stream_name,
        key_cols=list(reg.key_cols),
        status=reg.status,
        row_count=len(reg.snapshot_rows),
        series=series,
    )


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
