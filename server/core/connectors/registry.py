"""Connector registry — single source of truth for which connectors exist.

The registry is populated at import time (no dynamic plugin loading in v1)
and accessed by the API layer through ``get_connector`` / ``list_connectors``.
Adding a new connector is a single-file change: implement the protocol in
``server/core/connectors/<name>.py`` and append it to the ``_REGISTERED``
tuple below.
"""
from __future__ import annotations

from server.core.connectors.base import Connector
from server.core.connectors.realized_vol import REALIZED_VOL_CONNECTOR


_REGISTERED: tuple[Connector, ...] = (REALIZED_VOL_CONNECTOR,)

CONNECTOR_REGISTRY: dict[str, Connector] = {c.name: c for c in _REGISTERED}


def get_connector(name: str) -> Connector | None:
    """Return the connector with ``name`` or ``None`` if unknown."""
    return CONNECTOR_REGISTRY.get(name)


def list_connectors() -> list[Connector]:
    """Return every registered connector in registration order."""
    return list(_REGISTERED)
