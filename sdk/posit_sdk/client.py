"""PositClient — main entry point for the Posit SDK."""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator

from posit_sdk.exceptions import (
    PositApiError,
    PositAuthError,
    PositConnectionError,
    PositValidationError,
)
from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    HealthResponse,
    MarketValueEntry,
    PositionPayload,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    StreamSpec,
    StreamState,
    WsAck,
)
from posit_sdk.rest import RestClient
from posit_sdk.ws import WsClient, WsState

log = logging.getLogger(__name__)


def _http_to_ws(url: str) -> str:
    return url.replace("https://", "wss://").replace("http://", "ws://")


class PositClient:
    """Posit SDK client — manages REST and WebSocket connections.

    Usage::

        async with PositClient(url="http://localhost:8000", api_key="my-key") as client:
            # Configure a stream
            await client.create_stream("rv_btc", key_cols=["symbol", "expiry"])
            await client.configure_stream("rv_btc", scale=1.0)

            # Push data via WebSocket (lower latency); falls back to REST
            # when the WS is not OPEN.
            await client.push_snapshot(
                "rv_btc",
                rows=[SnapshotRow(timestamp="2024-01-01T00:00:00Z", raw_value=0.65,
                                  symbol="BTC", expiry="2024-06-28")],
            )

            # Receive position updates
            async for payload in client.positions():
                for pos in payload.positions:
                    print(pos.symbol, pos.desired_pos)

    Pass ``connect_ws=False`` for REST-only mode (no WebSocket connection).

    ``__aenter__`` hard-blocks on auth: a bad API key raises
    ``PositAuthError`` immediately, so no subsequent call can silently fail
    against a dead key. Pass ``connect_timeout=None`` to disable the WS
    readiness wait if you want eager REST access while the WS is still
    handshaking in the background.
    """

    def __init__(
        self,
        url: str,
        api_key: str,
        *,
        connect_ws: bool = True,
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

    async def __aenter__(self) -> "PositClient":
        self._rest = RestClient(self._url, self._api_key)
        await self._rest.__aenter__()

        # Auth hard-block: probe a REST endpoint that requires auth so a bad
        # key raises here, not on the first user action. The probe doubles as
        # our initial "which streams already exist" cache.
        try:
            await self._rest.list_streams()
        except PositAuthError:
            await self._rest.__aexit__(None, None, None)
            self._rest = None
            raise

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
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._rest:
            await self._rest.__aexit__(*args)
            self._rest = None

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
        if stream_name in self._market_value_warned:
            return
        missing = sum(1 for r in rows if r.market_value is None)
        if missing == 0:
            return
        self._market_value_warned.add(stream_name)
        log.warning(
            "Stream %r: %d row(s) pushed without market_value; per-block "
            "market defaults to fair, so edge will be 0. Set SnapshotRow."
            "market_value or call set_market_values() to fix.",
            stream_name, missing,
        )

    def _maybe_warn_ws_fallback(self) -> None:
        """Log once per transition when pushes fall back to REST."""
        state = self._ws_state()
        if state == self._last_warned_ws_state:
            return
        self._last_warned_ws_state = state
        log.warning(
            "Posit WS state=%s — push falling back to REST (slower but correct).",
            state.value,
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
        await self._validate_key_cols(key_cols)
        return await self._require_rest().create_stream(name, key_cols)

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
    ) -> StreamResponse:
        return await self._require_rest().configure_stream(
            stream_name, scale=scale, offset=offset, exponent=exponent, block=block,
        )

    async def delete_stream(self, stream_name: str) -> None:
        await self._require_rest().delete_stream(stream_name)

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
                "Stream %r key_cols changed %s -> %s; recreating.",
                stream_name, existing.key_cols, key_cols,
            )
            await self._require_rest().delete_stream(stream_name)
            existing = None

        created_fresh = existing is None
        if created_fresh:
            await self._require_rest().create_stream(stream_name, key_cols)

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

    async def ingest_snapshot(
        self, stream_name: str, rows: list[SnapshotRow],
    ) -> SnapshotResponse:
        """Ingest snapshot rows via REST.  Use push_snapshot() for lower latency."""
        self._warn_if_missing_market_value(stream_name, rows)
        return await self._require_rest().ingest_snapshot(stream_name, rows)

    # ----- Bankroll -----

    async def get_bankroll(self) -> BankrollResponse:
        return await self._require_rest().get_bankroll()

    async def set_bankroll(self, bankroll: float) -> BankrollResponse:
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
        self, stream_name: str, rows: list[SnapshotRow],
    ) -> WsAck:
        """Push snapshot rows.

        Uses the WebSocket when ``state == OPEN``; falls back to the REST
        ``ingest_snapshot`` otherwise so a downed WS never silently swallows
        pushes. The fallback logs one WARN per state transition, not per call.
        """
        self._warn_if_missing_market_value(stream_name, rows)
        if self._ws_state() == WsState.OPEN:
            return await self._require_ws().push_snapshot(stream_name, rows)
        self._maybe_warn_ws_fallback()
        resp = await self._require_rest().ingest_snapshot(stream_name, rows)
        return WsAck(
            type="ack",
            seq=-1,
            rows_accepted=resp.rows_accepted,
            pipeline_rerun=resp.pipeline_rerun,
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
        return await self._require_rest().get_positions()

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
        """
        if self._ws is not None and self._ws.state == WsState.OPEN:
            ws = self._ws
            async for payload in ws.positions():
                yield payload
            # ws.positions() returns only on close()/FAILED_AUTH. If the
            # client context is still open, degrade to polling.
            if self._rest is None:
                return
            log.warning(
                "Posit WS closed (state=%s); positions() degraded to REST polling.",
                self._ws.state.value,
            )
            async for payload in self._poll_positions(poll_interval):
                yield payload
            return

        log.warning(
            "Posit WS not OPEN (state=%s); positions() degraded to REST polling.",
            self._ws.state.value if self._ws is not None else "NONE",
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
