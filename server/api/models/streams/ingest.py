"""
Snapshot + bankroll + aggregate-market-value ingest request / response shapes.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from server.api.expiry import canonical_expiry_key
from server.api.models._shared import SnapshotRow


# ---------------------------------------------------------------------------
# Snapshot ingestion
# ---------------------------------------------------------------------------

class SnapshotRequest(BaseModel):
    """Client pushes new snapshot rows for a READY stream."""
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
            "may produce zero positions because no market_value is carried "
            "(per-row or aggregate). Default False fails closed — see the "
            "zero-edge guard for the contract."
        ),
    )


class SnapshotResponse(BaseModel):
    stream_name: str
    rows_accepted: int
    pipeline_rerun: bool
    server_seq: int = Field(
        0,
        description=(
            "Server-assigned monotonic sequence number for this ingest. "
            "Paired with the WS ACK's server_seq so consumers have a single "
            "correlation key regardless of transport."
        ),
    )


# ---------------------------------------------------------------------------
# Bankroll
# ---------------------------------------------------------------------------

class BankrollRequest(BaseModel):
    bankroll: float = Field(..., gt=0, description="Portfolio bankroll")


class BankrollResponse(BaseModel):
    bankroll: float
    pipeline_rerun: bool


# ---------------------------------------------------------------------------
# Aggregate market values
# ---------------------------------------------------------------------------

class MarketValueEntry(BaseModel):
    """One aggregate market value entry for a symbol/expiry pair.

    ``expiry`` is normalised to the canonical naive-ISO key on ingest so the
    store holds the same form the Polars pipeline looks up with — see
    ``server/api/expiry.py``.
    """
    symbol: str = Field(..., min_length=1)
    expiry: str = Field(..., min_length=1)
    total_vol: float = Field(..., ge=0, description="Annualized total vol (must be >= 0)")

    @field_validator("expiry")
    @classmethod
    def _canonicalise_expiry(cls, v: str) -> str:
        return canonical_expiry_key(v)


class SetMarketValueRequest(BaseModel):
    """Batch-set aggregate market values."""
    entries: list[MarketValueEntry] = Field(..., min_length=1)


class MarketValueListResponse(BaseModel):
    """All aggregate market values currently stored."""
    entries: list[MarketValueEntry]


class DeleteMarketValueResponse(BaseModel):
    """Response for ``DELETE /api/market-values/{symbol}/{expiry}``."""
    deleted: bool
    symbol: str
    expiry: str
