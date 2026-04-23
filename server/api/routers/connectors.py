"""Connector catalog endpoint — exposes the metadata side of the IP barrier.

Catalog metadata (name, description, input schema, recommended defaults,
parameter list) is safe to serve to the client; the connector's
implementation lives in ``server/core/connectors/`` and is never
serialised. The endpoint is auth-required like every other /api/* path
but otherwise has no per-user state — the registry is process-global.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.models import (
    BlockConfigPayload,
    ConnectorCatalogResponse,
    ConnectorInputFieldSchema,
    ConnectorParamSchema,
    ConnectorSchema,
)
from server.core.connectors import Connector, list_connectors

router = APIRouter()


def _to_schema(connector: Connector) -> ConnectorSchema:
    """Translate a server-core ``Connector`` into the wire-shape schema."""
    block = connector.recommended.block
    return ConnectorSchema(
        name=connector.name,
        display_name=connector.display_name,
        description=connector.description,
        input_key_cols=list(connector.input_key_cols),
        input_value_fields=[
            ConnectorInputFieldSchema(
                name=f.name, type=f.type, description=f.description,
            )
            for f in connector.input_value_fields
        ],
        output_unit_label=connector.output_unit_label,
        params=[
            ConnectorParamSchema(
                name=p.name,
                type=p.type,
                default=p.default,
                description=p.description,
                min=p.min,
                max=p.max,
            )
            for p in connector.params
        ],
        recommended_scale=connector.recommended.scale,
        recommended_offset=connector.recommended.offset,
        recommended_exponent=connector.recommended.exponent,
        recommended_block=BlockConfigPayload(
            annualized=block.annualized,
            temporal_position=block.temporal_position,
            decay_end_size_mult=block.decay_end_size_mult,
            decay_rate_prop_per_min=block.decay_rate_prop_per_min,
            decay_profile=block.decay_profile,
            var_fair_ratio=block.var_fair_ratio,
        ),
    )


@router.get("/api/connectors", response_model=ConnectorCatalogResponse)
async def get_catalog(_user: User = Depends(current_user)) -> ConnectorCatalogResponse:
    return ConnectorCatalogResponse(
        connectors=[_to_schema(c) for c in list_connectors()],
    )
