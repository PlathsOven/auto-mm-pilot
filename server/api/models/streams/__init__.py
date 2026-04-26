"""
Stream / connector / snapshot / block-table / WS / transform / market-value
and pipeline time-series shapes.

The original monolithic ``models/streams.py`` was 997 LOC covering nine
distinct concerns; it's been decomposed into purpose-scoped sub-modules.
This ``__init__`` re-exports every name so the existing
``from server.api.models.streams import X`` callsites keep working.

Sub-modules:

* ``crud`` — stream CRUD + connector catalog + admin configure.
* ``ingest`` — snapshot, bankroll, aggregate market-value ingest responses.
* ``blocks`` — block table, opinions aggregator, manual-block ingest.
* ``correlations`` — symbol + expiry correlation matrices (Stage H).
* ``ws_client`` — bidirectional ``/ws/client`` frames + ACK union.
* ``transforms`` — pipeline transform configuration.
* ``broadcast`` — per-tick broadcast payload + notification channels.
* ``pipeline_series`` — block / aggregated / contributions time-series.
"""

from __future__ import annotations

from server.api.models.streams.blocks import (
    BlockListResponse,
    BlockRowResponse,
    ManualBlockRequest,
    Opinion,
    OpinionActivePatch,
    OpinionDescriptionPatch,
    OpinionKind,
    OpinionsListResponse,
    UpdateBlockRequest,
)
from server.api.models.streams.broadcast import (
    CorrelationSingularAlert,
    DataStream,
    DesiredPosition,
    GlobalContext,
    MarketValueMismatchAlert,
    PositionsSinceResponse,
    ServerPayload,
    SilentStreamAlert,
    UnregisteredPushAttempt,
    UpdateCard,
    ZeroPositionDiagnostic,
    ZeroPositionDiagnosticsResponse,
    ZeroPositionReason,
)
from server.api.models.streams.correlations import (
    ApplyExpiryCorrelationMethodRequest,
    CorrelationEntry,
    ExpiryCorrelationEntry,
    ExpiryCorrelationListResponse,
    ExpiryCorrelationMethodParam,
    ExpiryCorrelationMethodSchema,
    ExpiryCorrelationMethodsResponse,
    SetExpiryCorrelationsRequest,
    SetSymbolCorrelationsRequest,
    SymbolCorrelationEntry,
    SymbolCorrelationListResponse,
)
from server.api.models.streams.crud import (
    AdminConfigureStreamRequest,
    BlockConfigPayload,
    ConnectorCatalogResponse,
    ConnectorInputFieldSchema,
    ConnectorInputRequest,
    ConnectorInputResponse,
    ConnectorInputRow,
    ConnectorParamSchema,
    ConnectorSchema,
    ConnectorStateSummary,
    CreateStreamRequest,
    SetStreamActiveRequest,
    StreamKeyTimeseries,
    StreamListResponse,
    StreamResponse,
    StreamStateResponse,
    StreamTimeseriesPoint,
    StreamTimeseriesResponse,
    UpdateStreamRequest,
)
from server.api.models.streams.ingest import (
    BankrollRequest,
    BankrollResponse,
    DeleteMarketValueResponse,
    MarketValueEntry,
    MarketValueListResponse,
    SetMarketValueRequest,
    SnapshotRequest,
    SnapshotResponse,
)
from server.api.models.streams.pipeline_series import (
    AggregatedTimeSeries,
    AggregateMarketValue,
    BlockTimeSeries,
    CurrentAggregatedDecomposition,
    CurrentBlockDecomposition,
    CurrentDecomposition,
    PipelineContributionsResponse,
    PipelineDimensionsResponse,
    PipelineTimeSeriesResponse,
    SpaceSeries,
    TimeSeriesDimension,
)
from server.api.models.streams.transforms import (
    TransformConfigRequest,
    TransformListResponse,
    TransformParamResponse,
    TransformResponse,
    TransformStepResponse,
)
from server.api.models.streams.ws_client import (
    ClientWsAck,
    ClientWsConnectorInputFrame,
    ClientWsError,
    ClientWsInboundFrame,
    ClientWsMarketValueFrame,
    ClientWsOutboundFrame,
)

__all__ = [
    # blocks
    "BlockListResponse",
    "BlockRowResponse",
    "ManualBlockRequest",
    "Opinion",
    "OpinionActivePatch",
    "OpinionDescriptionPatch",
    "OpinionKind",
    "OpinionsListResponse",
    "UpdateBlockRequest",
    # broadcast
    "CorrelationSingularAlert",
    "DataStream",
    "DesiredPosition",
    "GlobalContext",
    "MarketValueMismatchAlert",
    "PositionsSinceResponse",
    "ServerPayload",
    "SilentStreamAlert",
    "UnregisteredPushAttempt",
    "UpdateCard",
    "ZeroPositionDiagnostic",
    "ZeroPositionDiagnosticsResponse",
    "ZeroPositionReason",
    # correlations
    "ApplyExpiryCorrelationMethodRequest",
    "CorrelationEntry",
    "ExpiryCorrelationEntry",
    "ExpiryCorrelationListResponse",
    "ExpiryCorrelationMethodParam",
    "ExpiryCorrelationMethodSchema",
    "ExpiryCorrelationMethodsResponse",
    "SetExpiryCorrelationsRequest",
    "SetSymbolCorrelationsRequest",
    "SymbolCorrelationEntry",
    "SymbolCorrelationListResponse",
    # crud
    "AdminConfigureStreamRequest",
    "BlockConfigPayload",
    "ConnectorCatalogResponse",
    "ConnectorInputFieldSchema",
    "ConnectorInputRequest",
    "ConnectorInputResponse",
    "ConnectorInputRow",
    "ConnectorParamSchema",
    "ConnectorSchema",
    "ConnectorStateSummary",
    "CreateStreamRequest",
    "SetStreamActiveRequest",
    "StreamKeyTimeseries",
    "StreamListResponse",
    "StreamResponse",
    "StreamStateResponse",
    "StreamTimeseriesPoint",
    "StreamTimeseriesResponse",
    "UpdateStreamRequest",
    # ingest
    "BankrollRequest",
    "BankrollResponse",
    "DeleteMarketValueResponse",
    "MarketValueEntry",
    "MarketValueListResponse",
    "SetMarketValueRequest",
    "SnapshotRequest",
    "SnapshotResponse",
    # pipeline_series
    "AggregatedTimeSeries",
    "AggregateMarketValue",
    "BlockTimeSeries",
    "CurrentAggregatedDecomposition",
    "CurrentBlockDecomposition",
    "CurrentDecomposition",
    "PipelineContributionsResponse",
    "PipelineDimensionsResponse",
    "PipelineTimeSeriesResponse",
    "SpaceSeries",
    "TimeSeriesDimension",
    # transforms
    "TransformConfigRequest",
    "TransformListResponse",
    "TransformParamResponse",
    "TransformResponse",
    "TransformStepResponse",
    # ws_client
    "ClientWsAck",
    "ClientWsConnectorInputFrame",
    "ClientWsError",
    "ClientWsInboundFrame",
    "ClientWsMarketValueFrame",
    "ClientWsOutboundFrame",
]
