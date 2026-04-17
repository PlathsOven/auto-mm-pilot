"""PositClient — main entry point for the Posit SDK."""
from __future__ import annotations

from typing import AsyncGenerator

from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    MarketValueEntry,
    PositionPayload,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    WsAck,
)
from posit_sdk.rest import RestClient
from posit_sdk.ws import WsClient


def _http_to_ws(url: str) -> str:
    return url.replace("https://", "wss://").replace("http://", "ws://")


class PositClient:
    """Posit SDK client — manages REST and WebSocket connections.

    Usage::

        async with PositClient(url="http://localhost:8000", api_key="my-key") as client:
            # Configure a stream
            await client.create_stream("rv_btc", key_cols=["symbol", "expiry"])
            await client.configure_stream("rv_btc", scale=1.0)

            # Push data via WebSocket (lower latency)
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
    """

    def __init__(
        self,
        url: str,
        api_key: str,
        *,
        connect_ws: bool = True,
        ws_reconnect_delay: float = 1.0,
        ws_max_reconnect_delay: float = 60.0,
    ) -> None:
        self._url = url.rstrip("/")
        self._api_key = api_key
        self._connect_ws = connect_ws
        self._ws_reconnect_delay = ws_reconnect_delay
        self._ws_max_reconnect_delay = ws_max_reconnect_delay
        self._rest: RestClient | None = None
        self._ws: WsClient | None = None

    async def __aenter__(self) -> "PositClient":
        self._rest = RestClient(self._url, self._api_key)
        await self._rest.__aenter__()
        if self._connect_ws:
            self._ws = WsClient(
                _http_to_ws(self._url) + "/ws/client",
                self._api_key,
                reconnect_delay=self._ws_reconnect_delay,
                max_reconnect_delay=self._ws_max_reconnect_delay,
            )
            await self._ws.connect()
        return self

    async def __aexit__(self, *args: object) -> None:
        if self._ws:
            await self._ws.close()
        if self._rest:
            await self._rest.__aexit__(*args)

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

    # ----- Streams -----

    async def list_streams(self) -> list[StreamResponse]:
        return await self._require_rest().list_streams()

    async def create_stream(
        self, name: str, key_cols: list[str],
    ) -> StreamResponse:
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

    # ----- Snapshots (REST) -----

    async def ingest_snapshot(
        self, stream_name: str, rows: list[SnapshotRow],
    ) -> SnapshotResponse:
        """Ingest snapshot rows via REST.  Use push_snapshot() for lower latency."""
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

    # ----- Market values -----

    async def list_market_values(self) -> list[MarketValueEntry]:
        return await self._require_rest().list_market_values()

    async def set_market_values(
        self, entries: list[MarketValueEntry],
    ) -> list[MarketValueEntry]:
        return await self._require_rest().set_market_values(entries)

    async def delete_market_value(self, symbol: str, expiry: str) -> None:
        await self._require_rest().delete_market_value(symbol, expiry)

    # ----- WebSocket -----

    async def push_snapshot(
        self, stream_name: str, rows: list[SnapshotRow],
    ) -> WsAck:
        """Push snapshot rows via WebSocket (lower latency than REST ingest)."""
        return await self._require_ws().push_snapshot(stream_name, rows)

    async def push_market_values(
        self, entries: list[MarketValueEntry],
    ) -> WsAck:
        """Push market value entries via WebSocket."""
        return await self._require_ws().push_market_values(entries)

    async def positions(self) -> AsyncGenerator[PositionPayload, None]:
        """Async generator that yields incoming pipeline position payloads."""
        ws = self._require_ws()
        async for payload in ws.positions():
            yield payload
