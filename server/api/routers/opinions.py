"""
Opinions — unified trader-facing view over streams + manual blocks.

One entry per registered stream (data-driven or manual). The trader manages
opinions; blocks are the mathematical materialisation and live in the Blocks
tab / inspector. This router composes three existing sources into a single
shape:

  * StreamRegistration — description (editable), active flag, key_cols, etc.
  * BlockIntent        — original_phrasing (immutable audit trail) + any
                         Mode-B critique concerns flagged at commit time.
  * Pipeline results   — block_count per stream, i.e. how many
                         (symbol, expiry, space_id) rows the opinion
                         materialised into on the latest tick.

Active-toggle + delete delegate to the same registry calls as the streams
router — an opinion is a view, not a new store.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Response

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.connector_state import get_connector_state_store
from server.api.engine_state import get_engine, rerun_and_broadcast
from server.api.llm.block_intents import (
    get_for_stream as _get_intent_for_stream,
    log_post_commit_edit_if_recent,
)
from server.api.models import (
    Opinion,
    OpinionActivePatch,
    OpinionDescriptionPatch,
    OpinionsListResponse,
    StoredBlockIntent,
)
from server.api.routers.blocks import _blocks_from_pipeline
from server.api.stream_registry import (
    StreamRegistration,
    get_manual_block_store,
    get_stream_registry,
)
from server.api.ws import restart_ticker

log = logging.getLogger(__name__)

router = APIRouter()


def _last_update(reg: StreamRegistration) -> str | None:
    """Largest snapshot timestamp (ISO 8601) or None if no rows yet.

    Producers may push naive datetimes (normal path) or ISO strings (raw
    REST). Handle both without forcing a parse on the hot path.
    """
    if not reg.snapshot_rows:
        return None
    candidate = max(
        (r.get("timestamp") for r in reg.snapshot_rows if r.get("timestamp") is not None),
        default=None,
    )
    if candidate is None:
        return None
    return candidate.isoformat() if hasattr(candidate, "isoformat") else str(candidate)


def _concerns_from_intent(stored: StoredBlockIntent | None) -> bool:
    """True when the Stage-3.5 critique flagged concerns on a Mode-B derivation."""
    if stored is None:
        return False
    choice = stored.synthesis.choice
    if choice.mode != "custom":
        return False
    if choice.critique is None:
        return False
    return bool(choice.critique.concerns)


def _opinion_from_reg(
    reg: StreamRegistration,
    *,
    stored_intent: StoredBlockIntent | None,
    is_manual: bool,
    block_count: int,
) -> Opinion:
    return Opinion(
        name=reg.stream_name,
        kind="manual" if is_manual else "stream",
        description=reg.description,
        original_phrasing=stored_intent.original_phrasing if stored_intent else None,
        last_update=_last_update(reg),
        active=reg.active,
        block_count=block_count,
        has_concerns=_concerns_from_intent(stored_intent),
    )


async def _fetch_one(user_id: str, reg: StreamRegistration) -> Opinion:
    """Build one Opinion for the single-opinion PATCH paths."""
    store = get_manual_block_store(user_id)
    stored = await asyncio.to_thread(_get_intent_for_stream, user_id, reg.stream_name)
    blocks = await asyncio.to_thread(_blocks_from_pipeline, user_id)
    block_count = sum(1 for b in blocks if b.stream_name == reg.stream_name)
    return _opinion_from_reg(
        reg,
        stored_intent=stored,
        is_manual=store.is_manual(reg.stream_name),
        block_count=block_count,
    )


@router.get("/api/opinions", response_model=OpinionsListResponse)
async def list_opinions(user: User = Depends(current_user)) -> OpinionsListResponse:
    registry = get_stream_registry(user.id)
    regs = registry.list_streams()
    store = get_manual_block_store(user.id)

    # One pipeline read feeds block_count for every opinion — avoids an N+1.
    blocks = await asyncio.to_thread(_blocks_from_pipeline, user.id)
    block_counts: dict[str, int] = {}
    for b in blocks:
        block_counts[b.stream_name] = block_counts.get(b.stream_name, 0) + 1

    opinions: list[Opinion] = []
    for reg in regs:
        stored = await asyncio.to_thread(_get_intent_for_stream, user.id, reg.stream_name)
        opinions.append(_opinion_from_reg(
            reg,
            stored_intent=stored,
            is_manual=store.is_manual(reg.stream_name),
            block_count=block_counts.get(reg.stream_name, 0),
        ))
    return OpinionsListResponse(opinions=opinions)


@router.patch("/api/opinions/{name}/description", response_model=Opinion)
async def patch_description(
    name: str,
    req: OpinionDescriptionPatch,
    user: User = Depends(current_user),
) -> Opinion:
    """Update the editable trader description — no pipeline rerun needed.

    Writes to StreamRegistration.description. The immutable
    BlockIntent.original_phrasing stays untouched so the audit trail +
    feedback-loop reference point remain frozen.
    """
    registry = get_stream_registry(user.id)
    reg = registry.get(name)
    if reg is None:
        raise HTTPException(status_code=404, detail=f"Opinion '{name}' not found")
    reg.description = req.description
    return await _fetch_one(user.id, reg)


@router.patch("/api/opinions/{name}/active", response_model=Opinion)
async def patch_active(
    name: str,
    req: OpinionActivePatch,
    user: User = Depends(current_user),
) -> Opinion:
    """Toggle pipeline contribution — data is preserved either way.

    Same semantics as PATCH /api/streams/{name}/active: when all opinions go
    inactive the pipeline can't run, so we clear cached results and restart
    the ticker so the grid renders empty instead of showing stale positions.
    """
    registry = get_stream_registry(user.id)
    try:
        reg = registry.set_active(name, req.active)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs)
        except Exception as exc:
            log.exception("Pipeline rerun failed after opinions.patch_active")
            raise HTTPException(
                status_code=500,
                detail=f"Opinion active flag saved but pipeline rerun failed: {exc}",
            ) from exc
    else:
        get_engine(user.id).pipeline_results = None
        await restart_ticker(user.id)

    return await _fetch_one(user.id, reg)


@router.delete("/api/opinions/{name}", status_code=204)
async def delete_opinion(name: str, user: User = Depends(current_user)) -> Response:
    """Delete an opinion — thin delegation to the stream delete path.

    A rapid delete right after a Build-orchestrator commit is interpreted as
    "the proposal missed" and logged as a post-commit-edit failure signal;
    the helper no-ops when no recent commit is found.
    """
    log_post_commit_edit_if_recent(user.id, name, mutation="delete")
    registry = get_stream_registry(user.id)
    try:
        registry.delete(name, get_connector_state_store(user.id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)
