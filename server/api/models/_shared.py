"""
Shared Pydantic primitives used across the ``server.api.models`` package.

Kept tiny and dependency-light so every sub-module can import from it
without risking cycles. Sub-modules (`auth`, `streams`, `llm`) may
import from this module and stdlib only.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


# Single source of truth — imported by prompts/__init__.py and service.py.
ChatMode = Literal["investigate", "build", "general"]


class _WireModel(BaseModel):
    """Base for outbound wire-shape models.

    Emits camelCase JSON via an alias generator but accepts either
    camelCase or snake_case on input.  Use for models whose JSON
    representation must be camelCase (pipeline time-series endpoints,
    WebSocket broadcast payloads).  Endpoints whose wire format is
    already snake_case (``BlockRowResponse``, ``StreamResponse``, etc.)
    stay on plain ``BaseModel``.
    """
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SnapshotRow(BaseModel):
    """One row of a snapshot ingestion payload.

    Extra keys are permitted because the set of ``key_cols`` varies per
    stream — the server validates the required set at ingestion time in
    ``stream_registry.ingest_snapshot``. Everything else (timestamp,
    raw_value) is statically required.

    Empty strings on any field are canonicalised to ``None`` before field
    validation so downstream Polars casts (e.g. ``market_value`` → Float64
    in the pipeline) don't see ``""`` in a numeric column. This is the
    single canonical point every ingest path (HTTP POST, /ws/client, and
    ManualBlockRequest.snapshot_rows) passes through.
    """
    model_config = {"extra": "allow"}

    timestamp: str = Field(..., description="ISO 8601 timestamp")
    raw_value: float = Field(..., description="Raw measurement value")

    @model_validator(mode="before")
    @classmethod
    def _empty_strings_to_none(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        return {k: (None if isinstance(v, str) and v == "" else v) for k, v in data.items()}


class CellContext(BaseModel):
    """Cell context forwarded to the LLM investigation endpoint.

    Mirrors ``InvestigationContext`` in ``client/ui/src/types.ts``. The
    discriminated ``type`` field distinguishes between a card click and a
    cell click; the remaining shape is passed through unchanged because
    it duplicates fields already validated on the client side.
    """
    model_config = {"extra": "allow"}

    type: Literal["update", "position"]
