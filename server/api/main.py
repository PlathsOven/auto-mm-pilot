"""
FastAPI application — APT terminal backend.

Endpoints:
    WS    /ws                              — Real-time pipeline data stream (internal UI)
    WS    /ws/client                       — Authenticated client data exchange channel
    POST  /api/investigate                 — SSE investigation token stream
    POST  /api/justify                     — JSON one-line justification
    GET   /api/health                      — Health check
    POST  /api/streams                     — Create a data stream
    GET   /api/streams                     — List all streams
    PATCH /api/streams/{name}              — Update stream name/key_cols
    POST  /api/streams/{name}/configure    — Admin: set pipeline params
    DEL   /api/streams/{name}              — Delete a stream
    POST  /api/snapshots                   — Ingest snapshot rows
    POST  /api/market-pricing              — Update market pricing
    PATCH /api/config/bankroll             — Set bankroll
    GET   /admin                           — Admin dashboard (server-side only)

Run:
    uvicorn server.api.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import json
import logging
from datetime import datetime as _dt
from pathlib import Path
from typing import Any

import polars as pl

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from server.api.models import (
    AdminConfigureStreamRequest,
    BankrollRequest,
    BankrollResponse,
    BlockConfigPayload,
    CreateStreamRequest,
    InvestigateRequest,
    JustifyRequest,
    JustifyResponse,
    MarketPricingRequest,
    MarketPricingResponse,
    SnapshotRequest,
    SnapshotResponse,
    StreamListResponse,
    StreamResponse,
    UpdateStreamRequest,
)
from server.api.stream_registry import StreamRegistration, get_stream_registry
from server.api.client_ws import client_ws
from server.api.ws import pipeline_ws, restart_ticker, get_current_tick_ts

from server.api.engine_state import (
    get_engine_state,
    get_mock_now,
    get_pipeline_results,
    get_pipeline_snapshot,
    get_snapshot_buffer,
    rerun_pipeline,
    set_bankroll,
    set_market_pricing,
    RISK_DIMENSION_COLS,
)
from server.api.llm.service import LlmService
from server.core.config import BlockConfig

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="APT Server", version="0.1.0")

# ---------------------------------------------------------------------------
# Admin dashboard — served from server/api/admin/
# ---------------------------------------------------------------------------

_ADMIN_DIR = Path(__file__).resolve().parent / "admin"


@app.get("/admin", include_in_schema=False)
async def admin_dashboard():
    return FileResponse(_ADMIN_DIR / "index.html")


app.mount("/admin/static", StaticFiles(directory=_ADMIN_DIR), name="admin-static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Singleton LLM service — lazily initialized so startup doesn't fail if
# OPENROUTER_API_KEY is missing (health check still works).
# ---------------------------------------------------------------------------

_llm_service: LlmService | None = None


def _get_llm_service() -> LlmService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LlmService()
    return _llm_service


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await pipeline_ws(websocket)


@app.websocket("/ws/client")
async def ws_client_endpoint(websocket: WebSocket) -> None:
    await client_ws(websocket)


@app.post("/api/investigate")
async def investigate(req: InvestigateRequest) -> StreamingResponse:
    """Stream investigation tokens as SSE (text/event-stream)."""
    try:
        service = _get_llm_service()
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    engine_state = get_engine_state()
    pipeline_snapshot = get_pipeline_snapshot()
    snapshot_buffer = get_snapshot_buffer()
    now = get_mock_now()

    async def event_generator():
        try:
            async for delta in service.investigate_stream(
                conversation=req.conversation,
                engine_state=engine_state,
                pipeline_snapshot=pipeline_snapshot,
                snapshot_buffer=snapshot_buffer,
                now=now,
            ):
                yield f"data: {json.dumps(delta)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            log.exception("Investigation stream failed")
            yield f"event: error\ndata: {exc}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/justify", response_model=JustifyResponse)
async def justify(req: JustifyRequest) -> JustifyResponse:
    """Generate a one-line justification for a position change."""
    try:
        service = _get_llm_service()
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    pipeline_snapshot = get_pipeline_snapshot()

    try:
        text = await service.justify(
            asset=req.asset,
            expiry=req.expiry,
            old_pos=req.old_pos,
            new_pos=req.new_pos,
            delta=req.delta,
            pipeline_snapshot=pipeline_snapshot,
        )
    except Exception as exc:
        log.exception("Justification failed")
        raise HTTPException(status_code=502, detail=f"LLM call failed: {exc}") from exc

    return JustifyResponse(justification=text)


# ---------------------------------------------------------------------------
# Stream management endpoints
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


@app.post("/api/streams", response_model=StreamResponse, status_code=201)
async def create_stream(req: CreateStreamRequest) -> StreamResponse:
    """User creates a new data stream (PENDING until admin configures it)."""
    registry = get_stream_registry()
    try:
        reg = registry.create(req.stream_name, req.key_cols)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _stream_to_response(reg)


@app.get("/api/streams", response_model=StreamListResponse)
async def list_streams() -> StreamListResponse:
    """List all registered data streams."""
    registry = get_stream_registry()
    return StreamListResponse(
        streams=[_stream_to_response(r) for r in registry.list_streams()],
    )


@app.patch("/api/streams/{stream_name}", response_model=StreamResponse)
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


@app.post("/api/streams/{stream_name}/configure", response_model=StreamResponse)
async def configure_stream(
    stream_name: str, req: AdminConfigureStreamRequest,
) -> StreamResponse:
    """Admin configures pipeline-facing parameters → moves stream to READY."""
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


@app.delete("/api/streams/{stream_name}", status_code=204)
async def delete_stream(stream_name: str) -> None:
    """Remove a registered stream."""
    registry = get_stream_registry()
    try:
        registry.delete(stream_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Snapshot ingestion
# ---------------------------------------------------------------------------

@app.post("/api/snapshots", response_model=SnapshotResponse)
async def ingest_snapshot(req: SnapshotRequest) -> SnapshotResponse:
    """Ingest snapshot rows for a READY stream and re-run the pipeline."""
    registry = get_stream_registry()
    try:
        accepted = registry.ingest_snapshot(req.stream_name, req.rows)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Re-run pipeline with all available streams
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            rerun_pipeline(stream_configs)
            await restart_ticker()
            pipeline_rerun = True
        except Exception as exc:
            log.exception("Pipeline re-run failed after snapshot ingestion")
            raise HTTPException(
                status_code=500,
                detail=f"Snapshot accepted but pipeline re-run failed: {exc}",
            ) from exc

    return SnapshotResponse(
        stream_name=req.stream_name,
        rows_accepted=accepted,
        pipeline_rerun=pipeline_rerun,
    )


# ---------------------------------------------------------------------------
# Market pricing
# ---------------------------------------------------------------------------

@app.post("/api/market-pricing", response_model=MarketPricingResponse)
async def update_market_pricing(req: MarketPricingRequest) -> MarketPricingResponse:
    """Update market pricing and re-run pipeline if streams are available."""
    set_market_pricing(req.pricing)

    registry = get_stream_registry()
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            rerun_pipeline(stream_configs, market_pricing=req.pricing)
            await restart_ticker()
            pipeline_rerun = True
        except Exception as exc:
            log.exception("Pipeline re-run failed after market pricing update")
            raise HTTPException(
                status_code=500,
                detail=f"Pricing updated but pipeline re-run failed: {exc}",
            ) from exc

    return MarketPricingResponse(
        spaces_updated=len(req.pricing),
        pipeline_rerun=pipeline_rerun,
    )


# ---------------------------------------------------------------------------
# Bankroll
# ---------------------------------------------------------------------------

@app.patch("/api/config/bankroll", response_model=BankrollResponse)
async def update_bankroll(req: BankrollRequest) -> BankrollResponse:
    """User sets the portfolio bankroll and re-runs pipeline if streams are available."""
    set_bankroll(req.bankroll)

    registry = get_stream_registry()
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            rerun_pipeline(stream_configs, bankroll=req.bankroll)
            await restart_ticker()
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


# ---------------------------------------------------------------------------
# Pipeline time series (read-only, for charting)
# ---------------------------------------------------------------------------

@app.get("/api/pipeline/dimensions")
async def pipeline_dimensions() -> dict:
    """Return available (symbol, expiry) pairs from the current pipeline run."""
    results = get_pipeline_results()
    if results is None:
        return {"dimensions": []}

    pos_df = results["desired_pos_df"]
    dims = (
        pos_df.select(RISK_DIMENSION_COLS)
        .unique()
        .sort(RISK_DIMENSION_COLS)
    )
    out = []
    for row in dims.iter_rows(named=True):
        out.append({
            "symbol": row["symbol"],
            "expiry": row["expiry"].isoformat() if hasattr(row["expiry"], "isoformat") else str(row["expiry"]),
        })
    return {"dimensions": out}


@app.get("/api/pipeline/timeseries")
async def pipeline_timeseries(symbol: str, expiry: str) -> dict:
    """Return full block-level and aggregated time series for a symbol/expiry."""
    results = get_pipeline_results()
    if results is None:
        raise HTTPException(status_code=404, detail="No pipeline results available")

    # Parse expiry string
    try:
        expiry_dt = _dt.fromisoformat(expiry)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid expiry format: {exc}") from exc

    block_var_df = results["block_var_df"]
    pos_df = results["desired_pos_df"]

    # Slice to current tick if the ticker is running
    current_ts = get_current_tick_ts()

    # Filter to requested dimension
    bv = block_var_df.filter(
        (pl.col("symbol") == symbol) & (pl.col("expiry") == expiry_dt)
    ).drop_nulls(subset=["fair"])
    pd = pos_df.filter(
        (pl.col("symbol") == symbol) & (pl.col("expiry") == expiry_dt)
    ).drop_nulls(subset=["raw_desired_position"])

    if current_ts is not None:
        bv = bv.filter(pl.col("timestamp") >= current_ts)
        pd = pd.filter(pl.col("timestamp") >= current_ts)

    if bv.is_empty() and pd.is_empty():
        raise HTTPException(status_code=404, detail=f"No data for {symbol}/{expiry}")

    # Block-level time series
    block_names = sorted(bv["block_name"].unique().to_list())
    blocks = []
    for bn in block_names:
        bd = bv.filter(pl.col("block_name") == bn).sort("timestamp")
        blocks.append({
            "block_name": bn,
            "space_id": bd["space_id"][0] if bd.height > 0 else "",
            "aggregation_logic": bd["aggregation_logic"][0] if bd.height > 0 else "",
            "timestamps": [t.isoformat() for t in bd["timestamp"].to_list()],
            "fair": bd["fair"].to_list(),
            "market_fair": bd["market_fair"].to_list(),
            "var": bd["var"].to_list(),
        })

    # Aggregated time series
    pd_sorted = pd.sort("timestamp")
    timestamps = [t.isoformat() for t in pd_sorted["timestamp"].to_list()]
    aggregated = {
        "timestamps": timestamps,
        "total_fair": pd_sorted["total_fair"].to_list(),
        "total_market_fair": pd_sorted["total_market_fair"].to_list(),
        "edge": pd_sorted["edge"].to_list(),
        "smoothed_edge": pd_sorted["smoothed_edge"].to_list(),
        "var": pd_sorted["var"].to_list(),
        "smoothed_var": pd_sorted["smoothed_var"].to_list(),
        "raw_desired_position": pd_sorted["raw_desired_position"].to_list(),
        "smoothed_desired_position": pd_sorted["smoothed_desired_position"].to_list(),
    }

    # Current decomposition (first timestamp = current tick)
    current_blocks = []
    if bv.height > 0:
        first_ts = bv["timestamp"].min()
        latest_bv = bv.filter(pl.col("timestamp") == first_ts)
        for row in latest_bv.iter_rows(named=True):
            current_blocks.append({
                "block_name": row["block_name"],
                "space_id": row["space_id"],
                "fair": row["fair"],
                "market_fair": row["market_fair"],
                "var": row["var"],
            })

    current_agg = {}
    if pd_sorted.height > 0:
        last = pd_sorted.row(0, named=True)
        current_agg = {
            "total_fair": last["total_fair"],
            "total_market_fair": last["total_market_fair"],
            "edge": last["edge"],
            "smoothed_edge": last["smoothed_edge"],
            "var": last["var"],
            "smoothed_var": last["smoothed_var"],
            "raw_desired_position": last["raw_desired_position"],
            "smoothed_desired_position": last["smoothed_desired_position"],
        }

    return {
        "symbol": symbol,
        "expiry": expiry,
        "blocks": blocks,
        "aggregated": aggregated,
        "current_decomposition": {
            "blocks": current_blocks,
            "aggregated": current_agg,
        },
    }
