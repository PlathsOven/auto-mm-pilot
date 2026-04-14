"""
Client-facing WebSocket endpoint — authenticated data exchange channel.

Route:  ws://host:port/ws/client?api_key=<key>

Security:
  - API key validated on handshake (header ``X-API-Key`` or query ``api_key``)
  - IP whitelist checked before ``accept()``
  - TLS termination handled at infrastructure level (reverse proxy / Railway)

Inbound (client → server):
  - Client sends JSON text frames containing snapshot rows (~1/sec).
  - Every frame receives a JSON ACK or error so the client knows it was processed.

Outbound (server → client):
  - The connection joins the existing pipeline broadcast (``ws.py`` ticker).
  - Desired position payloads arrive at the ticker interval (~2s).

Both directions operate simultaneously — no request/response querying required.
"""

from __future__ import annotations

import json
import logging

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from server.api.client_ws_auth import authenticate_client_ws
from server.api.models import (
    ClientWsAck,
    ClientWsError,
    ClientWsInboundFrame,
    ClientWsMarketValueFrame,
)
from server.api.stream_registry import get_stream_registry
from server.api.engine_state import rerun_and_broadcast
from server.api import market_value_store
from server.api.ws import get_latest_payload, register_client, unregister_client

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Inbound frame processing
# ---------------------------------------------------------------------------

async def _process_snapshot_frame(data: dict, websocket: WebSocket) -> None:
    """Handle a snapshot frame (existing behaviour)."""
    frame = ClientWsInboundFrame(**data)

    registry = get_stream_registry()
    accepted = registry.ingest_snapshot(
        frame.stream_name, [r.model_dump() for r in frame.rows],
    )

    # Re-run pipeline if streams are available
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await rerun_and_broadcast(stream_configs)
            pipeline_rerun = True
        except Exception:
            log.exception("Pipeline re-run failed after client WS snapshot")
            ack = ClientWsAck(seq=frame.seq, rows_accepted=accepted, pipeline_rerun=False)
            await websocket.send_text(ack.model_dump_json())
            return

    ack = ClientWsAck(seq=frame.seq, rows_accepted=accepted, pipeline_rerun=pipeline_rerun)
    await websocket.send_text(ack.model_dump_json())


async def _process_market_value_frame(data: dict, websocket: WebSocket) -> None:
    """Handle a market_value frame — write to store, ACK, no rerun."""
    frame = ClientWsMarketValueFrame(**data)
    market_value_store.set_entries([e.model_dump() for e in frame.entries])
    ack = ClientWsAck(seq=frame.seq, rows_accepted=len(frame.entries), pipeline_rerun=False)
    await websocket.send_text(ack.model_dump_json())


async def _process_inbound_frame(raw: str, websocket: WebSocket) -> None:
    """Parse, validate, ingest a single inbound text frame and send ACK/error."""
    seq: int | None = None
    try:
        data = json.loads(raw)
        seq = data.get("seq")

        frame_type = data.get("type", "snapshot")
        if frame_type == "market_value":
            await _process_market_value_frame(data, websocket)
        else:
            await _process_snapshot_frame(data, websocket)

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
    """Authenticated client-facing WebSocket endpoint.

    1. Authenticate (IP whitelist + API key) *before* accept.
    2. Send latest pipeline payload for immediate catch-up.
    3. Register with the broadcast ticker for ongoing position updates.
    4. Listen for inbound snapshot frames and ACK each one.
    """
    # --- Auth gate (accepts + closes on failure) ---
    if not await authenticate_client_ws(websocket):
        return

    # Auth succeeded but connection not yet accepted
    await websocket.accept()
    client_host = websocket.client.host if websocket.client else "unknown"
    log.info("Client WS connected from %s", client_host)

    # Send catch-up payload
    latest = get_latest_payload()
    if latest is not None:
        try:
            await websocket.send_text(latest)
        except Exception:
            return

    # Join the broadcast for ongoing outbound position updates
    register_client(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            await _process_inbound_frame(raw, websocket)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Client WS connection error from %s", client_host)
    finally:
        unregister_client(websocket)
        log.info("Client WS disconnected from %s", client_host)
