"""WebSocket client for /ws/client — auto-reconnect, typed frames, ACK correlation."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncGenerator
from urllib.parse import urlencode

from typing import Any

import websockets
import websockets.exceptions

from posit_sdk.exceptions import PositApiError, PositAuthError, PositConnectionError
from posit_sdk.models import MarketValueEntry, PositionPayload, SnapshotRow, WsAck

log = logging.getLogger(__name__)

_ACK_TIMEOUT_SECS = 30.0
_CONNECT_TIMEOUT_SECS = 30.0

# Sentinel used to unblock positions() generators when the client closes.
_CLOSED: PositionPayload | None = None


class WsClient:
    """Authenticated WebSocket connection to /ws/client.

    - Appends api_key as a query param on every connection attempt.
    - Auto-reconnects with exponential backoff on unexpected disconnect.
    - Assigns monotonically increasing sequence numbers to outbound frames
      and correlates inbound ACKs/errors to the originating caller.
    - Fans out inbound position payloads to any active positions() generators.
    """

    def __init__(
        self,
        ws_url: str,
        api_key: str,
        *,
        reconnect_delay: float = 1.0,
        max_reconnect_delay: float = 60.0,
    ) -> None:
        qs = urlencode({"api_key": api_key})
        self._url = f"{ws_url}?{qs}"
        self._reconnect_base = reconnect_delay
        self._reconnect_max = max_reconnect_delay

        self._seq = 0
        self._ack_futures: dict[int, asyncio.Future[WsAck]] = {}
        # None sentinel is written on close to unblock waiting generators.
        self._position_queue: asyncio.Queue[PositionPayload | None] = asyncio.Queue()
        self._connected = asyncio.Event()
        self._closed = False
        # Type is websockets.asyncio.client.ClientConnection (v14+) or legacy
        # WebSocketClientProtocol (<v14).  Typed as Any to stay version-agnostic.
        self._ws: Any = None
        self._recv_task: asyncio.Task | None = None

    async def connect(self) -> None:
        """Start the background receive/reconnect loop."""
        self._closed = False
        self._recv_task = asyncio.create_task(
            self._recv_loop(), name="posit-ws-recv",
        )

    async def close(self) -> None:
        """Disconnect and stop the background loop."""
        self._closed = True
        await self._position_queue.put(_CLOSED)  # unblock positions() generators
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass

    async def _recv_loop(self) -> None:
        delay = self._reconnect_base
        while not self._closed:
            try:
                async with websockets.connect(self._url) as ws:
                    self._ws = ws
                    self._connected.set()
                    delay = self._reconnect_base
                    log.debug("Posit WS connected")
                    try:
                        async for raw in ws:
                            await self._dispatch(str(raw))
                    finally:
                        self._ws = None
                        self._connected.clear()
                        self._cancel_pending_acks()

            except asyncio.CancelledError:
                return

            except websockets.exceptions.WebSocketException as exc:
                # Both InvalidStatus (websockets>=14) and the deprecated
                # InvalidStatusCode (<14) embed the HTTP status in __str__.
                msg = str(exc)
                if "401" in msg or "403" in msg:
                    log.error("Posit WS auth rejected — not reconnecting: %s", msg)
                    self._fail_pending_acks(PositAuthError("WebSocket auth rejected"))
                    return
                log.warning("Posit WS: %s — retrying in %.1fs", exc, delay)

            except Exception as exc:
                log.warning("Posit WS error: %s — retrying in %.1fs", exc, delay)

            if not self._closed:
                await asyncio.sleep(delay)
                delay = min(delay * 2, self._reconnect_max)

    def _cancel_pending_acks(self) -> None:
        self._fail_pending_acks(PositConnectionError("WebSocket disconnected"))

    def _fail_pending_acks(self, exc: Exception) -> None:
        for fut in self._ack_futures.values():
            if not fut.done():
                fut.set_exception(exc)
        self._ack_futures.clear()

    async def _dispatch(self, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            log.warning("Posit WS: received non-JSON message")
            return

        typ = data.get("type")
        if typ == "ack":
            self._resolve_ack(data)
        elif typ == "error":
            self._reject_ack(data)
        elif "positions" in data:
            try:
                payload = PositionPayload.model_validate(data)
                await self._position_queue.put(payload)
            except Exception as exc:
                log.warning("Posit WS: failed to parse position payload: %s", exc)
        else:
            log.debug("Posit WS: unrecognised message (type=%r)", typ)

    def _resolve_ack(self, data: dict) -> None:
        seq = data.get("seq")
        fut = self._ack_futures.pop(seq, None) if seq is not None else None
        if fut and not fut.done():
            fut.set_result(WsAck(**data))

    def _reject_ack(self, data: dict) -> None:
        seq = data.get("seq")
        fut = self._ack_futures.pop(seq, None) if seq is not None else None
        if fut and not fut.done():
            fut.set_exception(PositApiError(0, data.get("detail", "WS error")))

    async def _send(self, frame: dict) -> WsAck:
        try:
            await asyncio.wait_for(
                self._connected.wait(), timeout=_CONNECT_TIMEOUT_SECS,
            )
        except asyncio.TimeoutError:
            raise PositConnectionError("Timed out waiting for WebSocket connection")

        if self._ws is None:
            raise PositConnectionError("WebSocket not connected")

        seq = self._seq
        self._seq += 1
        frame["seq"] = seq

        loop = asyncio.get_running_loop()
        fut: asyncio.Future[WsAck] = loop.create_future()
        self._ack_futures[seq] = fut

        try:
            await self._ws.send(json.dumps(frame))
            return await asyncio.wait_for(
                asyncio.shield(fut), timeout=_ACK_TIMEOUT_SECS,
            )
        except asyncio.TimeoutError:
            self._ack_futures.pop(seq, None)
            raise PositConnectionError(f"ACK timeout for seq={seq}")

    async def push_snapshot(
        self, stream_name: str, rows: list[SnapshotRow],
    ) -> WsAck:
        """Push snapshot rows and wait for the server ACK."""
        return await self._send({
            "stream_name": stream_name,
            "rows": [r.model_dump() for r in rows],
        })

    async def push_market_values(
        self, entries: list[MarketValueEntry],
    ) -> WsAck:
        """Push market value entries and wait for the server ACK."""
        return await self._send({
            "type": "market_value",
            "entries": [e.model_dump() for e in entries],
        })

    async def positions(self) -> AsyncGenerator[PositionPayload, None]:
        """Async generator that yields incoming pipeline position payloads.

        Runs until the client is closed or the caller breaks out of the loop.
        """
        while not self._closed:
            payload = await self._position_queue.get()
            if payload is _CLOSED:
                return
            yield payload
