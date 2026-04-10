"""Block configuration table endpoints."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime as _dt

import polars as pl
from fastapi import APIRouter, HTTPException

from server.api.engine_state import get_pipeline_results, rerun_and_broadcast
from server.api.models import (
    BlockConfigPayload,
    BlockListResponse,
    BlockRowResponse,
    ManualBlockRequest,
    UpdateBlockRequest,
)
from server.api.stream_registry import get_manual_block_store, get_stream_registry
from server.api.ws import get_current_tick_ts
from server.core.config import BlockConfig

log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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

    store = get_manual_block_store()
    rows: list[BlockRowResponse] = []
    for row in blocks_df.iter_rows(named=True):
        bn = row["block_name"]
        sn = row["stream_name"]
        lv = latest_vars.get(bn, {})

        start_ts = row.get("start_timestamp")
        start_str = start_ts.isoformat() if hasattr(start_ts, "isoformat") and start_ts is not None else None

        source = "manual" if store.is_manual(sn) else "stream"

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
            market_value=row.get("market_value"),
            target_market_value=row.get("target_market_value"),
            fair=lv.get("fair"),
            market_fair=lv.get("market_fair"),
            var=lv.get("var"),
            start_timestamp=start_str,
            updated_at=_dt.now().isoformat(),
        ))
    return rows


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/blocks", response_model=BlockListResponse)
async def list_blocks() -> BlockListResponse:
    """Return all blocks from the current pipeline run."""
    blocks = await asyncio.to_thread(_blocks_from_pipeline)
    return BlockListResponse(blocks=blocks)


@router.post("/api/blocks", response_model=BlockRowResponse, status_code=201)
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
        registry.ingest_snapshot(
            req.stream_name, [r.model_dump() for r in req.snapshot_rows],
        )
    except (KeyError, ValueError) as exc:
        registry.delete(req.stream_name)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Apply optional space_id override
    if req.space_id:
        reg = registry.get(req.stream_name)
        if reg:
            reg.space_id_override = req.space_id

    # Track as manual
    store = get_manual_block_store()
    store.mark(req.stream_name, _dt.now().isoformat())

    # Await the pipeline re-run synchronously so the caller's immediate
    # refetch of /api/blocks sees the new row. The rerun takes a few hundred
    # ms which the drawer's "Creating..." spinner already hides.
    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(stream_configs)
        except Exception as exc:
            log.exception("Pipeline re-run failed after manual block creation")
            raise HTTPException(
                status_code=500,
                detail=f"Block registered but pipeline re-run failed: {exc}",
            ) from exc

    # Extract snapshot fields for the stub response
    snap = req.snapshot_rows[0].model_dump() if req.snapshot_rows else {}
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


@router.delete("/api/blocks/{stream_name}", status_code=204)
async def delete_block(stream_name: str) -> None:
    """Delete a manual block. Stream-driven blocks cannot be deleted."""
    store = get_manual_block_store()
    if not store.is_manual(stream_name):
        raise HTTPException(
            status_code=403,
            detail=f"Block '{stream_name}' is stream-driven and cannot be deleted",
        )

    registry = get_stream_registry()
    try:
        registry.delete(stream_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Re-run pipeline so downstream consumers see the removal
    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(stream_configs)
        except Exception as exc:
            log.exception("Pipeline re-run failed after block deletion")
            raise HTTPException(
                status_code=500,
                detail=f"Block deleted but pipeline re-run failed: {exc}",
            ) from exc


@router.patch("/api/blocks/{stream_name}", response_model=BlockRowResponse)
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
            registry.ingest_snapshot(
                stream_name, [r.model_dump() for r in req.snapshot_rows],
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Re-run pipeline
    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(stream_configs)
        except Exception as exc:
            log.exception("Pipeline re-run failed after block update")
            raise HTTPException(
                status_code=500,
                detail=f"Block updated but pipeline re-run failed: {exc}",
            ) from exc

    # Return the updated block
    all_blocks = await asyncio.to_thread(_blocks_from_pipeline)
    for b in all_blocks:
        if b.stream_name == stream_name:
            return b

    raise HTTPException(status_code=404, detail=f"Block '{stream_name}' not found in pipeline results")
