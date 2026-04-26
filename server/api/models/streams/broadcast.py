"""
Broadcast wire shapes (camelCase on the wire — see ``_WireModel``).

Models the JSON the server emits on every pipeline tick: streams list,
global context, desired-position grid, update cards, plus the notification
channels (unregistered pushes, silent streams, market-value mismatches,
zero-position diagnostics). Wire shape is unchanged from the original
monolithic ``models/streams.py`` — these are Pydantic envelopes over the
dict builders in ``ws_serializers.py``.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from server.api.models._shared import _WireModel


class DataStream(_WireModel):
    """One data-stream entry in the pipeline broadcast.

    ``active`` mirrors the registry flag — inactive streams are still emitted
    on the WS payload (so the UI can render them dimmed and offer a
    reactivate affordance) but their blocks don't appear in the pipeline
    output for this tick.
    """
    id: str
    name: str
    status: Literal["ONLINE", "DEGRADED", "OFFLINE"]
    last_heartbeat: int
    active: bool = True


class GlobalContext(_WireModel):
    """Global context strip — shown in the top bar."""
    last_update_timestamp: int


class DesiredPosition(_WireModel):
    """One row of the desired-position grid.

    Variance-space scalars (``edge`` / ``variance`` / ``total_fair`` / …) are
    kept for the math-facing surfaces (``LiveEquationStrip``, pipeline chart).
    The ``*_vol`` fields lift those back into annualised vol points via the
    inverse of ``total_vol ** 2 → aggregate_var`` — sum the per-grid-cell
    variance-unit value from the current tick to expiry, divide by T in
    years, sign-preserving sqrt. That's the number an options trader reads.

    Stage H (``exposure_to_position``) splits the old ``desired_pos`` /
    ``raw_desired_pos`` into an exposure (pre-correlation) and a position
    (post-correlation). The ``*_exposure`` fields are always emitted — they
    equal the position fields when both matrices are identity. The
    ``*_hypothetical`` fields are populated only when a draft correlation
    matrix is live; otherwise they're ``None``.
    """
    symbol: str
    expiry: str
    # Canonical ISO expiry key (full datetime with time-of-day) — used as
    # the correlation-matrix identity. ``expiry`` is DDMMMYY for display;
    # DDMMMYY discards time-of-day, which misaligns with the pipeline's
    # actual expiry column (e.g. crypto options typically expire at 08:00
    # UTC, not midnight). Keep them separate: ``expiry`` for eyes,
    # ``expiry_iso`` for joins + correlation lookups.
    expiry_iso: str
    edge: float
    smoothed_edge: float
    variance: float
    smoothed_var: float
    desired_pos: float
    raw_desired_pos: float
    # Defaults are M1 placeholders — the serializer (M4) emits real
    # values once the pipeline's Stage H lands (M3). Both fields are
    # always emitted when the full pipeline is wired; they equal the
    # position fields when both correlation matrices are identity.
    raw_desired_exposure: float = 0.0
    smoothed_desired_exposure: float = 0.0
    raw_desired_position_hypothetical: float | None = None
    smoothed_desired_position_hypothetical: float | None = None
    current_pos: float
    total_fair: float
    smoothed_total_fair: float
    total_market_fair: float
    smoothed_total_market_fair: float
    edge_vol: float
    smoothed_edge_vol: float
    variance_vol: float
    smoothed_var_vol: float
    total_fair_vol: float
    smoothed_total_fair_vol: float
    total_market_fair_vol: float
    smoothed_total_market_fair_vol: float
    market_vol: float
    change_magnitude: float
    updated_at: int


class UpdateCard(_WireModel):
    """A position-change update card in the feed."""
    id: str
    symbol: str
    expiry: str
    old_pos: float
    new_pos: float
    delta: float
    timestamp: int


class UnregisteredPushAttempt(_WireModel):
    """One entry in the unregistered-stream push notification list.

    Populated by the snapshots router / client WS when a caller pushes to
    a ``stream_name`` the server does not know, so the UI can render a
    notification with an example row and a "Register this stream" CTA that
    deep-links into Anatomy with the stream form pre-filled. The caller
    itself still receives 409 ``STREAM_NOT_REGISTERED`` — this model is the
    operator-side surface, not an ingest path.
    """
    stream_name: str
    example_row: dict[str, Any]
    attempt_count: int
    first_seen: str  # ISO 8601 UTC
    last_seen: str  # ISO 8601 UTC


class MarketValueMismatchAlert(_WireModel):
    """Per-(symbol, expiry) alert when per-block market values don't reconcile
    to the user's aggregate marketVol.

    The market-value-inference step is built so that the forward-integrated
    per-block ``target_market_value`` equals the aggregate variance — i.e.
    ``totalMarketFairVol`` (what the pipeline implies) equals ``marketVol``
    (what the user set). When the two visibly disagree, it's a real
    inconsistency: either the user overrode per-block values past what the
    inferred blocks can absorb, or no inferred blocks have forward coverage,
    or no aggregate was set at all but per-block values are non-zero.

    All three fields are in vol points (annualised vol × 100) so the card can
    render them directly alongside the CellInspector reading.
    """
    symbol: str
    expiry: str  # wire format (DDMMMYY), matches DesiredPosition.expiry
    aggregate_vol: float  # user-set marketVol, 0 if unset
    implied_vol: float  # totalMarketFairVol from the pipeline
    diff: float  # implied - aggregate


class CorrelationSingularAlert(_WireModel):
    """Per-matrix alert emitted when the pipeline caught a singular C.

    Raised by Stage H's ``check_singular`` call; persisted per-user so
    the next WS tick carries the alert into the Notifications Center.
    ``matrix_kind`` is ``"symbol"`` or ``"expiry"``. ``det`` and
    ``condition_number`` are reported so the UI can show the trader
    *why* their matrix is degenerate (e.g. a perfect ρ=1 pair).
    """
    matrix_kind: Literal["symbol", "expiry"]
    det: float
    condition_number: float


class SilentStreamAlert(_WireModel):
    """A READY stream whose recent snapshots carried no ``market_value``.

    When a stream emits only ``raw_value``, the pipeline defaults
    market-implied value to match fair — edge collapses to zero and every
    desired position reads zero with no explanation. Surfacing the alert
    lets the trader see the cause. Threshold is ``SILENT_STREAM_THRESHOLD``
    in ``config.py``; the counter resets the moment a row with a non-None
    ``market_value`` arrives.
    """
    stream_name: str
    rows_seen: int
    first_seen: str  # ISO 8601 UTC
    last_seen: str  # ISO 8601 UTC


ZeroPositionReason = Literal[
    "no_market_value",
    "zero_variance",
    "zero_bankroll",
    "no_active_blocks",
    "edge_coincidence",
    "unknown",
]


class ZeroPositionDiagnostic(_WireModel):
    """One (symbol, expiry) whose desired_pos is (near-)zero, with a reason.

    Returned from ``GET /api/diagnostics/zero-positions``. Surfaces the single
    most common integrator failure ("my positions are zero and there's no
    error") with a closed-enum reason + the scalars to verify.

    ``aggregate_market_value`` is ``None`` when no aggregate has been set for
    this (symbol, expiry); a concrete value means an entry exists in the
    user's ``MarketValueStore``.
    """
    symbol: str
    expiry: str
    raw_edge: float
    raw_variance: float
    desired_pos: float
    total_fair: float
    total_market_fair: float
    aggregate_market_value: float | None = None
    reason: ZeroPositionReason
    hint: str


class ZeroPositionDiagnosticsResponse(_WireModel):
    """Response for ``GET /api/diagnostics/zero-positions``."""
    bankroll: float
    tick_timestamp: int | None = None
    diagnostics: list[ZeroPositionDiagnostic]


class ServerPayload(_WireModel):
    """Top-level payload broadcast on ``/ws`` each tick.

    ``seq`` / ``prev_seq`` are per-user monotonic broadcast sequence numbers;
    together they let a reconnecting consumer detect gaps and fetch missed
    payloads via ``GET /api/positions/since/{seq}``.
    """
    streams: list[DataStream]
    context: GlobalContext
    positions: list[DesiredPosition]
    updates: list[UpdateCard]
    unregistered_pushes: list[UnregisteredPushAttempt] = Field(default_factory=list)
    silent_streams: list[SilentStreamAlert] = Field(default_factory=list)
    market_value_mismatches: list[MarketValueMismatchAlert] = Field(default_factory=list)
    correlation_alerts: list[CorrelationSingularAlert] = Field(default_factory=list)
    seq: int = 0
    prev_seq: int = 0


class PositionsSinceResponse(_WireModel):
    """Response for ``GET /api/positions/since/{seq}``.

    ``payloads`` are full ServerPayloads with monotonically increasing
    ``seq``. ``gap_detected`` is True if the caller asked for a seq older
    than the server's replay buffer holds — in that case ``payloads`` is
    the oldest N, and the caller should assume state is stale.
    """
    payloads: list[ServerPayload]
    gap_detected: bool = False
    latest_seq: int
