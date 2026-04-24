"""
Pipeline time-series wire shapes — block + aggregated + contributions.

Backing ``GET /api/pipeline/dimensions``, ``GET /api/pipeline/timeseries``,
and ``GET /api/pipeline/contributions``. All camelCase on the wire via
``_WireModel``; snake_case in Python so the rest of the server reads the
same fields without aliasing.
"""

from __future__ import annotations

from pydantic import Field

from server.api.models._shared import _WireModel


class TimeSeriesDimension(_WireModel):
    """A single (symbol, expiry) pair from the pipeline dimensions list."""
    symbol: str
    expiry: str


class PipelineDimensionsResponse(_WireModel):
    """Response for ``GET /api/pipeline/dimensions``.

    ``dimension_cols`` names the server-wide risk-dimension column set
    (``RISK_DIMENSION_COLS``) that every stream's ``key_cols`` must be a
    superset of. Clients fetch this once to validate ``create_stream``
    arguments up-front — the field is stable server configuration, not
    derived from the pipeline, so it's populated even when ``dimensions``
    is empty (fresh account, no streams yet).
    """
    dimensions: list[TimeSeriesDimension]
    dimension_cols: list[str] = Field(default_factory=list)


class BlockTimeSeries(_WireModel):
    """Per-block time series for one block on one dimension.

    Pivoted onto a shared `blockTimestamps` axis at the response level so
    the chart can use one x-axis for all blocks. None values mark ticks
    where this particular block doesn't have data (different blocks can
    have different start_timestamps).

    ``stream_name`` and ``start_timestamp`` are carried so the client can
    reconstruct the full composite block identity from a chart series — on
    the same (symbol, expiry), ``block_name`` alone can collide across
    streams.
    """
    block_name: str
    stream_name: str
    space_id: str
    start_timestamp: str | None = None
    timestamps: list[str]
    fair: list[float | None]
    var: list[float | None]


class SpaceSeries(_WireModel):
    """Per-space calc-space contribution lines, aligned with
    ``AggregatedTimeSeries.timestamps``.

    Spaces combine by a pure sum in calc space (Stage D.2 ``aggregation``),
    so these arrays are linearly additive across ``space_id`` at any
    timestamp — the Pipeline chart's decomposition view stacks them. Values
    are in **calc space** (variance-linear), not the display's target-space
    (vol-points) units — the chart labels the y-axis accordingly.
    """
    fair: list[float]
    var: list[float]
    market_fair: list[float]


class AggregatedTimeSeries(_WireModel):
    """Aggregated time series across all blocks on one dimension.

    ``market_vol`` is the user-entered aggregate market vol — same source
    as the grid's Market tab and the WS ticker's ``marketVol`` field —
    emitted as a parallel vol-points series so the Pipeline chart's Market
    view reads identically to the grid cell.

    ``per_space`` carries the calc-space decomposition keyed by
    ``space_id``; empty when the payload comes from the historical ring
    buffer (no per-space history captured there yet).
    """
    timestamps: list[str]
    total_fair: list[float]
    smoothed_total_fair: list[float]
    total_market_fair: list[float]
    smoothed_total_market_fair: list[float]
    edge: list[float]
    smoothed_edge: list[float]
    var: list[float]
    smoothed_var: list[float]
    raw_desired_position: list[float]
    smoothed_desired_position: list[float]
    market_vol: list[float]
    per_space: dict[str, SpaceSeries] = Field(default_factory=dict)


class CurrentBlockDecomposition(_WireModel):
    """Block decomposition snapshot at the current tick timestamp."""
    block_name: str
    stream_name: str
    space_id: str
    start_timestamp: str | None = None
    fair: float
    var: float


class CurrentAggregatedDecomposition(_WireModel):
    """Aggregated decomposition snapshot at the current tick timestamp."""
    total_fair: float
    total_market_fair: float
    edge: float
    smoothed_edge: float
    var: float
    smoothed_var: float
    raw_desired_position: float
    smoothed_desired_position: float


class AggregateMarketValue(_WireModel):
    """The user's set total vol for a (symbol, expiry), if any."""
    total_vol: float


class CurrentDecomposition(_WireModel):
    """Everything the client needs to render the decomposition panel at
    the current tick: per-block + aggregated + the user's set total vol.
    """
    blocks: list[CurrentBlockDecomposition]
    aggregated: CurrentAggregatedDecomposition | None = None
    aggregate_market_value: AggregateMarketValue | None = None


class PipelineTimeSeriesResponse(_WireModel):
    """Response for ``GET /api/pipeline/timeseries``.

    `aggregated.timestamps` is the historical position axis (used by the
    Position view); `block_timestamps` is the forward-looking axis
    spanning current_ts → expiry (used by the Fair / Variance views).
    The two axes are independent on purpose — positions are
    backward-looking and block fair/var curves project forward to expiry.
    """
    symbol: str
    expiry: str
    blocks: list[BlockTimeSeries]
    block_timestamps: list[str]
    aggregated: AggregatedTimeSeries
    current_decomposition: CurrentDecomposition


class PipelineContributionsResponse(_WireModel):
    """Response for ``GET /api/pipeline/contributions``.

    Purpose: let the Pipeline panel's Contributions tab render per-space
    fair / variance / market as stacked areas on a single timestamp axis
    spanning **now − lookback → expiry**. The axis concatenates two
    sources that share the calc-space units (variance-linear):

      * historical segment — ring-buffer points captured at each rerun,
        one per ``(symbol, expiry)`` per rerun. See
        ``position_history.PositionHistoryPoint.per_space``.
      * forward segment — ``space_series_df`` rows on the current rerun's
        forward grid (``current_ts → expiry``).

    ``current_ts`` marks the seam and is rendered as a vertical line on the
    chart so the trader can see past vs projected decay at a glance. The
    two segments share the same units, so the same per-space arrays stack
    cleanly across the seam.
    """
    symbol: str
    expiry: str
    current_ts: str | None
    timestamps: list[str]
    per_space: dict[str, SpaceSeries] = Field(default_factory=dict)
