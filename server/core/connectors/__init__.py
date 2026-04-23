"""Server-side pre-built input transforms (connectors).

Public surface — anything outside ``server.core.connectors`` should import
from this module rather than the implementation files. Connector code is
never served to the client; only catalog metadata leaves the server.
"""
from __future__ import annotations

from server.core.connectors.base import (
    Connector,
    ConnectorInputFieldSchema,
    ConnectorParamSchema,
    ConnectorRecommendation,
    ConnectorStateSummary,
    EmittedRow,
    resolve_params,
)
from server.core.connectors.registry import (
    CONNECTOR_REGISTRY,
    get_connector,
    list_connectors,
)

__all__ = [
    "CONNECTOR_REGISTRY",
    "Connector",
    "ConnectorInputFieldSchema",
    "ConnectorParamSchema",
    "ConnectorRecommendation",
    "ConnectorStateSummary",
    "EmittedRow",
    "get_connector",
    "list_connectors",
    "resolve_params",
]
