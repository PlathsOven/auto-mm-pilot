"""Tests for posit_sdk.runtime — feeder primitives."""
from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from posit_sdk.runtime import forward_websocket, repeat, run_forever


# ---------------------------------------------------------------------------
# repeat()
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_repeat_calls_handler_on_interval() -> None:
    calls: list[float] = []
    loop = asyncio.get_running_loop()
    start = loop.time()

    async def handler() -> None:
        calls.append(loop.time() - start)

    task = asyncio.create_task(repeat(handler, every=0.05))
    await asyncio.sleep(0.18)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # Expect ~3 calls at ~0.05, 0.10, 0.15 (default run_immediately=False).
    assert 2 <= len(calls) <= 4, calls


@pytest.mark.asyncio
async def test_repeat_run_immediately_fires_once_up_front() -> None:
    calls: list[int] = []

    async def handler() -> None:
        calls.append(1)

    task = asyncio.create_task(
        repeat(handler, every=10.0, run_immediately=True),
    )
    # Yield the event loop once so the immediate call runs.
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_repeat_swallows_handler_exceptions() -> None:
    counts: list[str] = []

    async def handler() -> None:
        counts.append("x")
        if len(counts) == 1:
            raise RuntimeError("first call fails")

    task = asyncio.create_task(repeat(handler, every=0.01))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # Timer survives the first exception and fires subsequent calls.
    assert len(counts) >= 2


# ---------------------------------------------------------------------------
# run_forever()
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_forever_empty_returns_immediately() -> None:
    # Smoke — no tasks, returns without blocking.
    await asyncio.wait_for(run_forever(), timeout=0.5)


@pytest.mark.asyncio
async def test_run_forever_completes_when_every_task_finishes() -> None:
    counts: list[str] = []

    async def quick() -> None:
        counts.append("done")

    await asyncio.wait_for(run_forever(quick(), quick()), timeout=0.5)
    assert counts == ["done", "done"]


@pytest.mark.asyncio
async def test_run_forever_keeps_siblings_running_when_one_raises() -> None:
    survivor_ticks: list[int] = []
    died = asyncio.Event()

    async def dies() -> None:
        died.set()
        raise RuntimeError("boom")

    async def survives() -> None:
        while True:
            survivor_ticks.append(1)
            await asyncio.sleep(0.01)

    task = asyncio.create_task(run_forever(dies(), survives()))
    await asyncio.wait_for(died.wait(), timeout=1.0)
    # Give the survivor a few more ticks after the other died.
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(survivor_ticks) >= 2


@pytest.mark.asyncio
async def test_run_forever_cancels_all_tasks_on_cancellation() -> None:
    cancelled: list[str] = []

    async def long(name: str) -> None:
        try:
            await asyncio.sleep(100)
        except asyncio.CancelledError:
            cancelled.append(name)
            raise

    task = asyncio.create_task(run_forever(long("a"), long("b"), long("c")))
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert sorted(cancelled) == ["a", "b", "c"]


# ---------------------------------------------------------------------------
# forward_websocket() — exercised through a real in-process WS server.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_forward_websocket_dispatches_and_reconnects() -> None:
    import websockets

    received: list[dict[str, Any]] = []
    handled = asyncio.Event()

    async def handler(msg: dict[str, Any]) -> None:
        received.append(msg)
        if len(received) >= 2:
            handled.set()

    server_connections: list[Any] = []

    async def server_handler(ws: Any) -> None:
        server_connections.append(ws)
        # First connection: send one message, then close to force a reconnect.
        # Second connection: send one message, then idle.
        count = len(server_connections)
        await ws.send(json.dumps({"n": count}))
        if count == 1:
            await ws.close()
        else:
            await asyncio.sleep(5)

    async with websockets.serve(server_handler, "localhost", 0) as server:
        port = server.sockets[0].getsockname()[1]
        url = f"ws://localhost:{port}"

        feeder = asyncio.create_task(
            forward_websocket(url, handler, reconnect_delay=0.01),
        )
        try:
            await asyncio.wait_for(handled.wait(), timeout=2.0)
        finally:
            feeder.cancel()
            with pytest.raises(asyncio.CancelledError):
                await feeder

    assert [m["n"] for m in received] == [1, 2]


@pytest.mark.asyncio
async def test_forward_websocket_skips_malformed_messages() -> None:
    import websockets

    received: list[dict[str, Any]] = []
    done = asyncio.Event()

    async def handler(msg: dict[str, Any]) -> None:
        received.append(msg)
        done.set()

    async def server_handler(ws: Any) -> None:
        await ws.send("not json")
        await ws.send(json.dumps({"ok": True}))
        await asyncio.sleep(5)

    async with websockets.serve(server_handler, "localhost", 0) as server:
        port = server.sockets[0].getsockname()[1]
        url = f"ws://localhost:{port}"
        feeder = asyncio.create_task(forward_websocket(url, handler))
        try:
            await asyncio.wait_for(done.wait(), timeout=2.0)
        finally:
            feeder.cancel()
            with pytest.raises(asyncio.CancelledError):
                await feeder

    assert received == [{"ok": True}]
