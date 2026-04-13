"""LLM investigation endpoint — SSE token stream."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from server.api.engine_state import (
    get_engine_state,
    get_mock_now,
    get_pipeline_snapshot,
    get_snapshot_buffer,
)
from server.api.llm.correction_detector import detect_and_store
from server.api.llm.service import LlmService
from server.api.models import InvestigateRequest

log = logging.getLogger(__name__)

router = APIRouter()

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

@router.post("/api/investigate")
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
        full_response: list[str] = []
        try:
            async for delta in service.investigate_stream(
                conversation=req.conversation,
                engine_state=engine_state,
                pipeline_snapshot=pipeline_snapshot,
                snapshot_buffer=snapshot_buffer,
                now=now,
                mode=req.mode,
            ):
                full_response.append(delta)
                yield f"data: {json.dumps(delta)}\n\n"

            # Fire correction detector in background — no latency impact
            cfg = service.config
            asyncio.create_task(detect_and_store(
                client=service.client,
                detector_models=cfg.detector_models,
                max_tokens=cfg.max_tokens_detector,
                temperature=cfg.temperature_detector,
                conversation=req.conversation,
                assistant_response="".join(full_response),
            ))

            yield "data: [DONE]\n\n"
        except Exception:
            log.exception("Investigation stream failed")
            yield "event: error\ndata: {\"code\": 500, \"message\": \"Investigation failed\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
