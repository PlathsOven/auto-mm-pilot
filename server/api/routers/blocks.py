"""Block configuration table endpoints — scoped to the calling user."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime as _dt

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import get_pipeline_results, rerun_and_broadcast
from server.api.models import (
    BlockListResponse,
    BlockRowResponse,
    ManualBlockRequest,
    UpdateBlockRequest,
)
from server.api.routers.events import log_event
from server.api.stream_registry import get_manual_block_store, get_stream_registry
from server.api.ws import get_current_tick_ts
from server.core.config import BlockConfig

log = logging.getLogger(__name__)

router = APIRouter()


def _blocks_from_pipeline(user_id: str) -> list[BlockRowResponse]:
    results = get_pipeline_results(user_id)
    if results is None:
        return []

    blocks_df = results["blocks_df"]
    block_var_df = results.get("block_var_df")

    latest_vars: dict[str, dict[str, float]] = {}
    if block_var_df is not None and block_var_df.height > 0:
        current_ts = get_current_tick_ts(user_id)

        if current_ts is not None:
            at_or_before = block_var_df.filter(pl.col("timestamp") <= current_ts)
            missing_blocks = (
                block_var_df.filter(
                    ~pl.col("block_name").is_in(at_or_before["block_name"].unique())
                )
                .sort("timestamp")
                .group_by("block_name")
                .first()
            )
            best_rows = (
                at_or_before
                .sort("timestamp")
                .group_by("block_name")
                .last()
            )
            if missing_blocks.height > 0:
                best_rows = pl.concat([best_rows, missing_blocks])
        else:
            best_rows = (
                block_var_df
                .sort("timestamp")
                .group_by("block_name")
                .first()
            )

        for row_dict in best_rows.select("block_name", "fair", "market_fair", "var").to_dicts():
            latest_vars[row_dict["block_name"]] = {
                "fair": row_dict["fair"],
                "market_fair": row_dict["market_fair"],
                "var": row_dict["var"],
            }

    store = get_manual_block_store(user_id)
    rows: list[BlockRowResponse] = []
    for block_dict in blocks_df.to_dicts():
        block_name = block_dict["block_name"]
        stream_name = block_dict["stream_name"]
        block_latest_var = latest_vars.get(block_name, {})

        start_ts = block_dict.get("start_timestamp")
        start_str = start_ts.isoformat() if hasattr(start_ts, "isoformat") and start_ts is not None else None

        source = "manual" if store.is_manual(stream_name) else "stream"

        raw_expiry = block_dict.get("expiry")
        expiry_str = raw_expiry.isoformat() if hasattr(raw_expiry, "isoformat") and raw_expiry is not None else str(raw_expiry) if raw_expiry is not None else ""

        rows.append(BlockRowResponse(
            block_name=block_name,
            stream_name=stream_name,
            symbol=block_dict.get("symbol", ""),
            expiry=expiry_str,
            space_id=block_dict["space_id"],
            source=source,
            annualized=block_dict["annualized"],
            size_type=block_dict["size_type"],
            aggregation_logic=block_dict["aggregation_logic"],
            temporal_position=block_dict["temporal_position"],
            decay_end_size_mult=block_dict["decay_end_size_mult"],
            decay_rate_prop_per_min=block_dict["decay_rate_prop_per_min"],
            var_fair_ratio=block_dict["var_fair_ratio"],
            scale=block_dict["scale"],
            offset=block_dict["offset"],
            exponent=block_dict["exponent"],
            target_value=block_dict["target_value"],
            raw_value=block_dict["raw_value"],
            market_value=block_dict.get("market_value"),
            target_market_value=block_dict.get("target_market_value"),
            fair=block_latest_var.get("fair"),
            market_fair=block_latest_var.get("market_fair"),
            var=block_latest_var.get("var"),
            start_timestamp=start_str,
            updated_at=_dt.now().isoformat(),
        ))
    return rows


@router.get("/api/blocks", response_model=BlockListResponse)
async def list_blocks(user: User = Depends(current_user)) -> BlockListResponse:
    blocks = await asyncio.to_thread(_blocks_from_pipeline, user.id)
    return BlockListResponse(blocks=blocks)


@router.post("/api/blocks", response_model=BlockRowResponse, status_code=201)
async def create_manual_block(
    req: ManualBlockRequest,
    user: User = Depends(current_user),
) -> BlockRowResponse:
    registry = get_stream_registry(user.id)

    try:
        registry.create(req.stream_name, req.key_cols)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

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

    try:
        registry.ingest_snapshot(
            req.stream_name, [r.model_dump() for r in req.snapshot_rows],
        )
    except (KeyError, ValueError) as exc:
        registry.delete(req.stream_name)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if req.space_id:
        reg = registry.get(req.stream_name)
        if reg:
            reg.space_id_override = req.space_id

    registry.manual_blocks.mark(req.stream_name, _dt.now().isoformat())

    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs)
        except Exception as exc:
            log.exception("Pipeline re-run failed after manual block creation")
            try:
                registry.delete(req.stream_name)
            except KeyError:
                pass
            raise HTTPException(
                status_code=500,
                detail=f"Block registered but pipeline re-run failed: {exc}",
            ) from exc

    # Server-side cross-check for usage analytics (client also fires
    # manual_block_create; the admin view compares the two counts).
    await log_event(user.id, "manual_block_create", {"stream_name": req.stream_name})

    snap = req.snapshot_rows[0].model_dump() if req.snapshot_rows else {}
    raw_val = float(snap.get("raw_value", 0))
    mkt_val = float(snap.get("market_value")) if snap.get("market_value") is not None else None

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
        market_value=mkt_val,
        updated_at=_dt.now().isoformat(),
    )


@router.patch("/api/blocks/{stream_name}", response_model=BlockRowResponse)
async def update_block(
    stream_name: str,
    req: UpdateBlockRequest,
    user: User = Depends(current_user),
) -> BlockRowResponse:
    registry = get_stream_registry(user.id)

    reg = registry.get(stream_name)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Stream '{stream_name}' not found")
    if reg.status != "READY":
        raise HTTPException(status_code=422, detail=f"Stream '{stream_name}' is not READY")

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

    if req.snapshot_rows is not None:
        try:
            registry.ingest_snapshot(
                stream_name, [r.model_dump() for r in req.snapshot_rows],
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs)
        except Exception as exc:
            log.exception("Pipeline re-run failed after block update")
            raise HTTPException(
                status_code=500,
                detail=f"Block updated but pipeline re-run failed: {exc}",
            ) from exc

    all_blocks = await asyncio.to_thread(_blocks_from_pipeline, user.id)
    for b in all_blocks:
        if b.stream_name == stream_name:
            return b

    raise HTTPException(status_code=404, detail=f"Block '{stream_name}' not found in pipeline results")
