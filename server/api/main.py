"""
FastAPI application — Posit terminal backend.

Run:
    uvicorn server.api.main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from server.api.config import POSIT_MODE, get_valid_api_keys
from server.api.client_ws import client_ws
from server.api.engine_state import init_mock
from server.api.ws import pipeline_ws

from server.api.routers.llm import router as llm_router
from server.api.routers.streams import router as streams_router
from server.api.routers.snapshots import router as snapshots_router
from server.api.routers.bankroll import router as bankroll_router
from server.api.routers.transforms import router as transforms_router
from server.api.routers.pipeline import router as pipeline_router
from server.api.routers.blocks import router as blocks_router
from server.api.routers.market_values import router as market_values_router

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Run mock pipeline init at startup before accepting requests.

    Init runs in a worker thread so the event loop stays responsive while
    the (slow, sync) Polars pipeline executes.  The ``yield`` only fires
    after init returns, so by the time the first client request lands,
    ``_pipeline_results`` is already populated and accessors are O(1).
    """
    if POSIT_MODE == "mock":
        await asyncio.to_thread(init_mock)
    yield


app = FastAPI(title="Posit Server", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Paths exempt from API-key auth (health + WS endpoints + OpenAPI docs).
_AUTH_EXEMPT = frozenset({"/api/health", "/docs", "/redoc", "/openapi.json"})


class _ApiKeyMiddleware(BaseHTTPMiddleware):
    """Require a valid API key on all /api/* routes except /api/health.

    Keys are read from POSIT_API_KEYS (comma-sep) or CLIENT_WS_API_KEY.
    If neither env var is set, auth is disabled with a startup warning —
    matching the IP-whitelist convention in client_ws_auth.py.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # CORS preflight: must bypass auth per spec (no credentials sent).
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if not path.startswith("/api/") or path in _AUTH_EXEMPT:
            return await call_next(request)

        valid_keys = get_valid_api_keys()
        if not valid_keys:
            log.warning(
                "No API keys configured — REST auth disabled. "
                "Set POSIT_API_KEYS or CLIENT_WS_API_KEY to enable."
            )
            return await call_next(request)

        key = (
            request.headers.get("x-api-key")
            or request.query_params.get("api_key")
        )
        if not key or key not in valid_keys:
            return JSONResponse(
                {"error": {"code": 401, "message": "Invalid or missing API key"}},
                status_code=401,
            )

        return await call_next(request)


app.add_middleware(_ApiKeyMiddleware)


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

app.include_router(llm_router)
app.include_router(streams_router)
app.include_router(snapshots_router)
app.include_router(bankroll_router)
app.include_router(transforms_router)
app.include_router(pipeline_router)
app.include_router(blocks_router)
app.include_router(market_values_router)


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
