"""
Client-facing WebSocket frames on ``/ws/client``.

Bidirectional — inbound frames (snapshots, market values, connector inputs)
each receive an outbound ACK; errors surface as an ``ClientWsError``. The
outbound discriminated union gives parsers a single-hop decode path.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from server.api.models._shared import SnapshotRow
from server.api.models.streams.crud import ConnectorInputRow
from server.api.models.streams.ingest import MarketValueEntry


class ClientWsInboundFrame(BaseModel):
    """Text frame sent by the client over the /ws/client channel.

    The client sends snapshot rows for a named stream.  Each frame
    receives a JSON ACK so the client knows we processed it.
    """
    seq: int = Field(..., description="Sequence number — echoed back in ACK")
    stream_name: str = Field(..., min_length=1)
    rows: list[SnapshotRow] = Field(
        ...,
        min_length=1,
        description=(
            "Snapshot rows. Each row must contain 'timestamp', 'raw_value', "
            "and all key_cols defined on the stream."
        ),
    )
    allow_zero_edge: bool = Field(
        False,
        description=(
            "Acknowledge that the first push on a freshly-configured stream "
            "may produce zero positions because no market_value is carried. "
            "See SnapshotRequest.allow_zero_edge."
        ),
    )


class ClientWsMarketValueFrame(BaseModel):
    """Market value frame sent by the client over /ws/client.

    Carries aggregate market vol entries that are written to the
    MarketValueStore.  No immediate pipeline rerun — the dirty-flag
    coalescing in the WS ticker picks it up on the next tick.
    """
    type: Literal["market_value"] = "market_value"
    seq: int = Field(..., description="Sequence number — echoed back in ACK")
    entries: list[MarketValueEntry] = Field(
        ...,
        min_length=1,
        description="Aggregate market value entries to store",
    )


class ClientWsConnectorInputFrame(BaseModel):
    """Connector input frame sent by the client over /ws/client.

    Mirrors ``ConnectorInputRequest`` on the REST side. The ACK reuses
    ``ClientWsAck`` (``rows_accepted`` is the inbound row count; the
    emitted-row count isn't carried back over WS — REST callers wanting
    the precise emit count should use the REST endpoint).
    """
    type: Literal["connector_input"] = "connector_input"
    seq: int = Field(..., description="Sequence number — echoed back in ACK")
    stream_name: str = Field(..., min_length=1)
    rows: list[ConnectorInputRow] = Field(..., min_length=1)


class ClientWsAck(BaseModel):
    """ACK response sent back for every inbound frame."""
    type: Literal["ack"] = "ack"
    seq: int = Field(..., description="Echoed sequence number from the inbound frame")
    rows_accepted: int = 0
    pipeline_rerun: bool = False
    server_seq: int = Field(
        0,
        description=(
            "Server-assigned monotonic sequence number — matches the value "
            "`SnapshotResponse.server_seq` returns for the REST ingest path."
        ),
    )


class ClientWsError(BaseModel):
    """Error response sent when an inbound frame fails validation/processing."""
    type: Literal["error"] = "error"
    seq: int | None = Field(None, description="Sequence number if parseable, else null")
    detail: str


# Discriminated union for everything the server can send back on /ws/client.
# The ``type`` literal on each member doubles as the runtime discriminator
# for any parser that wants to decode an outbound frame without trial-and-
# error matching (e.g. the client-side adapter, for future use).
ClientWsOutboundFrame = Annotated[
    Union[ClientWsAck, ClientWsError],
    Field(discriminator="type"),
]
