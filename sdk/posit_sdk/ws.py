"""WebSocket client for /ws/client — auto-reconnect, typed frames, ACK correlation."""
from __future__ import annotations

import asyncio
import enum
import json
import logging
from typing import Any, AsyncGenerator
from urllib.parse import urlencode

import websockets
import websockets.exceptions

from posit_sdk.exceptions import PositApiError, PositAuthError, PositConnectionError
from posit_sdk.models import MarketValueEntry, PositionPayload, SnapshotRow, WsAck

log = logging.getLogger(__name__)

_ACK_TIMEOUT_SECS = 30.0
_CONNECT_TIMEOUT_SECS = 30.0

# Sentinel used to unblock positions() generators when the client closes.
_CLOSED: PositionPayload | None = None


class WsState(str, enum.Enum):
    """Connection state exposed on ``WsClient.state``.

    Callers (and the parent ``PositClient``) switch on this to decide whether
    a WS push can go through or whether to fall back to REST. ``FAILED_AUTH``
    is terminal — the reconnect loop stops dead on a 1008 / 401 / 403 close
    so a bad key does not spin forever.
    """
    CLOSED = "CLOSED"
    CONNECTING = "CONNECTING"
    OPEN = "OPEN"
    RECONNECTING = "RECONNECTING"
    FAILED_AUTH = "FAILED_AUTH"


class WsClient:
    """Authenticated WebSocket connection to /ws/client.

    - Appends api_key as a query param on every connection attempt.
    - Auto-reconnects with exponential backoff on unexpected disconnect.
    - Stops the reconnect loop on an auth-class close (1008 / 401 / 403) and
      records the failure on ``state`` + ``last_error`` so callers can surface it.
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
        self._position_queue: asyncio.Queue[PositionPayload | None] = asyncio.Queue()
        self._closed = False
        self._ws: Any = None
        self._recv_task: asyncio.Task | None = None

        # Public state surface — `state` is the single source of truth for
        # "can I push through this socket right now?". `last_error` carries
        # the most recent terminal / transient failure so the parent can raise
        # a helpful message.
        self.state: WsState = WsState.CLOSED
        self.last_error: Exception | None = None
        # Set whenever state reaches OPEN or FAILED_AUTH — `wait_until_open`
        # blocks on this until a decision is reached.
        self._ready = asyncio.Event()

    async def connect(self) -> None:
        """Start the background receive/reconnect loop."""
        self._closed = False
        self.state = WsState.CONNECTING
        self._ready.clear()
        self.last_error = None
        self._recv_task = asyncio.create_task(
            self._recv_loop(), name="posit-ws-recv",
        )

    async def close(self) -> None:
        """Disconnect and stop the background loop."""
        self._closed = True
        self.state = WsState.CLOSED
        self._ready.set()  # unblock any waiters
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

    async def wait_until_open(self, timeout: float = 10.0) -> None:
        """Await the socket reaching ``OPEN`` or raise on auth / timeout.

        Raises ``PositAuthError`` if the handshake was rejected with a 1008 /
        401 / 403 close frame — this is terminal and will not recover on its
        own. Raises ``PositConnectionError`` on timeout or if the loop has
        already exited for a non-auth reason.
        """
        if self.state == WsState.OPEN:
            return
        if self.state == WsState.FAILED_AUTH:
            raise self.last_error or PositAuthError("WebSocket auth rejected")
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise PositConnectionError(
                f"WebSocket did not become ready within {timeout:.1f}s "
                f"(state={self.state.value})"
            ) from exc
        if self.state == WsState.FAILED_AUTH:
            raise self.last_error or PositAuthError("WebSocket auth rejected")
        if self.state != WsState.OPEN:
            raise PositConnectionError(
                f"WebSocket not ready (state={self.state.value})"
            )

    async def _recv_loop(self) -> None:
        delay = self._reconnect_base
        while not self._closed:
            try:
                async with websockets.connect(self._url) as ws:
                    self._ws = ws
                    self.state = WsState.OPEN
                    self._ready.set()
                    delay = self._reconnect_base
                    log.debug("Posit WS connected")
                    try:
                        async for raw in ws:
                            await self._dispatch(str(raw))
                    finally:
                        self._ws = None
                        self._cancel_pending_acks()
                        if not self._closed and self.state == WsState.OPEN:
                            self.state = WsState.RECONNECTING

            except asyncio.CancelledError:
                return

            except websockets.exceptions.WebSocketException as exc:
                # Both InvalidStatus (websockets>=14) and the deprecated
                # InvalidStatusCode (<14) embed the HTTP status in __str__.
                msg = str(exc)
                # 1008 (policy violation) is what authenticate_client_ws sends
                # on bad key / IP rejection; treat it as terminal like 401/403.
                if "401" in msg or "403" in msg or "1008" in msg:
                    err = PositAuthError(f"WebSocket auth rejected: {msg}")
                    log.error("Posit WS auth rejected — not reconnecting: %s", msg)
                    self.state = WsState.FAILED_AUTH
                    self.last_error = err
                    self._ready.set()
                    self._fail_pending_acks(err)
                    return
                self.state = WsState.RECONNECTING
                self.last_error = exc
                log.warning("Posit WS: %s — retrying in %.1fs", exc, delay)

            except Exception as exc:
                self.state = WsState.RECONNECTING
                self.last_error = exc
                log.warning("Posit WS error: %s — retrying in %.1fs", exc, delay)

            if not self._closed:
                await asyncio.sleep(delay)
                delay = min(delay * 2, self._reconnect_max)

        # Loop exited because close() was called.
        self.state = WsState.CLOSED

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
        if self.state == WsState.FAILED_AUTH:
            raise self.last_error or PositAuthError("WebSocket auth rejected")
        try:
            # wait_until_open raises cleanly on terminal failure.
            await self.wait_until_open(timeout=_CONNECT_TIMEOUT_SECS)
        except PositAuthError:
            raise
        except PositConnectionError:
            raise

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
