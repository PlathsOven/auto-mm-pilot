"""Block configuration table endpoints — scoped to the calling user."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime as _dt

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.blocks.manual_block import apply_manual_block
from server.api.engine_state import get_pipeline_results, rerun_and_broadcast
from server.api.llm.block_intents import log_post_commit_edit_if_recent
from server.api.models import (
    BlockListResponse,
    BlockRowResponse,
    ManualBlockRequest,
    UpdateBlockRequest,
)
from server.api.routers.events import log_event
from server.api.stream_registry import get_manual_block_store, get_stream_registry
from server.api.ws import get_current_tick_ts
from server.api.ws_serializers import format_expiry
from server.core.config import BlockConfig

log = logging.getLogger(__name__)

router = APIRouter()


def _blocks_from_pipeline(user_id: str) -> list[BlockRowResponse]:
    results = get_pipeline_results(user_id)
    if results is None:
        return []

    blocks_df = results["blocks_df"]
    block_series_df = results.get("block_series_df")

    latest_vars: dict[str, dict[str, float]] = {}
    if block_series_df is not None and block_series_df.height > 0:
        current_ts = get_current_tick_ts(user_id)

        if current_ts is not None:
            at_or_before = block_series_df.filter(pl.col("timestamp") <= current_ts)
            missing_blocks = (
                block_series_df.filter(
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
                block_series_df
                .sort("timestamp")
                .group_by("block_name")
                .first()
            )

        for row_dict in best_rows.select("block_name", "fair", "var").to_dicts():
            latest_vars[row_dict["block_name"]] = {
                "fair": row_dict["fair"],
                "var": row_dict["var"],
            }

    store = get_manual_block_store(user_id)
    # Deterministic row order on the wire. `blocks_df` originates from
    # `group_by(sc.key_cols).agg(pl.all().last())` inside `build_blocks_df`
    # — without `maintain_order` Polars returns groups in hash order, so the
    # same data comes back in a different sequence on each rerun, which made
    # the Block Inspector list visibly reshuffle on every poll. Sort the full
    # composite identity before emitting so the client sees a stable ordering.
    identity_cols = [
        c for c in ("stream_name", "block_name", "symbol", "expiry", "space_id")
        if c in blocks_df.columns
    ]
    if identity_cols:
        blocks_df = blocks_df.sort(identity_cols)
    rows: list[BlockRowResponse] = []
    for block_dict in blocks_df.to_dicts():
        block_name = block_dict["block_name"]
        stream_name = block_dict["stream_name"]
        block_latest_var = latest_vars.get(block_name, {})

        start_ts = block_dict.get("start_timestamp")
        start_str = start_ts.isoformat() if hasattr(start_ts, "isoformat") and start_ts is not None else None

        source = "manual" if store.is_manual(stream_name) else "stream"

        # Normalise expiry to the same DDMMMYY format the position grid uses
        # (`format_expiry` shared with ws_serializers). Without this the block
        # row's expiry was "2026-03-27T00:00:00" while the grid's was
        # "27MAR26" — column-filter equality matched neither, breaking the
        # follow-focus auto-filter.
        raw_expiry = block_dict.get("expiry")
        expiry_str = format_expiry(raw_expiry) if raw_expiry is not None else ""

        reg = get_stream_registry(user_id).get(stream_name)
        applies_to = (
            [tuple(p) for p in reg.applies_to] if reg is not None and reg.applies_to is not None
            else None
        )

        rows.append(BlockRowResponse(
            block_name=block_name,
            stream_name=stream_name,
            symbol=block_dict.get("symbol", ""),
            expiry=expiry_str,
            space_id=block_dict["space_id"],
            source=source,
            annualized=block_dict["annualized"],
            temporal_position=block_dict["temporal_position"],
            decay_end_size_mult=block_dict["decay_end_size_mult"],
            decay_rate_prop_per_min=block_dict["decay_rate_prop_per_min"],
            var_fair_ratio=block_dict["var_fair_ratio"],
            scale=block_dict["scale"],
            offset=block_dict["offset"],
            exponent=block_dict["exponent"],
            applies_to=applies_to,
            raw_value=block_dict.get("raw_fair", 0.0),
            fair=block_latest_var.get("fair"),
            var=block_latest_var.get("var"),
            market_value_source=block_dict.get("market_value_source"),
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

    await apply_manual_block(
        user_id=user.id,
        stream_name=req.stream_name,
        key_cols=req.key_cols,
        scale=req.scale,
        offset=req.offset,
        exponent=req.exponent,
        block=block,
        snapshot_rows=[r.model_dump() for r in req.snapshot_rows],
        applies_to=(
            [tuple(p) for p in req.applies_to]
            if req.applies_to is not None
            else None
        ),
        space_id_override=req.space_id,
    )

    # Server-side cross-check for usage analytics (client also fires
    # manual_block_create; the admin view compares the two counts).
    await log_event(user.id, "manual_block_create", {"stream_name": req.stream_name})

    all_blocks = await asyncio.to_thread(_blocks_from_pipeline, user.id)
    for b in all_blocks:
        if b.stream_name == req.stream_name:
            return b
    raise HTTPException(
        status_code=404,
        detail=f"Block '{req.stream_name}' not found in pipeline results",
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
    # Preserve any existing applies_to unless the caller explicitly set it.
    existing_applies_to = reg.applies_to
    applies_to = (
        [tuple(p) for p in req.applies_to] if req.applies_to is not None
        else existing_applies_to
    )
    # Check for a recent Build-orchestrator commit — a quick edit here
    # likely means the original proposal missed. Fire-and-forget.
    log_post_commit_edit_if_recent(user.id, stream_name, mutation="update")

    registry.configure(
        stream_name, scale=scale, offset=offset, exponent=exponent, block=block,
        applies_to=applies_to,
    )

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
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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
