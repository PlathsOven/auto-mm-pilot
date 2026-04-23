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
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import get_engine_state
from server.api.llm.build_orchestrator import run_build_pipeline
from server.api.llm.correction_detector import detect_and_store
from server.api.llm.orchestration_config import get_llm_orchestration_config
from server.api.llm.service import LlmService
from server.api.models import BuildConverseRequest

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
