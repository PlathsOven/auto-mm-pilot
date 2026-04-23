"""PositClient — main entry point for the Posit SDK."""
from __future__ import annotations

import asyncio
import logging
import os
import time
import warnings
from typing import Any, AsyncGenerator, Awaitable

from pydantic import create_model

from posit_sdk.exceptions import (
    PositApiError,
    PositAuthError,
    PositConnectionError,
    PositStreamNotRegistered,
    PositValidationError,
    PositZeroEdgeBlocked,
    PositZeroEdgeWarning,
)
from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    ConnectorCatalogResponse,
    ConnectorInputResponse,
    ConnectorInputRow,
    HealthResponse,
    IntegratorEvent,
    IntegratorEventType,
    MarketValueEntry,
    PositionPayload,
    PositionsSinceResponse,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    StreamSpec,
    StreamState,
    WsAck,
    ZeroPositionDiagnosticsResponse,
)
from posit_sdk.rest import RestClient
from posit_sdk.ws import WsClient, WsState

log = logging.getLogger(__name__)


def _http_to_ws(url: str) -> str:
    return url.replace("https://", "wss://").replace("http://", "ws://")


class PositClient:
    """Posit SDK client — manages REST and (optional) WebSocket connections.

    Usage::

        async with PositClient(url="http://localhost:8001", api_key="my-key") as client:
            await client.bootstrap_streams(
                [StreamSpec(stream_name="rv_btc",
                            key_cols=["symbol", "expiry"],
                            exponent=2.0)],
                bankroll=1_000_000.0,
            )
            await client.push_snapshot("rv_btc", rows=[
                SnapshotRow(timestamp="2026-01-01T00:00:00", raw_value=0.65,
                            market_value=0.70, symbol="BTC", expiry="27MAR26"),
            ])
            async for payload in client.positions():
                for pos in payload.positions:
                    print(pos.symbol, pos.desired_pos)
                break

    **Auth.** Same API key, two injection surfaces — REST sends
    ``X-API-Key: <key>``, WS appends ``?api_key=<key>`` to the upgrade URL.
    The SDK does both for you; hand-rolled clients must match.

    **Connection.** Defaults to REST-only (``connect_ws=False``). Pass
    ``connect_ws=True`` to open the live socket for lower-latency pushes and
    streaming ``positions()``. ``__aenter__`` hard-blocks on auth — a bad key
    raises ``PositAuthError`` immediately so no later call silently fails
    against a dead key. Pass ``connect_timeout=None`` to skip the WS
    readiness wait when ``connect_ws=True``.

    **Idempotent setup.** Prefer ``upsert_stream`` / ``bootstrap_streams``
    over raw ``create_stream`` + ``configure_stream`` — the two-phase API
    emits a ``FutureWarning`` in v0.1 and will be removed in v0.2.
    """

    @classmethod
    def from_env(
        cls,
        *,
        connect_ws: bool = False,
        connect_timeout: float | None = 10.0,
        ws_reconnect_delay: float = 1.0,
        ws_max_reconnect_delay: float = 60.0,
    ) -> "PositClient":
        """Construct a ``PositClient`` from ``POSIT_URL`` + ``POSIT_API_KEY`` env vars.

        Raises ``PositValidationError`` at call time when either variable is
        missing or empty — avoids the ``None``-URL and deferred-401 surprises
        that come from ``os.environ.get`` fallbacks in notebook / feeder code.

        Keyword arguments match ``__init__`` and are forwarded through, so
        ``PositClient.from_env(connect_ws=True)`` does what you expect.
        """
        url = (os.environ.get("POSIT_URL") or "").strip()
        api_key = (os.environ.get("POSIT_API_KEY") or "").strip()
        missing = [
            name for name, value in (
                ("POSIT_URL", url), ("POSIT_API_KEY", api_key),
            ) if not value
        ]
        if missing:
            raise PositValidationError(
                f"PositClient.from_env(): missing environment variables: "
                f"{', '.join(missing)}"
            )
        return cls(
            url=url,
            api_key=api_key,
            connect_ws=connect_ws,
            connect_timeout=connect_timeout,
            ws_reconnect_delay=ws_reconnect_delay,
            ws_max_reconnect_delay=ws_max_reconnect_delay,
        )

    def __init__(
        self,
        url: str,
        api_key: str,
        *,
        connect_ws: bool = False,
        connect_timeout: float | None = 10.0,
        ws_reconnect_delay: float = 1.0,
        ws_max_reconnect_delay: float = 60.0,
    ) -> None:
        self._url = url.rstrip("/")
        self._api_key = api_key
        self._connect_ws = connect_ws
        self._connect_timeout = connect_timeout
        self._ws_reconnect_delay = ws_reconnect_delay
        self._ws_max_reconnect_delay = ws_max_reconnect_delay
        self._rest: RestClient | None = None
        self._ws: WsClient | None = None
        # Tracks the last WS state we emitted a WARN for, to avoid per-push
        # log spam when the socket is down and every call is falling back.
        self._last_warned_ws_state: WsState | None = None
        # Cache of server's required risk-dimension column names. Fetched
        # lazily on first create_stream and re-used thereafter — server config,
        # not per-request data, so caching is safe.
        self._dimension_cols: list[str] | None = None
        # Streams for which we have already emitted the "no market_value →
        # edge will be 0" warning. One WARN per stream per client lifetime.
        self._market_value_warned: set[str] = set()
        # Streams where we saw a push without market_value and have not yet
        # surfaced a PositZeroEdgeWarning on the next positions() payload.
        # Cleared after the warning fires so consumers aren't spammed once
        # they've started paying attention.
        self._zero_edge_pending: set[str] = set()
        # Structured event queue — populated by every place that emits a
        # WARNING, drained by events(). Unbounded by design — consumers
        # that don't drain should not subscribe.
        self._events_queue: asyncio.Queue[IntegratorEvent | None] | None = None
        # Cache of per-stream typed SnapshotRow subclasses — each has the
        # stream's key_cols declared as required str fields so callers get
        # IDE completion + mypy coverage instead of extra="allow" sprawl.
        self._row_class_cache: dict[str, type[SnapshotRow]] = {}
        # Known-registered streams on the server. Populated on __aenter__,
        # updated after every create/upsert/delete, and invalidated for a
        # single stream when the server returns STREAM_NOT_REGISTERED. Used
        # to block pushes to unregistered streams *before* any network call.
        self._ready_streams: set[str] = set()

    async def __aenter__(self) -> "PositClient":
        self._rest = RestClient(self._url, self._api_key)
        self._events_queue = asyncio.Queue()
        await self._rest.__aenter__()

        # Auth hard-block: probe a REST endpoint that requires auth so a bad
        # key raises here, not on the first user action. The probe doubles as
        # our initial "which streams already exist" cache.
        try:
            streams = await self._rest.list_streams()
        except PositAuthError:
            await self._rest.__aexit__(None, None, None)
            self._rest = None
            raise
        self._ready_streams = {s.stream_name for s in streams}

        if self._connect_ws:
            self._ws = WsClient(
                _http_to_ws(self._url) + "/ws/client",
                self._api_key,
                reconnect_delay=self._ws_reconnect_delay,
                max_reconnect_delay=self._ws_max_reconnect_delay,
            )
            await self._ws.connect()
            if self._connect_timeout is not None:
                try:
                    await self._ws.wait_until_open(timeout=self._connect_timeout)
                except (PositAuthError, PositConnectionError):
                    await self._ws.close()
                    self._ws = None
                    await self._rest.__aexit__(None, None, None)
                    self._rest = None
                    raise
        return self

    async def __aexit__(self, *args: object) -> None:
        if self._events_queue is not None:
            # Sentinel unblocks any active events() iterator.
            self._events_queue.put_nowait(None)
            self._events_queue = None
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._rest:
            await self._rest.__aexit__(*args)
            self._rest = None

    def _emit_event(
        self,
        event_type: IntegratorEventType,
        *,
        stream_name: str | None = None,
        detail: str = "",
    ) -> None:
        """Enqueue a structured event for events() consumers. No-op if nobody
        is subscribed (the queue still buffers — drain via events())."""
        if self._events_queue is None:
            return
        self._events_queue.put_nowait(IntegratorEvent(
            type=event_type,
            stream_name=stream_name,
            detail=detail,
            timestamp=time.time(),
        ))

    def events(self) -> AsyncGenerator[IntegratorEvent, None]:
        """Async iterator of structured SDK events.

        Yields one ``IntegratorEvent`` per signal — market-value-missing,
        WS fallback / reconnect, positions degraded, zero-edge warning.
        Useful for routing SDK-side observability into a monitoring layer
        (Datadog, Slack, pager) without relying on Python ``logging``
        being configured.

        Terminates when the client's context manager exits. Starting an
        ``events()`` consumer *before* calling ``__aenter__`` raises
        ``RuntimeError`` synchronously (so misuse fails at the call site,
        not on first iteration).

        **Backpressure:** the underlying queue is unbounded — a consumer
        that doesn't drain grows memory over the process lifetime.
        Consume it promptly or close the client.
        """
        if self._events_queue is None:
            raise RuntimeError(
                "events() requires the PositClient context manager to be open"
            )
        # Capture the queue now so the generator keeps draining after
        # __aexit__ nulls self._events_queue — the sentinel still arrives.
        return self._events_impl(self._events_queue)

    async def _events_impl(
        self, queue: asyncio.Queue[IntegratorEvent | None],
    ) -> AsyncGenerator[IntegratorEvent, None]:
        while True:
            event = await queue.get()
            if event is None:
                return
            yield event

    async def run(self, *tasks: Awaitable[None]) -> None:
        """Supervise long-running feeder coroutines until cancelled.

        Thin wrapper over ``posit_sdk.runtime.run_forever``. Each task runs
        concurrently; one task raising does not take down the rest (logged
        at ERROR and moved on). Cancellation propagates — on ``async with``
        exit every task is cancelled and awaited before the context closes.

        Intended as the last statement of a feeder's ``main()``::

            async with PositClient.from_env() as client:
                await client.bootstrap_streams(SPECS, bankroll=...)
                await client.run(
                    forward_websocket(URL_1, handler_1),
                    forward_websocket(URL_2, handler_2),
                    repeat(republisher, every=30.0),
                )
        """
        from posit_sdk.runtime import run_forever
        await run_forever(*tasks)

    async def wait_until_ready(self, timeout: float = 10.0) -> None:
        """Block until the WS is OPEN or raise on auth / timeout.

        No-op in REST-only mode (``connect_ws=False``). REST readiness is
        already guaranteed by ``__aenter__`` — if we returned from the context
        entry, the API key has been validated.
        """
        if self._ws is not None:
            await self._ws.wait_until_open(timeout)

    def _require_rest(self) -> RestClient:
        if self._rest is None:
            raise RuntimeError("PositClient must be used as an async context manager")
        return self._rest

    def _require_ws(self) -> WsClient:
        if self._ws is None:
            raise RuntimeError(
                "WebSocket not connected. Use PositClient(..., connect_ws=True) "
                "and enter the context manager first."
            )
        return self._ws

    def _ws_state(self) -> WsState:
        return self._ws.state if self._ws is not None else WsState.CLOSED

    def _warn_if_missing_market_value(
        self, stream_name: str, rows: list[SnapshotRow],
    ) -> None:
        """Log once per stream when rows omit ``market_value``.

        Without ``market_value``, each block's market defaults to its own
        fair value → edge collapses to 0 → desired_pos collapses to 0. The
        stream looks healthy; positions just silently stay flat. This was
        the longest rabbit hole in the deribit-pricer integration.
        """
        missing = sum(1 for r in rows if r.market_value is None)
        if missing == 0:
            return
        # Queue a typed warning for the next positions() payload — harder to
        # miss than a log line inside a notebook / supervised process.
        self._zero_edge_pending.add(stream_name)
        if stream_name in self._market_value_warned:
            return
        self._market_value_warned.add(stream_name)
        detail = (
            f"Stream {stream_name!r}: {missing} row(s) pushed without "
            f"market_value; per-block market defaults to fair, so edge will "
            f"be 0. Set SnapshotRow.market_value or call set_market_values()."
        )
        log.warning(
            "Stream %r: %d row(s) pushed without market_value; per-block "
            "market defaults to fair, so edge will be 0. Set SnapshotRow."
            "market_value or call set_market_values() to fix.",
            stream_name, missing,
        )
        self._emit_event(
            "market_value_missing", stream_name=stream_name, detail=detail,
        )

    def _maybe_warn_zero_edge(self, payload: PositionPayload) -> None:
        """Surface PositZeroEdgeWarning on the first payload after a bare push.

        The SDK already logs the missing-``market_value`` WARN on the push
        path, but a log line is easy to miss — especially in notebooks and
        managed feeders with default ``logging`` config. Escalating to
        ``warnings.warn(PositZeroEdgeWarning)`` on the payload side means
        anyone calling ``positions()`` sees the signal in-band.

        Fires exactly once per stream per client lifetime so consumers who
        chose to continue are not spammed.
        """
        if not self._zero_edge_pending:
            return
        streams = sorted(self._zero_edge_pending)
        self._zero_edge_pending.clear()
        message = (
            f"Streams {streams!r} pushed rows without market_value; "
            f"positions will be zero until you set market_value per-row "
            f"or call set_market_values() per (symbol, expiry)."
        )
        warnings.warn(PositZeroEdgeWarning(message), stacklevel=3)
        for name in streams:
            self._emit_event(
                "zero_edge_warning", stream_name=name, detail=message,
            )

    def _maybe_warn_ws_fallback(self) -> None:
        """Log once per transition when pushes fall back to REST."""
        state = self._ws_state()
        if state == self._last_warned_ws_state:
            return
        previous = self._last_warned_ws_state
        self._last_warned_ws_state = state
        log.warning(
            "Posit WS state=%s — push falling back to REST (slower but correct).",
            state.value,
        )
        if state == WsState.OPEN and previous is not None:
            self._emit_event(
                "ws_reconnected",
                detail=f"WS recovered to OPEN from {previous.value}",
            )
        else:
            self._emit_event(
                "ws_fallback",
                detail=f"WS state={state.value}; push falling back to REST",
            )

    # ----- Observability -----

    async def health(self) -> HealthResponse:
        """Return the server ``/api/health`` status. Auth-exempt on the server."""
        return await self._require_rest().health()

    async def describe_stream(self, stream_name: str) -> StreamState:
        """Return extended state for one stream (config + row_count + last ingest).

        Raises ``PositApiError(404)`` if the stream is not registered.
        """
        return await self._require_rest().describe_stream(stream_name)

    # ----- Streams -----

    async def list_streams(self) -> list[StreamResponse]:
        return await self._require_rest().list_streams()

    async def _get_dimension_cols(self) -> list[str]:
        """Fetch + cache the server's risk-dimension column names."""
        if self._dimension_cols is None:
            self._dimension_cols = await self._require_rest().get_dimension_cols()
        return self._dimension_cols

    async def _validate_key_cols(self, key_cols: list[str]) -> None:
        if not key_cols:
            raise PositValidationError("key_cols must be a non-empty list")
        if len(set(key_cols)) != len(key_cols):
            raise PositValidationError(f"key_cols contains duplicates: {key_cols}")
        required = await self._get_dimension_cols()
        missing = [c for c in required if c not in key_cols]
        if missing:
            raise PositValidationError(
                f"key_cols must include risk dimensions {required}; missing {missing}"
            )

    async def create_stream(
        self, name: str, key_cols: list[str],
    ) -> StreamResponse:
        """**Deprecated** — use ``upsert_stream`` or ``bootstrap_streams`` instead.

        Two-phase setup (``create_stream`` then ``configure_stream``) leaks the
        ``PENDING`` state into caller code — pushes between the two calls
        silently land in limbo, and a restart mid-setup leaves the desk
        half-configured. ``upsert_stream`` collapses both into one atomic,
        idempotent call with self-rollback on failure.

        Will be removed in v0.2.
        """
        warnings.warn(
            "create_stream is deprecated; use upsert_stream() (idempotent) or "
            "bootstrap_streams() (atomic multi-stream setup). Two-phase setup "
            "will be removed in posit-sdk v0.2.",
            FutureWarning,
            stacklevel=2,
        )
        await self._validate_key_cols(key_cols)
        resp = await self._require_rest().create_stream(name, key_cols)
        self._ready_streams.add(name)
        return resp

    async def update_stream(
        self,
        stream_name: str,
        *,
        new_name: str | None = None,
        new_key_cols: list[str] | None = None,
    ) -> StreamResponse:
        return await self._require_rest().update_stream(
            stream_name, new_name=new_name, new_key_cols=new_key_cols,
        )

    async def configure_stream(
        self,
        stream_name: str,
        *,
        scale: float,
        offset: float = 0.0,
        exponent: float = 1.0,
        block: BlockConfig | None = None,
        connector_name: str | None = None,
        connector_params: dict[str, Any] | None = None,
    ) -> StreamResponse:
        """**Deprecated** — use ``upsert_stream`` / ``bootstrap_streams`` instead.

        Apply the raw→target transform ``target = (scale · raw + offset) ** exponent``
        to a previously-``create_stream``'d stream. Target space is where the
        pipeline math happens; the common pattern is ``exponent=2`` for
        vol → variance.

        Prefer the idempotent path: ``upsert_stream`` takes the same
        ``scale/offset/exponent`` + optional ``block`` and handles create /
        configure atomically with rollback on failure. Or use the named
        factories ``configure_stream_for_variance`` /
        ``configure_stream_for_linear`` for the two common transforms.

        For connector-fed streams, prefer ``upsert_connector_stream``
        which bundles create + connector-aware configure.

        Will be removed in v0.2.
        """
        warnings.warn(
            "configure_stream is deprecated; use upsert_stream() "
            "(atomic + idempotent). Will be removed in posit-sdk v0.2.",
            FutureWarning,
            stacklevel=2,
        )
        return await self._require_rest().configure_stream(
            stream_name,
            scale=scale,
            offset=offset,
            exponent=exponent,
            block=block,
            connector_name=connector_name,
            connector_params=connector_params,
        )

    async def configure_stream_for_variance(
        self,
        stream_name: str,
        key_cols: list[str],
        *,
        scale: float = 1.0,
        offset: float = 0.0,
        block: BlockConfig | None = None,
    ) -> StreamResponse:
        """Idempotent setup for a stream whose raw values square into variance.

        Sets ``exponent=2``; the pipeline receives ``(scale · raw + offset)²``.
        Typical usage — annualized-vol feed, target space is annualized
        variance::

            await client.configure_stream_for_variance(
                "rv_btc", key_cols=["symbol", "expiry"],
            )

        Wraps ``upsert_stream`` — safe to re-run on every process launch.
        """
        return await self.upsert_stream(
            stream_name,
            key_cols=key_cols,
            scale=scale,
            offset=offset,
            exponent=2.0,
            block=block,
        )

    async def configure_stream_for_linear(
        self,
        stream_name: str,
        key_cols: list[str],
        *,
        scale: float = 1.0,
        offset: float = 0.0,
        block: BlockConfig | None = None,
    ) -> StreamResponse:
        """Idempotent setup for a stream with a linear raw→target transform.

        Sets ``exponent=1``; the pipeline receives ``scale · raw + offset``.
        Degenerates to a passthrough when ``scale=1`` and ``offset=0`` (the
        defaults). Use for streams already in target units, or when a simple
        affine re-scaling is all you need::

            # Passthrough — target = raw.
            await client.configure_stream_for_linear(
                "target_var", key_cols=["symbol", "expiry"],
            )
            # Linear — target = 0.01 · raw (bps → decimal).
            await client.configure_stream_for_linear(
                "funding_bps", key_cols=["symbol", "expiry"], scale=0.01,
            )

        Wraps ``upsert_stream`` — safe to re-run on every process launch.
        """
        return await self.upsert_stream(
            stream_name,
            key_cols=key_cols,
            scale=scale,
            offset=offset,
            exponent=1.0,
            block=block,
        )

    async def delete_stream(self, stream_name: str) -> None:
        await self._require_rest().delete_stream(stream_name)
        self._ready_streams.discard(stream_name)

    # ----- Connectors -----

    async def list_connectors(self) -> ConnectorCatalogResponse:
        """Return the server's connector catalog (catalog metadata only).

        Connector implementations live in ``server/core/connectors/`` and
        are never served — this returns the safe-to-show metadata used to
        render the Stream Canvas picker.
        """
        return await self._require_rest().list_connectors()

    async def upsert_connector_stream(
        self,
        stream_name: str,
        connector_name: str,
        *,
        key_cols: list[str],
        params: dict[str, Any] | None = None,
    ) -> StreamResponse:
        """Idempotent connector-fed stream setup — create + configure in one call.

        Looks up ``connector_name`` in the catalog, applies its
        recommended defaults (scale / offset / exponent / block), and
        merges the user-supplied ``params`` over the connector's
        defaults. The resulting stream is connector-fed: snapshot pushes
        return 409 STREAM_IS_CONNECTOR_FED and you must use
        ``push_connector_input`` instead.

        Safe to re-run on every process launch — like ``upsert_stream``,
        existing streams are reconfigured rather than recreated.
        """
        catalog = await self.list_connectors()
        connector = next(
            (c for c in catalog.connectors if c.name == connector_name),
            None,
        )
        if connector is None:
            raise PositValidationError(
                f"Unknown connector {connector_name!r}; available: "
                f"{[c.name for c in catalog.connectors]}"
            )
        await self._validate_key_cols(key_cols)

        existing_by_name = {s.stream_name: s for s in await self.list_streams()}
        existing = existing_by_name.get(stream_name)

        if existing is not None and list(existing.key_cols) != list(key_cols):
            log.info(
                "Connector stream %r key_cols migration %s -> %s",
                stream_name, existing.key_cols, key_cols,
            )
            await self._require_rest().update_stream(
                stream_name, new_key_cols=key_cols,
            )

        created_fresh = existing is None
        if created_fresh:
            await self._require_rest().create_stream(stream_name, key_cols)

        self._ready_streams.add(stream_name)
        try:
            return await self._require_rest().configure_stream(
                stream_name,
                scale=connector.recommended_scale,
                offset=connector.recommended_offset,
                exponent=connector.recommended_exponent,
                block=connector.recommended_block,
                connector_name=connector_name,
                connector_params=params,
            )
        except Exception:
            if created_fresh:
                try:
                    await self._require_rest().delete_stream(stream_name)
                except Exception:
                    log.exception(
                        "Rollback after failed configure of %r also failed", stream_name,
                    )
                self._ready_streams.discard(stream_name)
            raise

    async def push_connector_input(
        self,
        stream_name: str,
        rows: list[ConnectorInputRow],
    ) -> ConnectorInputResponse:
        """Push connector input rows. Prefers WS, falls back to REST.

        Raises ``PositStreamNotRegistered`` synchronously if the target
        stream is not known to be registered. Raises ``PositValidationError``
        on the server's 409 STREAM_IS_NOT_CONNECTOR_FED (the stream exists
        but is user-fed — use ``push_snapshot`` instead).
        """
        self._assert_registered(stream_name)
        if self._ws_state() == WsState.OPEN:
            ack = await self._require_ws().push_connector_input(stream_name, rows)
            return ConnectorInputResponse(
                stream_name=stream_name,
                rows_accepted=ack.rows_accepted,
                # WS ACK doesn't carry the emitted-row count back — REST
                # callers wanting it should use the REST endpoint directly.
                rows_emitted=0,
                pipeline_rerun=ack.pipeline_rerun,
                server_seq=ack.server_seq,
            )
        self._maybe_warn_ws_fallback()
        try:
            return await self._require_rest().push_connector_input(stream_name, rows)
        except PositApiError as exc:
            if self._handle_not_registered(stream_name, exc):
                raise PositStreamNotRegistered(stream_name) from exc
            if exc.status_code == 409 and "STREAM_IS_NOT_CONNECTOR_FED" in exc.message:
                raise PositValidationError(
                    f"Stream {stream_name!r} is not connector-fed; use push_snapshot()."
                ) from exc
            raise

    async def upsert_stream(
        self,
        stream_name: str,
        *,
        key_cols: list[str],
        scale: float = 1.0,
        offset: float = 0.0,
        exponent: float = 1.0,
        block: BlockConfig | None = None,
    ) -> StreamResponse:
        """Idempotent stream setup — create-if-absent, reconfigure-if-present.

        If ``key_cols`` has changed on a pre-existing stream, the stream is
        deleted and recreated (snapshot rows are cleared as a side-effect;
        an ``INFO`` log records the replacement). For everything else the
        call is a no-op on already-matching state — safe to drop into a
        startup script that runs on every process launch.

        Returns the final ``StreamResponse`` (READY after configure).
        """
        await self._validate_key_cols(key_cols)

        existing_by_name = {s.stream_name: s for s in await self.list_streams()}
        existing = existing_by_name.get(stream_name)

        if existing is not None and list(existing.key_cols) != list(key_cols):
            log.info(
                "Stream %r key_cols migration %s -> %s; server preserves rows "
                "when the new set is a superset or subset of the old.",
                stream_name, existing.key_cols, key_cols,
            )
            updated = await self._require_rest().update_stream(
                stream_name, new_key_cols=key_cols,
            )
            # existing is still registered — reuse it for the configure step.
            existing = updated

        created_fresh = existing is None
        if created_fresh:
            await self._require_rest().create_stream(stream_name, key_cols)

        self._ready_streams.add(stream_name)
        try:
            return await self._require_rest().configure_stream(
                stream_name,
                scale=scale,
                offset=offset,
                exponent=exponent,
                block=block,
            )
        except Exception:
            # Self-rollback: if we just created the stream fresh, roll it back
            # so upsert is atomic from the caller's point of view.
            if created_fresh:
                try:
                    await self._require_rest().delete_stream(stream_name)
                except Exception:
                    log.exception(
                        "Rollback after failed configure of %r also failed", stream_name,
                    )
                self._ready_streams.discard(stream_name)
            raise

    async def bootstrap_streams(
        self,
        specs: list[StreamSpec],
        *,
        bankroll: float | None = None,
    ) -> list[StreamResponse]:
        """Upsert a batch of streams and optionally set bankroll — atomically.

        If any step raises, every stream this call newly created (not the
        ones it merely reconfigured) is rolled back via ``delete_stream`` so
        the desk is not left in a half-configured state. Pre-existing
        streams that were reconfigured are left in their updated state —
        we do not have the prior config to revert to, and the caller asked
        for a setup that explicitly allows reconfiguration.
        """
        existing_names = {s.stream_name for s in await self.list_streams()}
        created_by_us: list[str] = []
        responses: list[StreamResponse] = []
        try:
            for spec in specs:
                was_new = spec.stream_name not in existing_names
                resp = await self.upsert_stream(
                    spec.stream_name,
                    key_cols=spec.key_cols,
                    scale=spec.scale,
                    offset=spec.offset,
                    exponent=spec.exponent,
                    block=spec.block,
                )
                if was_new:
                    created_by_us.append(spec.stream_name)
                responses.append(resp)

            if bankroll is not None:
                await self._require_rest().set_bankroll(bankroll)

        except Exception:
            for name in reversed(created_by_us):
                try:
                    await self._require_rest().delete_stream(name)
                except Exception:
                    log.exception("Rollback failed for stream %r", name)
            raise

        return responses

    # ----- Snapshots (REST) -----

    def _assert_registered(self, stream_name: str) -> None:
        """Block pushes to unregistered streams before any network call.

        The cache is populated on ``__aenter__`` and updated after every
        create / delete / upsert. If it drifts (e.g. the server was restarted
        and forgot the registry), the server will return a 409 that we
        translate to the same exception — so callers see one error type
        regardless of where the check fires.
        """
        if stream_name not in self._ready_streams:
            raise PositStreamNotRegistered(stream_name)

    def _handle_not_registered(self, stream_name: str, exc: PositApiError) -> bool:
        """Return True if the server told us the stream is not registered.

        Side-effect: drops the stream from the local cache so a subsequent
        ``list_streams()`` or ``upsert_stream`` can rebuild from truth.
        """
        if exc.status_code != 409:
            return False
        # Structured detail from the server: {"code": "STREAM_NOT_REGISTERED", ...}
        if "STREAM_NOT_REGISTERED" not in exc.message:
            return False
        self._ready_streams.discard(stream_name)
        return True

    async def ingest_snapshot(
        self,
        stream_name: str,
        rows: list[SnapshotRow],
        *,
        allow_zero_edge: bool = False,
    ) -> SnapshotResponse:
        """Ingest snapshot rows via REST.  Use push_snapshot() for lower latency.

        Pass ``allow_zero_edge=True`` to acknowledge that the first push on a
        freshly-configured stream may produce zero positions (no
        ``market_value`` per-row or aggregate). Default False — the server
        refuses with ``PositZeroEdgeBlocked`` rather than silently accepting
        a push that will zero every position.
        """
        self._assert_registered(stream_name)
        self._warn_if_missing_market_value(stream_name, rows)
        try:
            return await self._require_rest().ingest_snapshot(
                stream_name, rows, allow_zero_edge=allow_zero_edge,
            )
        except PositApiError as exc:
            if self._handle_not_registered(stream_name, exc):
                raise PositStreamNotRegistered(stream_name) from exc
            raise

    # ----- Bankroll -----

    async def get_bankroll(self) -> BankrollResponse:
        return await self._require_rest().get_bankroll()

    async def set_bankroll(self, bankroll: float) -> BankrollResponse:
        """Overwrite the server's bankroll with ``bankroll``.

        **Concurrency.** No CAS, no per-feed scoping — this is last-writer-wins
        against whatever value the server holds. Two feeders setting bankroll
        for the same account will clobber each other. If you need per-feed
        attribution, scope bankroll outside the SDK until we add a
        ``set_bankroll(new=..., if_previous=...)`` variant (tracked in
        §8.3 of the integrator audit).
        """
        return await self._require_rest().set_bankroll(bankroll)

    # ----- Blocks -----

    async def list_blocks(self) -> list[BlockRowResponse]:
        return await self._require_rest().list_blocks()

    async def create_manual_block(
        self,
        stream_name: str,
        snapshot_rows: list[SnapshotRow],
        *,
        key_cols: list[str] | None = None,
        scale: float = 1.0,
        offset: float = 0.0,
        exponent: float = 1.0,
        block: BlockConfig | None = None,
        space_id: str | None = None,
    ) -> BlockRowResponse:
        return await self._require_rest().create_manual_block(
            stream_name,
            snapshot_rows,
            key_cols=key_cols,
            scale=scale,
            offset=offset,
            exponent=exponent,
            block=block,
            space_id=space_id,
        )

    async def update_block(
        self,
        stream_name: str,
        *,
        scale: float | None = None,
        offset: float | None = None,
        exponent: float | None = None,
        block: BlockConfig | None = None,
        snapshot_rows: list[SnapshotRow] | None = None,
    ) -> BlockRowResponse:
        return await self._require_rest().update_block(
            stream_name,
            scale=scale,
            offset=offset,
            exponent=exponent,
            block=block,
            snapshot_rows=snapshot_rows,
        )

    async def delete_block(self, stream_name: str) -> None:
        """Delete a manual block (deletes the underlying stream)."""
        await self._require_rest().delete_stream(stream_name)

    # ----- Market values -----

    async def list_market_values(self) -> list[MarketValueEntry]:
        return await self._require_rest().list_market_values()

    async def set_market_values(
        self, entries: list[MarketValueEntry],
    ) -> list[MarketValueEntry]:
        return await self._require_rest().set_market_values(entries)

    async def delete_market_value(self, symbol: str, expiry: str) -> None:
        await self._require_rest().delete_market_value(symbol, expiry)

    # ----- Pushes (WS preferred, REST fallback) -----

    async def push_snapshot(
        self,
        stream_name: str,
        rows: list[SnapshotRow],
        *,
        allow_zero_edge: bool = False,
    ) -> WsAck:
        """Push snapshot rows.

        Uses the WebSocket when ``state == OPEN``; falls back to the REST
        ``ingest_snapshot`` otherwise so a downed WS never silently swallows
        pushes. The fallback logs one WARN per state transition, not per call.

        Raises ``PositStreamNotRegistered`` synchronously if the target stream
        is not known to be registered on the server — ensuring no snapshot
        rows ever reach an unregistered stream.

        Raises ``PositZeroEdgeBlocked`` when the server's first-push zero-edge
        guard fires. Pass ``allow_zero_edge=True`` to opt out.
        """
        self._assert_registered(stream_name)
        self._warn_if_missing_market_value(stream_name, rows)
        if self._ws_state() == WsState.OPEN:
            return await self._require_ws().push_snapshot(
                stream_name, rows, allow_zero_edge=allow_zero_edge,
            )
        self._maybe_warn_ws_fallback()
        try:
            resp = await self._require_rest().ingest_snapshot(
                stream_name, rows, allow_zero_edge=allow_zero_edge,
            )
        except PositApiError as exc:
            if self._handle_not_registered(stream_name, exc):
                raise PositStreamNotRegistered(stream_name) from exc
            raise
        return WsAck(
            type="ack",
            seq=-1,
            rows_accepted=resp.rows_accepted,
            pipeline_rerun=resp.pipeline_rerun,
            server_seq=resp.server_seq,
        )

    async def push_fanned_snapshot(
        self,
        stream_name: str,
        rows: list[SnapshotRow],
        *,
        universe: list[tuple[str, str]] | None = None,
        allow_zero_edge: bool = False,
    ) -> WsAck:
        """Fan scalar-shaped rows across a ``(symbol, expiry)`` universe.

        Every Posit stream must carry the server's risk dimensions — today
        ``(symbol, expiry)``. But plenty of real feeds are scalar-shaped:
        a global funding rate, an event announcement, a market-wide
        indicator. This helper duplicates each input row once per pair in
        ``universe``, attaching ``symbol`` and ``expiry`` to the row copy
        so the server's key-cols invariant is satisfied without the caller
        having to rewrite the fan-out themselves.

        Input rows **must not** already carry ``symbol`` or ``expiry`` —
        the helper inserts them, and a pre-existing value would be a bug
        in the caller's mental model. If ``universe`` is None, the SDK
        fetches it from ``GET /api/pipeline/dimensions``; pass a list to
        scope the fan-out to a subset (e.g. only BTC expiries).

        Returns the ``WsAck`` from the underlying push (a single batched
        ingest under the hood, not one per pair).
        """
        if not rows:
            raise PositValidationError("push_fanned_snapshot requires at least one row")
        for i, row in enumerate(rows):
            extras = row.model_dump()
            if "symbol" in extras or "expiry" in extras:
                raise PositValidationError(
                    f"push_fanned_snapshot: row {i} already carries symbol/expiry — "
                    f"use push_snapshot for pre-fanned rows"
                )

        if universe is None:
            universe = await self._require_rest().get_dimension_universe()
        if not universe:
            raise PositValidationError(
                "push_fanned_snapshot: universe is empty — pass an explicit list "
                "or ensure the pipeline has registered (symbol, expiry) pairs"
            )

        fanned: list[SnapshotRow] = []
        for row in rows:
            base = row.model_dump()
            for sym, exp in universe:
                fanned.append(SnapshotRow(**{**base, "symbol": sym, "expiry": exp}))

        return await self.push_snapshot(
            stream_name, fanned, allow_zero_edge=allow_zero_edge,
        )

    async def push_market_values(
        self, entries: list[MarketValueEntry],
    ) -> WsAck:
        """Push market value entries.

        Uses the WebSocket when ``state == OPEN``; falls back to the REST
        ``set_market_values`` otherwise. REST semantics replace the full set
        (matches the WS behaviour — ``mv_set_entries`` on the server).
        """
        if self._ws_state() == WsState.OPEN:
            return await self._require_ws().push_market_values(entries)
        self._maybe_warn_ws_fallback()
        stored = await self._require_rest().set_market_values(entries)
        return WsAck(type="ack", seq=-1, rows_accepted=len(stored), pipeline_rerun=False)

    async def get_positions(self) -> PositionPayload:
        """One-shot REST snapshot of the latest pipeline broadcast payload.

        Useful from notebooks or any context that does not want to keep a
        WebSocket open. ``positions()`` polls this when the WS is down.
        """
        payload = await self._require_rest().get_positions()
        payload.transport = "poll"
        self._maybe_warn_zero_edge(payload)
        return payload

    async def row_class_for(self, stream_name: str) -> type[SnapshotRow]:
        """Return a typed ``SnapshotRow`` subclass for a specific stream.

        Queries the server for the stream's ``key_cols`` and dynamically
        builds a Pydantic subclass with each of them declared as a required
        ``str`` field. The class is cached per stream for the client
        lifetime — ``describe_stream`` fires once per stream::

            RvBtcRow = await client.row_class_for("rv_btc")
            row = RvBtcRow(
                timestamp="2026-01-01T00:00:00",
                raw_value=0.65,
                market_value=0.70,
                symbol="BTC",
                expiry="27MAR26",
            )
            # Missing `symbol` or `expiry` raises at construction time,
            # not on the server 422.

        Use raw ``SnapshotRow`` for untyped or dynamic-schema callers —
        the typed class is the recommended path for long-lived feeders.
        """
        if stream_name in self._row_class_cache:
            return self._row_class_cache[stream_name]
        state = await self._require_rest().describe_stream(stream_name)
        fields = {col: (str, ...) for col in state.key_cols}
        model = create_model(
            f"SnapshotRow_{stream_name}",
            __base__=SnapshotRow,
            **fields,
        )
        self._row_class_cache[stream_name] = model
        return model

    async def positions_since(self, seq: int) -> PositionsSinceResponse:
        """Fetch every broadcast payload with ``seq > <seq>``.

        Used by a reconnecting consumer to backfill anything missed during
        a WS outage. ``gap_detected`` on the response fires if ``seq`` is
        older than the server's bounded replay buffer — the payload list
        is still populated (oldest-N) but the caller should treat state
        as possibly stale.

        Pair with ``PositionPayload.seq`` / ``prev_seq`` on live payloads
        to drive gap detection.
        """
        return await self._require_rest().positions_since(seq)

    async def diagnose_zero_positions(self) -> ZeroPositionDiagnosticsResponse:
        """Explain every (symbol, expiry) whose ``desired_pos`` is ~zero.

        Calls ``GET /api/diagnostics/zero-positions``. Returns one
        ``ZeroPositionDiagnostic`` per near-zero pair, each carrying a
        closed-enum ``reason`` (``no_market_value`` / ``zero_variance`` /
        ``zero_bankroll`` / ``no_active_blocks`` / ``edge_coincidence`` /
        ``unknown``) plus the scalars that produced it and a human-readable
        ``hint``.

        Intended for bring-up diagnosis — the integrator sees zero positions
        somewhere, runs this, and the response tells them exactly which
        lever to pull (set ``market_value``, flip a stream active, set
        bankroll, etc.).
        """
        return await self._require_rest().diagnose_zero_positions()

    async def positions(
        self, *, poll_interval: float = 2.0,
    ) -> AsyncGenerator[PositionPayload, None]:
        """Yield pipeline position payloads, preferring WS and polling as fallback.

        When the WS is ``OPEN`` at the time of the call, payloads stream
        directly through the socket (live, lowest latency). Otherwise the
        iterator degrades to polling ``GET /api/positions`` at ``poll_interval``
        and yields only when the payload changes. Emits exactly one ``WARNING``
        per degradation so the caller knows latency / freshness characteristics
        have changed.

        Surfaces ``PositZeroEdgeWarning`` via ``warnings.warn`` on the first
        payload after a push missing ``market_value`` — a typed signal that
        the position numbers are about to be zero for a discoverable reason.
        """
        if self._ws is not None and self._ws.state == WsState.OPEN:
            ws = self._ws
            async for payload in ws.positions():
                payload.transport = "ws"
                self._maybe_warn_zero_edge(payload)
                yield payload
            # ws.positions() returns only on close()/FAILED_AUTH. If the
            # client context is still open, degrade to polling.
            if self._rest is None:
                return
            log.warning(
                "Posit WS closed (state=%s); positions() degraded to REST polling.",
                self._ws.state.value,
            )
            self._emit_event(
                "positions_degraded",
                detail=(
                    f"WS closed (state={self._ws.state.value}); positions() "
                    f"degraded to REST polling"
                ),
            )
            async for payload in self._poll_positions(poll_interval):
                yield payload
            return

        ws_state_str = (
            self._ws.state.value if self._ws is not None else "NONE"
        )
        log.warning(
            "Posit WS not OPEN (state=%s); positions() degraded to REST polling.",
            ws_state_str,
        )
        self._emit_event(
            "positions_degraded",
            detail=(
                f"WS not OPEN (state={ws_state_str}); positions() using REST polling"
            ),
        )
        async for payload in self._poll_positions(poll_interval):
            yield payload

    async def _poll_positions(
        self, poll_interval: float,
    ) -> AsyncGenerator[PositionPayload, None]:
        last_seen: str | None = None
        while self._rest is not None:
            try:
                payload = await self.get_positions()
            except PositApiError as exc:
                # 404 = no tick yet; keep waiting. Anything else bubbles up.
                if exc.status_code == 404:
                    await asyncio.sleep(poll_interval)
                    continue
                raise
            current = payload.model_dump_json(by_alias=True)
            if current != last_seen:
                last_seen = current
                yield payload
            await asyncio.sleep(poll_interval)
