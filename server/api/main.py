"""
FastAPI application — Posit terminal backend.

Run:
    uvicorn server.api.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from server.api.auth.tokens import resolve_user_from_request
from server.api.client_ws import client_ws
from server.api.db import init_db
from server.api.llm.orchestration_config import get_llm_orchestration_config
from server.api.llm.silent_rejection_sweep import run_sweep_forever
from server.api.ws import pipeline_ws

from server.api.routers.admin import router as admin_router
from server.api.routers.auth import router as auth_router
from server.api.routers.account import router as account_router
from server.api.routers.blocks import router as blocks_router
from server.api.routers.bankroll import router as bankroll_router
from server.api.routers.build import router as build_router
from server.api.routers.connectors import router as connectors_router
from server.api.routers.diagnostics import router as diagnostics_router
from server.api.routers.events import router as events_router
from server.api.routers.llm import router as llm_router
from server.api.routers.market_values import router as market_values_router
from server.api.routers.notifications import router as notifications_router
from server.api.routers.opinions import router as opinions_router
from server.api.routers.pipeline import router as pipeline_router
from server.api.routers.positions_replay import router as positions_replay_router
from server.api.routers.snapshots import router as snapshots_router
from server.api.routers.streams import router as streams_router
from server.api.routers.transforms import router as transforms_router

log = logging.getLogger(__name__)


# Legacy global domain-KB file, replaced by the per-user
# ``domain_kb_entries`` SQLite table. Deleted on first boot after the
# migration lands — contents are explicitly not backfilled.
_LEGACY_DOMAIN_KB_PATH = (
    Path(__file__).resolve().parent / "llm" / "domain_kb.json"
)


def _delete_legacy_domain_kb_file() -> None:
    """Best-effort removal of the legacy ``domain_kb.json``.

    Any failure (permissions, EBUSY) is logged and swallowed so startup
    is never blocked — at worst the file is an orphan until the next
    boot attempts deletion again.
    """
    try:
        _LEGACY_DOMAIN_KB_PATH.unlink(missing_ok=True)
    except OSError:
        log.warning(
            "failed to delete legacy domain_kb.json at %s",
            _LEGACY_DOMAIN_KB_PATH, exc_info=True,
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialise the DB schema and start background workers on boot.

    Today the only background worker is the silent-rejection sweep —
    it drains abandoned Build proposals into ``llm_failures`` so the
    feedback loop captures "trader walked away" as a signal.
    """
    init_db()
    _delete_legacy_domain_kb_file()
    sweep_task = asyncio.create_task(
        run_sweep_forever(get_llm_orchestration_config()),
    )
    try:
        yield
    finally:
        sweep_task.cancel()
        try:
            await sweep_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Posit Server", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Paths that never require authentication: health check, signup, login,
# OpenAPI docs, and CORS preflight. Everything else under /api/* must resolve
# to a valid user via the unified auth middleware.
_AUTH_EXEMPT: frozenset[str] = frozenset({
    "/api/health",
    "/api/auth/signup",
    "/api/auth/login",
    "/docs",
    "/redoc",
    "/openapi.json",
})


class _AuthMiddleware(BaseHTTPMiddleware):
    """Unified auth resolver for every /api/* request.

    Resolution order (first match wins):
      1. ``Authorization: Bearer <session_token>``
      2. ``x-api-key`` header
      3. ``?api_key=`` query parameter

    Missing or invalid credentials → 401. The resolved user is stashed on
    ``request.state.user`` so downstream ``Depends(current_user)`` can reuse
    it (and avoid a second DB hit).
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # CORS preflight always bypasses — no credentials are sent with OPTIONS.
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if not path.startswith("/api/") or path in _AUTH_EXEMPT:
            return await call_next(request)

        user = resolve_user_from_request(request)
        if user is None:
            return JSONResponse(
                {"error": {"code": 401, "message": "Authentication required"}},
                status_code=401,
            )
        request.state.user = user
        return await call_next(request)


app.add_middleware(_AuthMiddleware)


class ApiError(BaseModel):
    """Canonical client-facing error envelope.

    Never contains stack traces.  Callers can rely on the shape:
    ``{ "error": { "code": int, "message": str } }``.
    """
    code: int
    message: str


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled exception in %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": 500, "message": "Internal server error"}},
    )


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(auth_router)
app.include_router(account_router)
app.include_router(events_router)
app.include_router(admin_router)
app.include_router(llm_router)
app.include_router(build_router)
app.include_router(streams_router)
app.include_router(snapshots_router)
app.include_router(bankroll_router)
app.include_router(transforms_router)
app.include_router(pipeline_router)
app.include_router(blocks_router)
app.include_router(market_values_router)
app.include_router(notifications_router)
app.include_router(opinions_router)
app.include_router(diagnostics_router)
app.include_router(positions_replay_router)
app.include_router(connectors_router)


# ---------------------------------------------------------------------------
# Health + WebSocket mounts
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
