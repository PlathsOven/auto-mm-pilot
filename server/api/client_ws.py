"""
Client-facing WebSocket endpoint — authenticated data exchange channel.

Route:  ws://host:port/ws/client?api_key=<key>

Security:
  - API key validated on handshake (header ``X-API-Key`` or query ``api_key``).
  - IP whitelist checked before ``accept()`` (dev/prod via CLIENT_WS_ALLOWED_IPS).
  - TLS termination handled at infrastructure level (reverse proxy / Railway).

Inbound (client → server):
  - Snapshot + market-value frames routed into the owning user's registry.
  - Every frame receives a JSON ACK or error so the SDK knows it was processed.

Outbound (server → client):
  - The connection joins the owning user's broadcast (``ws.py`` ticker).
  - Desired position payloads arrive at the ticker interval (~2s).

Key rotation: when a user regenerates their API key, all live connections
bound to the old key are closed with code 1008 + reason ``key_rotated`` via
``close_connections_for_key``.
"""

from __future__ import annotations

import json
import logging

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from server.api.client_ws_auth import authenticate_client_ws
from server.api.engine_state import rerun_and_broadcast
from server.api.market_value_store import set_entries as mv_set_entries
from server.api.models import (
    ClientWsAck,
    ClientWsError,
    ClientWsInboundFrame,
    ClientWsMarketValueFrame,
)
from server.api.stream_registry import get_stream_registry
from server.api.ws import get_latest_payload, register_client, unregister_client

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Live SDK connections keyed by API key — used to force-close on rotation.
# ---------------------------------------------------------------------------

_connections_by_key: dict[str, set[WebSocket]] = {}


def _track_key(api_key: str, ws: WebSocket) -> None:
    _connections_by_key.setdefault(api_key, set()).add(ws)


def _untrack_key(api_key: str, ws: WebSocket) -> None:
    sockets = _connections_by_key.get(api_key)
    if sockets is not None:
        sockets.discard(ws)
        if not sockets:
            _connections_by_key.pop(api_key, None)


async def close_connections_for_key(api_key: str, *, reason: str = "key_rotated") -> None:
    """Force-close every live ``/ws/client`` connection bound to ``api_key``."""
    sockets = _connections_by_key.pop(api_key, None)
    if not sockets:
        return
    log.info("Closing %d client WS connections for rotated key", len(sockets))
    for ws in list(sockets):
        try:
            await ws.close(code=1008, reason=reason)
        except Exception:
            log.debug("Error while closing rotated-key WS", exc_info=True)


# ---------------------------------------------------------------------------
# Inbound frame processing
# ---------------------------------------------------------------------------

async def _process_snapshot_frame(user_id: str, data: dict, websocket: WebSocket) -> None:
    frame = ClientWsInboundFrame(**data)

    registry = get_stream_registry(user_id)
    accepted = registry.ingest_snapshot(
        frame.stream_name, [r.model_dump() for r in frame.rows],
    )

    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await rerun_and_broadcast(user_id, stream_configs)
            pipeline_rerun = True
        except Exception:
            log.exception("Pipeline re-run failed after client WS snapshot")
            ack = ClientWsAck(seq=frame.seq, rows_accepted=accepted, pipeline_rerun=False)
            await websocket.send_text(ack.model_dump_json())
            return

    ack = ClientWsAck(seq=frame.seq, rows_accepted=accepted, pipeline_rerun=pipeline_rerun)
    await websocket.send_text(ack.model_dump_json())


async def _process_market_value_frame(user_id: str, data: dict, websocket: WebSocket) -> None:
    frame = ClientWsMarketValueFrame(**data)
    mv_set_entries(user_id, [e.model_dump() for e in frame.entries])
    ack = ClientWsAck(seq=frame.seq, rows_accepted=len(frame.entries), pipeline_rerun=False)
    await websocket.send_text(ack.model_dump_json())


async def _process_inbound_frame(user_id: str, raw: str, websocket: WebSocket) -> None:
    seq: int | None = None
    try:
        data = json.loads(raw)
        seq = data.get("seq")

        frame_type = data.get("type", "snapshot")
        if frame_type == "market_value":
            await _process_market_value_frame(user_id, data, websocket)
        else:
            await _process_snapshot_frame(user_id, data, websocket)

    except json.JSONDecodeError as exc:
        err = ClientWsError(seq=seq, detail=f"Invalid JSON: {exc}")
        await websocket.send_text(err.model_dump_json())

    except ValidationError as exc:
        err = ClientWsError(seq=seq, detail=f"Frame validation failed: {exc.error_count()} errors")
        await websocket.send_text(err.model_dump_json())

    except KeyError as exc:
        err = ClientWsError(seq=seq, detail=f"Stream not found: {exc}")
        await websocket.send_text(err.model_dump_json())

    except ValueError as exc:
        err = ClientWsError(seq=seq, detail=str(exc))
        await websocket.send_text(err.model_dump_json())

    except Exception as exc:
        log.exception("Unexpected error processing client WS frame")
        err = ClientWsError(seq=seq, detail=f"Internal error: {type(exc).__name__}")
        await websocket.send_text(err.model_dump_json())


# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------

async def client_ws(websocket: WebSocket) -> None:
    """Authenticated client-facing WebSocket endpoint."""
    auth_result = await authenticate_client_ws(websocket)
    if auth_result is None:
        return
    user_id, api_key = auth_result

    await websocket.accept()
    client_host = websocket.client.host if websocket.client else "unknown"
    log.info("Client WS connected from %s (user=%s)", client_host, user_id)

    latest = get_latest_payload(user_id)
    if latest is not None:
        try:
            await websocket.send_text(latest)
        except Exception:
            return

    _track_key(api_key, websocket)
    register_client(user_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            await _process_inbound_frame(user_id, raw, websocket)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Client WS connection error from %s", client_host)
    finally:
        _untrack_key(api_key, websocket)
        unregister_client(user_id, websocket)
        log.info("Client WS disconnected from %s (user=%s)", client_host, user_id)
