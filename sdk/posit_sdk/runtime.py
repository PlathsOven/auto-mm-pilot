"""Long-running feeder primitives — reconnecting sources + supervision.

Turns "push data forever" into a handful of declarative coroutines instead
of hand-rolled ``asyncio.gather`` wiring + reconnect loops::

    async with PositClient.from_env() as client:
        await client.bootstrap_streams(SPECS, bankroll=100_000.0)
        await client.run(
            forward_websocket("ws://feed/metrics", lambda m: handle_metric(client, m)),
            forward_websocket("ws://feed/events",  lambda m: handle_event(client, m)),
            repeat(lambda: republish_events(client), every=30.0),
        )

Every feeder we've seen reinvents the same three primitives:

- a reconnecting WebSocket source (``forward_websocket``)
- a periodic re-push timer (``repeat``)
- a supervisor that keeps the rest alive when one fails (``run_forever``)

These live here so integrators don't.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

import websockets
import websockets.exceptions

log = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any]], Awaitable[None]]
NullaryHandler = Callable[[], Awaitable[None]]


async def forward_websocket(
    url: str,
    handler: Handler,
    *,
    reconnect_delay: float = 2.0,
) -> None:
    """Subscribe to a JSON-over-WebSocket feed and dispatch each message.

    Reconnects forever with a fixed delay — feed WebSockets drop silently
    and every Posit feeder needs the same loop. Messages that fail to parse
    or raise inside ``handler`` are logged and skipped; the connection stays
    up. Cancellation (e.g. ``PositClient`` context exit) closes the socket
    cleanly and returns.

    ``handler`` receives the parsed JSON object. Close over the
    ``PositClient`` in a lambda or ``functools.partial`` to inject it::

        forward_websocket(url, lambda msg: handle(client, msg))
    """
    while True:
        try:
            async with websockets.connect(url) as ws:
                log.info("forward_websocket connected: %s", url)
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        log.warning(
                            "forward_websocket: non-JSON frame on %s", url,
                        )
                        continue
                    try:
                        await handler(msg)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        log.exception(
                            "forward_websocket handler error on %s", url,
                        )
        except asyncio.CancelledError:
            # Propagate cancellation so run_forever / the event loop see the
            # task as cancelled rather than completed.
            raise
        except Exception as exc:
            log.warning(
                "forward_websocket: %s — reconnecting in %.1fs",
                exc, reconnect_delay,
            )
            await asyncio.sleep(reconnect_delay)


async def repeat(
    handler: NullaryHandler,
    *,
    every: float,
    run_immediately: bool = False,
) -> None:
    """Call ``handler`` on a fixed interval, forever.

    ``every`` is seconds *between starts*; if a call runs longer than the
    interval the next call waits for it. Calls are sequential, never
    overlapping. Exceptions are logged and swallowed so a transient bug
    never stops the timer.

    ``run_immediately=True`` fires one call before the first sleep. Default
    False — matches the "republish every N seconds" pattern where the
    initial push is handled elsewhere.
    """
    async def _call() -> None:
        try:
            await handler()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("repeat: handler error")

    if run_immediately:
        await _call()
    while True:
        await asyncio.sleep(every)
        await _call()


async def run_forever(*tasks: Awaitable[None]) -> None:
    """Supervise long-running feeder coroutines concurrently.

    Each argument is scheduled as a child task. When any task completes —
    normally or with an exception — the rest keep running; a metrics-feed
    WebSocket giving up should not take down the events feeder. Exceptions
    are logged at ERROR.

    On cancellation (e.g. ``async with`` exit, Ctrl-C) every remaining
    task is cancelled and awaited before re-raising, so nothing outlives
    the surrounding context.

    Returns normally if every child returns normally. Returns immediately
    if called with no arguments.
    """
    if not tasks:
        return
    pending: set[asyncio.Task[None]] = {
        asyncio.ensure_future(t) for t in tasks
    }
    try:
        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED,
            )
            for t in done:
                if t.cancelled():
                    continue
                exc = t.exception()
                if exc is not None:
                    log.error(
                        "run_forever: task %r raised; continuing",
                        t.get_name(),
                        exc_info=exc,
                    )
    except asyncio.CancelledError:
        for t in pending:
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        raise
