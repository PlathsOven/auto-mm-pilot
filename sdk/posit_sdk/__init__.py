"""Posit SDK — client library for the Posit trading platform.

Quick start — one-shot integration::

    import asyncio
    from posit_sdk import PositClient, SnapshotRow, StreamSpec

    async def main():
        async with PositClient.from_env() as client:  # reads POSIT_URL / POSIT_API_KEY
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

            payload = await client.get_positions()
            for pos in payload.positions:
                print(pos.symbol, pos.expiry, pos.desired_pos)

    asyncio.run(main())

Long-running feeder (reconnecting WebSocket sources + periodic tasks)::

    from posit_sdk import PositClient, forward_websocket, repeat

    async def handle(client, msg): ...

    async def main():
        async with PositClient.from_env() as client:
            await client.bootstrap_streams(SPECS, bankroll=1_000_000.0)
            await client.run(
                forward_websocket(URL_1, lambda m: handle(client, m)),
                forward_websocket(URL_2, lambda m: handle(client, m)),
                repeat(lambda: republish(client), every=30.0),
            )

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
    PositZeroEdgeBlocked,
    PositZeroEdgeWarning,
)
from posit_sdk.models import (
    BankrollResponse,
    BlockConfig,
    BlockRowResponse,
    ConnectorCatalogResponse,
    ConnectorInputFieldSchema,
    ConnectorInputResponse,
    ConnectorInputRow,
    ConnectorParamSchema,
    ConnectorSchema,
    ConnectorStateSummary,
    DataStream,
    DesiredPosition,
    GlobalContext,
    HealthResponse,
    IntegratorEvent,
    IntegratorEventType,
    MarketValueEntry,
    PositionPayload,
    PositionTransport,
    PositionsSinceResponse,
    SnapshotResponse,
    SnapshotRow,
    StreamResponse,
    StreamSpec,
    StreamState,
    UpdateCard,
    WsAck,
    ZeroPositionDiagnostic,
    ZeroPositionDiagnosticsResponse,
)
from posit_sdk.runtime import forward_websocket, repeat, run_forever
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
    "PositZeroEdgeBlocked",
    "PositZeroEdgeWarning",
    # Input models
    "SnapshotRow",
    "MarketValueEntry",
    "BlockConfig",
    "StreamSpec",
    "ConnectorInputRow",
    # Response models
    "StreamResponse",
    "StreamState",
    "SnapshotResponse",
    "BankrollResponse",
    "BlockRowResponse",
    "HealthResponse",
    "ZeroPositionDiagnostic",
    "ZeroPositionDiagnosticsResponse",
    "IntegratorEvent",
    "IntegratorEventType",
    "ConnectorCatalogResponse",
    "ConnectorInputFieldSchema",
    "ConnectorInputResponse",
    "ConnectorParamSchema",
    "ConnectorSchema",
    "ConnectorStateSummary",
    # WebSocket models
    "PositionPayload",
    "PositionTransport",
    "PositionsSinceResponse",
    "DesiredPosition",
    "DataStream",
    "GlobalContext",
    "UpdateCard",
    "WsAck",
    "WsState",
    # Runtime helpers for long-running feeders
    "forward_websocket",
    "repeat",
    "run_forever",
]
