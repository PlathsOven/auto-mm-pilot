"""Posit SDK — client library for the Posit trading platform.

Quick start::

    import asyncio
    from posit_sdk import PositClient, SnapshotRow, StreamSpec

    async def main():
        async with PositClient(url="http://localhost:8001", api_key="...") as client:
            # One idempotent call — create-or-reconfigure every stream.
            await client.bootstrap_streams(
                [StreamSpec(stream_name="rv_btc",
                            key_cols=["symbol", "expiry"],
                            exponent=2.0)],  # vol → variance
                bankroll=1_000_000.0,
            )

            # Push data.  market_value is mandatory for non-zero positions.
            await client.push_snapshot("rv_btc", [
                SnapshotRow(timestamp="2026-01-01T00:00:00",
                            raw_value=0.65, market_value=0.70,
                            symbol="BTC", expiry="27MAR26"),
            ])

            # Receive live positions (requires connect_ws=True).
            async for payload in client.positions():
                for pos in payload.positions:
                    print(pos.symbol, pos.expiry, pos.desired_pos)
                break

    asyncio.run(main())

Full guide: ``docs/sdk-quickstart.md``.
"""

from posit_sdk.client import PositClient
from posit_sdk.exceptions import (
    PositApiError,
    PositAuthError,
    PositConnectionError,
    PositError,
    PositStreamNotRegistered,
    PositValidationError,
    PositZeroEdgeWarning,
)
from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    DataStream,
    DesiredPosition,
    GlobalContext,
    HealthResponse,
    MarketValueEntry,
    PositionPayload,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    StreamSpec,
    StreamState,
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
    "PositValidationError",
    "PositStreamNotRegistered",
    "PositZeroEdgeWarning",
    # Input models
    "SnapshotRow",
    "MarketValueEntry",
    "BlockConfig",
    "StreamSpec",
    # Response models
    "StreamResponse",
    "StreamState",
    "SnapshotResponse",
    "BankrollResponse",
    "BlockRowResponse",
    "HealthResponse",
    # WebSocket models
    "PositionPayload",
    "DesiredPosition",
    "DataStream",
    "GlobalContext",
    "UpdateCard",
    "WsAck",
    "WsState",
]
