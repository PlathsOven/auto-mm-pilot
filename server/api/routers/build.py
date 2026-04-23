"""
Build-mode endpoint — `/api/build/converse`.

Runs the five-stage pipeline (router → intent → synthesis → preview →
commit) from the spec. This milestone (M2) implements Stages 1–3(+3.5)
and the SSE transport; impact preview (Stage 4) lands in M3 and the
feedback detector (Stage 5 write fanout) in M4.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import (
    current_positions_per_dim,
    get_engine,
    get_engine_state,
    rerun_and_broadcast,
)
from server.api.llm.block_intents import save_block_intent
from server.api.llm.build_orchestrator import run_build_pipeline
from server.api.llm.failures import log_failure
from server.api.llm.feedback_detector import detect_and_store
from server.api.llm.orchestration_config import get_llm_orchestration_config
from server.api.llm.preview import build_preview
from server.api.llm.service import LlmService
from server.api.models import (
    BlockCommitRequest,
    BlockCommitResponse,
    BlockPreviewRequest,
    BuildConverseRequest,
    LlmFailureLogRequest,
    PreviewResponse,
    StoredBlockIntent,
)
from server.api.stream_registry import get_stream_registry
from server.core.config import BlockConfig

log = logging.getLogger(__name__)

router = APIRouter()

# Lazily initialised so startup doesn't fail if OPENROUTER_API_KEY is missing.
_llm_service: LlmService | None = None


def _get_llm_service() -> LlmService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LlmService()
    return _llm_service


@router.post("/api/build/converse")
async def build_converse(
    req: BuildConverseRequest,
    user: User = Depends(current_user),
) -> StreamingResponse:
    """Run the Build orchestrator and stream stage events as SSE."""
    try:
        service = _get_llm_service()
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    engine_state = get_engine_state(user.id)
    orch_config = get_llm_orchestration_config()
    conversation_turn_id = str(uuid.uuid4())

    async def event_generator():
        assistant_response: list[str] = []
        try:
            async for event in run_build_pipeline(
                client=service.client,
                orch_config=orch_config,
                user_id=user.id,
                conversation_turn_id=conversation_turn_id,
                conversation=req.conversation,
                engine_state=engine_state,
            ):
                # Track any natural-language text so the correction
                # detector can run against the full assistant turn.
                delta = event.get("delta")
                if isinstance(delta, str):
                    assistant_response.append(delta)
                yield f"data: {json.dumps(event, default=str)}\n\n"

            # Fire the correction detector over the full exchange. The
            # unified feedback detector replaces this in M4.
            cfg = service.config
            if assistant_response:
                asyncio.create_task(detect_and_store(
                    client=service.client,
                    detector_models=cfg.detector_models,
                    max_tokens=cfg.max_tokens_detector,
                    temperature=cfg.temperature_detector,
                    context_window=orch_config.detector_context_window,
                    conversation=req.conversation,
                    assistant_response="".join(assistant_response),
                    user_id=user.id,
                    conversation_turn_id=conversation_turn_id,
                ))

            yield "data: [DONE]\n\n"
        except Exception:
            log.exception("Build converse stream failed")
            yield (
                "event: error\n"
                "data: {\"code\": 500, \"message\": \"Build failed\"}\n\n"
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Stage 4 — Impact preview
# ---------------------------------------------------------------------------

@router.post("/api/blocks/preview", response_model=PreviewResponse)
async def blocks_preview(
    req: BlockPreviewRequest,
    user: User = Depends(current_user),
) -> PreviewResponse:
    """Return the desired-position diff that would result from applying
    the proposal — without mutating live state."""
    try:
        return await asyncio.to_thread(build_preview, user.id, req.payload)
    except Exception as exc:
        log.exception("preview failed for user=%s", user.id)
        raise HTTPException(
            status_code=500, detail=f"Preview failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Stage 5 — Commit
# ---------------------------------------------------------------------------

@router.post("/api/blocks/commit", response_model=BlockCommitResponse)
async def blocks_commit(
    req: BlockCommitRequest,
    user: User = Depends(current_user),
) -> BlockCommitResponse:
    """Execute the proposal: register the stream, ingest any snapshot,
    rerun the pipeline + broadcast, and persist the intent triplet."""
    registry = get_stream_registry(user.id)
    payload = req.payload

    # Build the runtime BlockConfig — re-validates framework invariants
    # (decay_end_size_mult != 0 requires annualized == True) even though
    # the Pydantic layer already checked them.
    try:
        block = BlockConfig(
            annualized=payload.block.annualized,
            temporal_position=payload.block.temporal_position,
            decay_end_size_mult=payload.block.decay_end_size_mult,
            decay_rate_prop_per_min=payload.block.decay_rate_prop_per_min,
            var_fair_ratio=payload.block.var_fair_ratio,
        )
    except (AssertionError, ValueError) as exc:
        raise HTTPException(
            status_code=422, detail=f"Invalid BlockConfig: {exc}",
        ) from exc

    # Apply via registry helpers — matches the existing manual-block
    # flow in routers/blocks.py so registry invariants are enforced
    # consistently across both paths.
    try:
        registry.create(payload.stream_name, list(payload.key_cols))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        registry.configure(
            payload.stream_name,
            scale=payload.scale,
            offset=payload.offset,
            exponent=payload.exponent,
            block=block,
            applies_to=None,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if payload.action == "create_manual_block" and payload.snapshot_rows:
        try:
            registry.ingest_snapshot(
                payload.stream_name,
                [r.model_dump(mode="json") for r in payload.snapshot_rows],
            )
        except (KeyError, ValueError) as exc:
            registry.delete(payload.stream_name)
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        registry.manual_blocks.mark(
            payload.stream_name,
            datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        )

    stream_configs = registry.build_stream_configs()
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs)
        except Exception as exc:
            log.exception("Pipeline re-run failed after commit")
            try:
                registry.delete(payload.stream_name)
            except KeyError:
                pass
            raise HTTPException(
                status_code=500,
                detail=f"Block registered but pipeline re-run failed: {exc}",
            ) from exc

    # Persist the intent triplet. Failure here is a hard error — the
    # stream is already live but its provenance isn't captured.
    original_phrasing = _extract_original_phrasing(req.intent)
    intent_id = str(uuid.uuid4())
    stored = StoredBlockIntent(
        id=intent_id,
        user_id=user.id,
        stream_name=payload.stream_name,
        action=payload.action,
        original_phrasing=original_phrasing,
        intent=req.intent,
        synthesis=req.synthesis,
        preview=req.preview,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    try:
        await asyncio.to_thread(save_block_intent, stored)
    except Exception as exc:
        log.exception("block_intents persist failed — rolling back stream")
        # Roll back the stream so there's no partial-commit state (live
        # stream without a provenance row). Any rerun that already went
        # to clients will be superseded by the next tick with the
        # stream absent.
        try:
            registry.delete(payload.stream_name)
            rollback_configs = registry.build_stream_configs()
            if rollback_configs:
                await rerun_and_broadcast(user.id, rollback_configs)
        except Exception:
            log.exception("rollback after block_intents persist failure also failed")
        raise HTTPException(
            status_code=500,
            detail=f"Intent persistence failed — block was rolled back: {exc}",
        ) from exc

    new_positions = _extract_new_desired_positions(user.id)
    return BlockCommitResponse(
        stored_intent_id=intent_id,
        stream_name=payload.stream_name,
        new_desired_positions=new_positions,
    )


# ---------------------------------------------------------------------------
# UI-driven failure signals
# ---------------------------------------------------------------------------

@router.post("/api/llm/failures", status_code=204)
async def log_llm_failure(
    req: LlmFailureLogRequest,
    user: User = Depends(current_user),
) -> None:
    """Record a UI-driven failure signal (preview_rejection today).

    The client calls this when the trader cancels a proposal or otherwise
    surfaces a rejection the detector would not see from the conversation
    alone. The write is fire-and-forget from the caller's perspective:
    any persistence failure is logged server-side and swallowed so the
    client's UX never depends on a successful write.
    """
    trigger = "preview_ui" if req.signal_type == "preview_rejection" else "chat_message"
    await asyncio.to_thread(
        log_failure,
        user_id=user.id,
        signal_type=req.signal_type,
        trigger=trigger,
        conversation_turn_id=req.conversation_turn_id,
        llm_call_id=req.llm_call_id,
        metadata=req.metadata,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_original_phrasing(intent_output: Any) -> str:
    """Pull the trader's verbatim words out of an ``IntentOutput``.

    Every structured/raw intent variant carries ``original_phrasing`` as
    its first field; ``clarifying_question`` never reaches the commit
    path (that branch halts the orchestrator before Stage 3).
    """
    s = intent_output.structured
    if s is not None:
        return getattr(s, "original_phrasing", "")
    r = intent_output.raw
    if r is not None:
        return r.original_phrasing
    return ""


def _extract_new_desired_positions(
    user_id: str,
) -> dict[str, dict[str, float]]:
    """Build the ``{symbol: {expiry: position}}`` map from the fresh pipeline run.

    Returns empty when the pipeline hasn't run (no streams registered yet).
    """
    engine = get_engine(user_id)
    if engine.pipeline_results is None:
        return {}
    df = engine.pipeline_results.get("desired_pos_df")
    if df is None or df.is_empty():
        return {}
    current = current_positions_per_dim(df)
    out: dict[str, dict[str, float]] = {}
    for row in current.to_dicts():
        sym = row["symbol"]
        exp = str(row["expiry"])
        out.setdefault(sym, {})[exp] = float(row["smoothed_desired_position"])
    return out
