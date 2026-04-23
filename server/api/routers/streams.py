"""Stream CRUD endpoints — scoped to the calling user."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.connector_state import get_connector_state_store
from server.api.engine_state import get_engine, rerun_and_broadcast
from server.api.llm.block_intents import log_post_commit_edit_if_recent
from server.api.models import (
    AdminConfigureStreamRequest,
    BlockConfigPayload,
    ConnectorStateSummary,
    CreateStreamRequest,
    SetStreamActiveRequest,
    StreamIntentResponse,
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
from server.api.ws import restart_ticker
from server.core.config import BlockConfig
from server.core.connectors import get_connector, resolve_params

log = logging.getLogger(__name__)

router = APIRouter()


def _stream_to_response(reg: StreamRegistration) -> StreamResponse:
    """Convert a StreamRegistration to its API response model."""
    block_payload = None
    if reg.block is not None:
        block_payload = BlockConfigPayload(
            annualized=reg.block.annualized,
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
        active=reg.active,
        scale=reg.scale,
        offset=reg.offset,
        exponent=reg.exponent,
        block=block_payload,
        description=reg.description,
        sample_csv=reg.sample_csv,
        value_column=reg.value_column,
        connector_name=reg.connector_name,
        connector_params=reg.connector_params,
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
            temporal_position=reg.block.temporal_position,
            decay_end_size_mult=reg.block.decay_end_size_mult,
            decay_rate_prop_per_min=reg.block.decay_rate_prop_per_min,
            decay_profile=reg.block.decay_profile,
            var_fair_ratio=reg.block.var_fair_ratio,
        )

    summary_payload: ConnectorStateSummary | None = None
    if reg.connector_name is not None:
        store = get_connector_state_store(user.id)
        summary = store.summary(reg.stream_name, reg.connector_name)
        if summary is not None:
            summary_payload = ConnectorStateSummary(
                min_n_eff=summary.min_n_eff,
                warmup_threshold=summary.warmup_threshold,
                symbols_tracked=summary.symbols_tracked,
            )

    return StreamStateResponse(
        stream_name=reg.stream_name,
        key_cols=list(reg.key_cols),
        status=reg.status,
        active=reg.active,
        scale=reg.scale,
        offset=reg.offset,
        exponent=reg.exponent,
        block=block_payload,
        description=reg.description,
        sample_csv=reg.sample_csv,
        value_column=reg.value_column,
        row_count=len(reg.snapshot_rows),
        last_ingest_ts=last_ts,
        connector_name=reg.connector_name,
        connector_params=reg.connector_params,
        connector_state_summary=summary_payload,
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
            temporal_position=req.block.temporal_position,
            decay_end_size_mult=req.block.decay_end_size_mult,
            decay_rate_prop_per_min=req.block.decay_rate_prop_per_min,
            decay_profile=req.block.decay_profile,
            var_fair_ratio=req.block.var_fair_ratio,
        )
    except (AssertionError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid BlockConfig: {exc}") from exc

    resolved_connector_params: dict | None = None
    if req.connector_name is not None:
        connector = get_connector(req.connector_name)
        if connector is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "UNKNOWN_CONNECTOR",
                    "connector_name": req.connector_name,
                },
            )
        try:
            resolved_connector_params = resolve_params(
                connector.params, req.connector_params,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        # Connector switch invalidates any existing state — evict before
        # the next push allocates fresh state for the new connector.
        get_connector_state_store(user.id).evict(stream_name)

    try:
        reg = registry.configure(
            stream_name,
            scale=req.scale,
            offset=req.offset,
            exponent=req.exponent,
            block=block,
            description=req.description,
            sample_csv=req.sample_csv,
            value_column=req.value_column,
            applies_to=(
                [tuple(p) for p in req.applies_to]
                if req.applies_to is not None
                else None
            ),
            connector_name=req.connector_name,
            connector_params=resolved_connector_params,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _stream_to_response(reg)


@router.patch("/api/streams/{stream_name}/active", response_model=StreamResponse)
async def set_stream_active(
    stream_name: str,
    req: SetStreamActiveRequest,
    user: User = Depends(current_user),
) -> StreamResponse:
    """Flip a stream's active flag and re-run the pipeline.

    Non-destructive: the stream stays in the registry with its full config.
    When deactivated, the stream drops out of ``build_stream_configs`` so the
    pipeline runs as if it wasn't there. When the last active stream is
    deactivated the pipeline can't run (zero streams) — we clear the cached
    results and restart the ticker so the grid renders empty instead of
    showing stale positions.
    """
    registry = get_stream_registry(user.id)
    try:
        reg = registry.set_active(stream_name, req.active)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs)
        except Exception as exc:
            log.exception("Pipeline rerun failed after set_active")
            raise HTTPException(
                status_code=500,
                detail=f"Stream active flag saved but pipeline rerun failed: {exc}",
            ) from exc
    else:
        get_engine(user.id).pipeline_results = None
        await restart_ticker(user.id)

    return _stream_to_response(reg)


@router.get("/api/streams/{stream_name}/timeseries", response_model=StreamTimeseriesResponse)
async def stream_timeseries(
    stream_name: str,
    user: User = Depends(current_user),
) -> StreamTimeseriesResponse:
    """Return per-key-combination time series of raw values for a stream.

    Sourced from the per-registration ``StreamHistoryBuffer`` — a ring buffer
    of every ingested ``(timestamp, raw_value)`` per key tuple. ``row_count``
    reflects the total points across every key (what the chart actually
    plots), not the latest-batch size.
    """
    registry = get_stream_registry(user.id)
    reg = registry.get(stream_name)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_name}' not found")

    series: list[StreamKeyTimeseries] = []
    total_points = 0
    for key_spec, pts in reg.history.series():
        series.append(StreamKeyTimeseries(
            key=key_spec,
            points=[
                StreamTimeseriesPoint(timestamp=p.timestamp.isoformat(), raw_value=p.raw_value)
                for p in pts
            ],
        ))
        total_points += len(pts)

    return StreamTimeseriesResponse(
        stream_name=reg.stream_name,
        key_cols=list(reg.key_cols),
        status=reg.status,
        row_count=total_points,
        series=series,
    )


@router.get("/api/streams/{stream_name}/intent", response_model=StreamIntentResponse)
async def stream_intent(
    stream_name: str,
    user: User = Depends(current_user),
) -> StreamIntentResponse:
    """Return the persisted Build-orchestrator intent for this stream.

    Powers the Inspector's "why does this block exist?" surface — shows
    the trader's original phrasing + Stage-1→4 trace. Streams created
    outside the Build orchestrator (pre-M3, or via the ``+ Manual block``
    drawer) return 404; the client surfaces a placeholder.
    """
    import asyncio as _asyncio
    from server.api.llm.block_intents import get_for_stream

    stored = await _asyncio.to_thread(get_for_stream, user.id, stream_name)
    if stored is None:
        raise HTTPException(
            status_code=404,
            detail=f"No Build-orchestrator intent recorded for stream '{stream_name}'",
        )
    return StreamIntentResponse(intent=stored)


@router.delete("/api/streams/{stream_name}", status_code=204)
async def delete_stream(
    stream_name: str,
    user: User = Depends(current_user),
) -> None:
    # Before deleting, check whether this stream was recently committed via
    # the Build orchestrator — a rapid delete is a signal the proposal
    # missed. Fire-and-forget; same helper used by blocks.update_block.
    log_post_commit_edit_if_recent(user.id, stream_name, mutation="delete")

    registry = get_stream_registry(user.id)
    try:
        registry.delete(stream_name, get_connector_state_store(user.id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
