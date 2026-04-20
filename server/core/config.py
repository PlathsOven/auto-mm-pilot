"""
Core pipeline configuration dataclasses.

Defines the immutable configuration types used by the pipeline:
- ``BlockConfig`` — how a single block distributes value through time.
- ``StreamConfig`` — specification of a data stream and its snapshot.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import polars as pl

SECONDS_PER_YEAR: float = 365.25 * 24 * 60 * 60


@dataclass(frozen=True)
class BlockConfig:
    """Immutable configuration for how a single block distributes value through time.

    These parameters are set per-stream and inherited by every block that stream produces.
    The only per-block override is ``start_timestamp`` (read from the snapshot row).
    """

    annualized: bool = True
    temporal_position: Literal["static", "shifting"] = "shifting"
    decay_end_size_mult: float = 1.0
    decay_rate_prop_per_min: float = 0.0
    decay_profile: Literal["linear"] = "linear"
    var_fair_ratio: float = 1.0

    def __post_init__(self):
        assert self.temporal_position in ("static", "shifting")
        assert self.decay_profile in ("linear",)
        assert self.decay_end_size_mult >= 0
        assert self.decay_rate_prop_per_min >= 0
        if self.decay_end_size_mult != 0 and not self.annualized:
            raise ValueError(
                "decay_end_size_mult is only applicable for annualized streams"
            )


@dataclass(frozen=True)
class StreamConfig:
    """Immutable specification of a data stream.

    ``snapshot`` is the raw DataFrame the stream provides.  It must contain all
    ``key_cols`` plus ``timestamp`` and ``raw_value``.

    ``key_cols`` is the full index of the snapshot — used to deduplicate to the
    latest row per key.  It must be a superset of the pipeline's
    ``risk_dimension_cols`` (e.g. ``["symbol", "expiry"]``), plus any extra keys
    specific to the stream (e.g. ``"event_id"``).
    """

    stream_name: str
    snapshot: pl.DataFrame
    key_cols: list[str]
    scale: float = 1.0
    offset: float = 0.0
    exponent: float = 1.0
    # Generic conversion params dict — when non-empty, takes precedence over
    # scale/offset/exponent.  Keys match the selected unit_conversion function's
    # parameter names (e.g. {"scale": 1.0, "offset": 0.0, "exponent": 2.0}).
    conversion_params: dict[str, float] = field(default_factory=dict)
    block: BlockConfig = field(default_factory=BlockConfig)
    space_id_override: str | None = None

    def get_conversion_params(self) -> dict[str, float]:
        """Return conversion params, falling back to legacy fields."""
        if self.conversion_params:
            return self.conversion_params
        return {"scale": self.scale, "offset": self.offset, "exponent": self.exponent}
