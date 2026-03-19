"""
FastAPI application — LLM endpoints for the APT terminal.

Endpoints:
    POST /api/investigate  — SSE stream of investigation tokens
    POST /api/justify      — JSON one-line justification for a position change
    GET  /api/health       — Health check

Run:
    uvicorn server.api.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from server.api.engine_state import (
    get_engine_state,
    get_mock_now,
    get_pipeline_snapshot,
    get_snapshot_buffer,
)
from server.api.llm.service import LlmService

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="APT Server", version="0.1.0")

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
# Request / response models
# ---------------------------------------------------------------------------

class InvestigateRequest(BaseModel):
    conversation: list[dict[str, str]] = Field(
        ...,
        description="OpenAI-style message array: [{role, content}, ...]",
    )
    cell_context: dict[str, Any] | None = Field(
        default=None,
        description="Optional cell/card context clicked by the user",
    )


class JustifyRequest(BaseModel):
    asset: str
    expiry: str
    old_pos: float
    new_pos: float
    delta: float


class JustifyResponse(BaseModel):
    justification: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
                yield f"data: {delta}\n\n"
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
