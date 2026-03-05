"""
Stream Context Database.

Stores descriptive metadata about each data stream the engine consumes.
This context is injected into the investigation system prompt so the LLM
can ground its reasoning in the actual data sources available, rather than
inventing jargon.

In production, stream context entries will be contributed by the client
via an API. For now, the database is initialised with hardcoded mock data
representing industry-standard data streams.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict


@dataclass(frozen=True)
class StreamContext:
    """Metadata describing a single data stream the engine consumes."""

    id: str
    name: str
    category: str
    description: str
    example_impact: str
    update_frequency: str
    assets: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Mock data — industry-standard data streams
# ---------------------------------------------------------------------------

_MOCK_STREAMS: list[StreamContext] = [
    StreamContext(
        id="stream-realized-vol",
        name="Recent Realized Volatility",
        category="volatility",
        description=(
            "Rolling window of recent realized volatility for each asset. "
            "Used as a primary input to fair value estimation."
        ),
        example_impact=(
            "If realized vol is increasing, fair value of implied vol "
            "increases, so desired long vega position increases."
        ),
        update_frequency="continuous",
        assets=["BTC", "ETH"],
    ),
    StreamContext(
        id="stream-scheduled-events",
        name="Scheduled Volatility Events",
        category="events",
        description=(
            "Known future events that are expected to increase realized "
            "volatility — e.g. FOMC meetings, earnings reports, CPI releases, "
            "protocol upgrades."
        ),
        example_impact=(
            "A scheduled event adds a discrete vol bump to fair value for "
            "expiries that span the event date. As the event passes, the "
            "bump decays and desired position decreases."
        ),
        update_frequency="daily",
        assets=["BTC", "ETH"],
    ),
    StreamContext(
        id="stream-historical-iv",
        name="Historical Implied Volatility Ranges",
        category="volatility",
        description=(
            "Historical percentiles and ranges of implied volatility for "
            "each asset and tenor. Provides context for whether current "
            "implied vol is cheap or expensive relative to history."
        ),
        example_impact=(
            "If current implied vol is at the 10th percentile historically, "
            "fair value is likely above market implied, so desired long vega "
            "position increases."
        ),
        update_frequency="daily",
        assets=["BTC", "ETH"],
    ),
    StreamContext(
        id="stream-vol-flow",
        name="Vol Bidding / Offering Patterns",
        category="flow",
        description=(
            "Observable patterns in how implied volatility gets bid or "
            "offered — e.g. vol getting bid when a new expiry is listed, "
            "vol getting offered close to expiry, vol getting bid in the "
            "days leading up to a known event."
        ),
        example_impact=(
            "If vol is getting bid into an event, fair value of near-dated "
            "implied vol increases, so desired long vega position for that "
            "expiry increases."
        ),
        update_frequency="continuous",
        assets=["BTC", "ETH"],
    ),
    StreamContext(
        id="stream-correlation",
        name="Cross-Asset Correlation Matrix",
        category="correlation",
        description=(
            "Correlation estimates between traded products (coins, expiries). "
            "Used to ensure the firm's net exposure to correlated products "
            "remains consistent when individual positions change."
        ),
        example_impact=(
            "If BTC position increases, ETH position may need to decrease "
            "to keep net correlated exposure the same. Or if near-dated "
            "position changes, far-dated may adjust proportionally."
        ),
        update_frequency="hourly",
        assets=["BTC", "ETH"],
    ),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_store: list[StreamContext] = list(_MOCK_STREAMS)


def get_all_stream_contexts() -> list[StreamContext]:
    """Return all stream context entries."""
    return list(_store)


def get_stream_context(stream_id: str) -> StreamContext | None:
    """Look up a single stream context by ID."""
    for s in _store:
        if s.id == stream_id:
            return s
    return None


def add_stream_context(ctx: StreamContext) -> None:
    """Add a new stream context entry (client-contributed)."""
    _store.append(ctx)


def serialize_stream_contexts() -> str:
    """Serialize all stream contexts to a JSON string for prompt injection."""
    return json.dumps(
        [asdict(s) for s in _store],
        indent=2,
    )
