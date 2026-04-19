"""Posit SDK — client library for the Posit trading platform.

Quick start::

    import asyncio
    from posit_sdk import PositClient, SnapshotRow, BlockConfig

    async def main():
        async with PositClient(url="http://localhost:8000", api_key="my-key") as client:
            # One-time setup
            await client.create_stream("rv_btc", key_cols=["symbol", "expiry"])
            await client.configure_stream("rv_btc", scale=1.0)
            await client.set_bankroll(1_000_000.0)

            # Push data in a loop
            row = SnapshotRow(
                timestamp="2024-01-01T00:00:00Z",
                raw_value=0.65,
                symbol="BTC",   # extra key_col
                expiry="2024-06-28",
            )
            ack = await client.push_snapshot("rv_btc", rows=[row])
            print(f"Accepted {ack.rows_accepted} rows, rerun={ack.pipeline_rerun}")

            # Receive live positions
            async for payload in client.positions():
                for pos in payload.positions:
                    print(pos.symbol, pos.expiry, pos.desired_pos)
                break  # take first payload then exit

    asyncio.run(main())
"""

from posit_sdk.client import PositClient
from posit_sdk.exceptions import (
    PositApiError,
    PositAuthError,
    PositConnectionError,
    PositError,
)
from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    DataStream,
    DesiredPosition,
    GlobalContext,
    MarketValueEntry,
    PositionPayload,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    UpdateCard,
    WsAck,
)
from posit_sdk.ws import WsState

__all__ = [
    # Client
    "PositClient",
    # Exceptions
    "PositError",
    "PositAuthError",
    "PositConnectionError",
    "PositApiError",
    # Input models
    "SnapshotRow",
    "MarketValueEntry",
    "BlockConfig",
    # Response models
    "StreamResponse",
    "SnapshotResponse",
    "BankrollResponse",
    "BlockRowResponse",
    # WebSocket models
    "PositionPayload",
    "DesiredPosition",
    "DataStream",
    "GlobalContext",
    "UpdateCard",
    "WsAck",
    "WsState",
]
