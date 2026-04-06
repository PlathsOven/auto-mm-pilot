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

import asyncio
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
    BlockListResponse,
    BlockRowResponse,
    CreateStreamRequest,
    InvestigateRequest,
    JustifyRequest,
    JustifyResponse,
    ManualBlockRequest,
    MarketPricingRequest,
    UpdateBlockRequest,
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
    get_market_pricing,
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
            await asyncio.to_thread(rerun_pipeline, stream_configs)
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

@app.get("/api/market-pricing")
async def read_market_pricing() -> dict:
    """Return the current market pricing dict (all space_id → price entries)."""
    return {"pricing": get_market_pricing()}


@app.post("/api/market-pricing", response_model=MarketPricingResponse)
async def update_market_pricing(req: MarketPricingRequest) -> MarketPricingResponse:
    """Merge new market pricing entries and re-run pipeline if streams are available."""
    registry = get_stream_registry()
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await asyncio.to_thread(rerun_pipeline, stream_configs, market_pricing=req.pricing)
            await restart_ticker()
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
            await asyncio.to_thread(rerun_pipeline, stream_configs, bankroll=req.bankroll)
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
        bv_sliced = bv.filter(pl.col("timestamp") >= current_ts)
        pd_sliced = pd.filter(pl.col("timestamp") >= current_ts)
        # If the ticker has advanced past this instrument's last timestamp,
        # fall back to the full (unfiltered) data instead of returning 404.
        if not bv_sliced.is_empty() or not pd_sliced.is_empty():
            bv = bv_sliced
            pd = pd_sliced

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


# ---------------------------------------------------------------------------
# Block configuration table
# ---------------------------------------------------------------------------

# In-memory store for manually created blocks (source="manual")
_manual_streams: dict[str, dict] = {}


def _blocks_from_pipeline() -> list[BlockRowResponse]:
    """Serialize the current blocks_df + block_var_df into BlockRowResponse list."""
    results = get_pipeline_results()
    if results is None:
        return []

    blocks_df = results["blocks_df"]
    block_var_df = results.get("block_var_df")

    # Get latest fair/market_fair/var per block from block_var_df.
    # Use per-block "latest at or before current_ts" so blocks from different
    # risk dimensions (with different time grids) always have data.
    latest_vars: dict[str, dict[str, float]] = {}
    if block_var_df is not None and block_var_df.height > 0:
        current_ts = get_current_tick_ts()
        for bn in block_var_df["block_name"].unique().to_list():
            block_slice = block_var_df.filter(pl.col("block_name") == bn)
            if current_ts is not None:
                at_or_before = block_slice.filter(pl.col("timestamp") <= current_ts)
                if at_or_before.height > 0:
                    best_ts = at_or_before["timestamp"].max()
                    at_tick = at_or_before.filter(pl.col("timestamp") == best_ts)
                else:
                    first_ts = block_slice["timestamp"].min()
                    at_tick = block_slice.filter(pl.col("timestamp") == first_ts)
            else:
                first_ts = block_slice["timestamp"].min()
                at_tick = block_slice.filter(pl.col("timestamp") == first_ts)
            for row in at_tick.iter_rows(named=True):
                latest_vars[row["block_name"]] = {
                    "fair": row.get("fair"),
                    "market_fair": row.get("market_fair"),
                    "var": row.get("var"),
                }

    rows: list[BlockRowResponse] = []
    for row in blocks_df.iter_rows(named=True):
        bn = row["block_name"]
        sn = row["stream_name"]
        lv = latest_vars.get(bn, {})

        start_ts = row.get("start_timestamp")
        start_str = start_ts.isoformat() if hasattr(start_ts, "isoformat") and start_ts is not None else None

        source = "manual" if sn in _manual_streams else "stream"

        # Serialize expiry (may be datetime or string)
        raw_expiry = row.get("expiry")
        expiry_str = raw_expiry.isoformat() if hasattr(raw_expiry, "isoformat") and raw_expiry is not None else str(raw_expiry) if raw_expiry is not None else ""

        rows.append(BlockRowResponse(
            block_name=bn,
            stream_name=sn,
            symbol=row.get("symbol", ""),
            expiry=expiry_str,
            space_id=row["space_id"],
            source=source,
            annualized=row["annualized"],
            size_type=row["size_type"],
            aggregation_logic=row["aggregation_logic"],
            temporal_position=row["temporal_position"],
            decay_end_size_mult=row["decay_end_size_mult"],
            decay_rate_prop_per_min=row["decay_rate_prop_per_min"],
            var_fair_ratio=row["var_fair_ratio"],
            scale=row["scale"],
            offset=row["offset"],
            exponent=row["exponent"],
            target_value=row["target_value"],
            raw_value=row["raw_value"],
            target_market_value=row.get("target_market_value"),
            fair=lv.get("fair"),
            market_fair=lv.get("market_fair"),
            var=lv.get("var"),
            start_timestamp=start_str,
            updated_at=_dt.now().isoformat(),
        ))
    return rows


@app.get("/api/blocks", response_model=BlockListResponse)
async def list_blocks() -> BlockListResponse:
    """Return all blocks from the current pipeline run."""
    return BlockListResponse(blocks=_blocks_from_pipeline())


@app.post("/api/blocks", response_model=BlockRowResponse, status_code=201)
async def create_manual_block(req: ManualBlockRequest) -> BlockRowResponse:
    """Create a manual block by registering a stream, configuring it, and re-running the pipeline."""
    registry = get_stream_registry()

    # Create the stream
    try:
        registry.create(req.stream_name, req.key_cols)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    # Configure it with the provided block params
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
        registry.delete(req.stream_name)
        raise HTTPException(status_code=422, detail=f"Invalid BlockConfig: {exc}") from exc

    try:
        registry.configure(
            req.stream_name,
            scale=req.scale,
            offset=req.offset,
            exponent=req.exponent,
            block=block,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Ingest snapshot rows
    try:
        registry.ingest_snapshot(req.stream_name, req.snapshot_rows)
    except (KeyError, ValueError) as exc:
        registry.delete(req.stream_name)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Apply optional space_id override
    if req.space_id:
        reg = registry.get(req.stream_name)
        if reg:
            reg.space_id_override = req.space_id

    # Track as manual
    _manual_streams[req.stream_name] = {"created_at": _dt.now().isoformat()}

    # Fire-and-forget pipeline rerun — return the stub immediately so the
    # client sees the block in the table within milliseconds.  Computed values
    # (fair, market_fair, var) will populate on the next 5 s poll once the
    # background pipeline finishes.
    stream_configs = registry.build_stream_configs()
    if stream_configs:
        async def _bg_rerun() -> None:
            try:
                await asyncio.to_thread(rerun_pipeline, stream_configs)
                await restart_ticker()
            except Exception:
                log.exception("Background pipeline re-run failed after manual block creation")
        asyncio.create_task(_bg_rerun())

    # Extract snapshot fields for the stub response
    snap = req.snapshot_rows[0] if req.snapshot_rows else {}
    raw_val = float(snap.get("raw_value", 0))

    return BlockRowResponse(
        block_name=req.stream_name,
        stream_name=req.stream_name,
        symbol=str(snap.get("symbol", "")),
        expiry=str(snap.get("expiry", "")),
        space_id=req.space_id or "pending",
        source="manual",
        annualized=req.block.annualized,
        size_type=req.block.size_type,
        aggregation_logic=req.block.aggregation_logic,
        temporal_position=req.block.temporal_position,
        decay_end_size_mult=req.block.decay_end_size_mult,
        decay_rate_prop_per_min=req.block.decay_rate_prop_per_min,
        var_fair_ratio=req.block.var_fair_ratio,
        scale=req.scale,
        offset=req.offset,
        exponent=req.exponent,
        target_value=0.0,
        raw_value=raw_val,
        updated_at=_dt.now().isoformat(),
    )


@app.patch("/api/blocks/{stream_name}", response_model=BlockRowResponse)
async def update_block(stream_name: str, req: UpdateBlockRequest) -> BlockRowResponse:
    """Update an existing block's configuration and/or snapshot, then re-run pipeline."""
    registry = get_stream_registry()

    reg = registry.get(stream_name)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_name}' not found")
    if reg.status != "READY":
        raise HTTPException(status_code=422, detail=f"Stream '{stream_name}' is not READY")

    # Build updated config from existing + patches
    scale = req.scale if req.scale is not None else reg.scale
    offset = req.offset if req.offset is not None else reg.offset
    exponent = req.exponent if req.exponent is not None else reg.exponent

    if req.block is not None:
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
    else:
        block = reg.block

    assert scale is not None and offset is not None and exponent is not None and block is not None
    registry.configure(stream_name, scale=scale, offset=offset, exponent=exponent, block=block)

    # Update snapshot if provided
    if req.snapshot_rows is not None:
        try:
            registry.ingest_snapshot(stream_name, req.snapshot_rows)
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Re-run pipeline
    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await asyncio.to_thread(rerun_pipeline, stream_configs)
            await restart_ticker()
        except Exception as exc:
            log.exception("Pipeline re-run failed after block update")
            raise HTTPException(
                status_code=500,
                detail=f"Block updated but pipeline re-run failed: {exc}",
            ) from exc

    # Return the updated block
    all_blocks = _blocks_from_pipeline()
    for b in all_blocks:
        if b.stream_name == stream_name:
            return b

    raise HTTPException(status_code=404, detail=f"Block '{stream_name}' not found in pipeline results")
