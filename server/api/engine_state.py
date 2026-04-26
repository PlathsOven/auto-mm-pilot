"""
Per-user engine state.

Each user owns an ``EngineState`` instance holding their pipeline snapshot,
snapshot ring buffer, bankroll, and transform config. The LLM service layer
and the WS ticker reach state via ``user_id`` so two users' pipelines never
contend on shared mutable globals.

Mock-scenario bootstrapping was removed in the multi-user rollout — every
new account starts empty and fills the pipeline by registering streams
through the client (or the SDK).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import polars as pl

from server.api.config import (
    SNAPSHOT_BUFFER_MAX_DEFAULT,
    SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT,
)
from server.api.correlation_matrix import SingularCorrelationError
from server.api.llm.snapshot_buffer import SnapshotBufferConfig, SnapshotRingBuffer
from server.api.position_history import (
    PositionHistoryBuffer,
    build_from_desired_pos_df,
    build_per_space_at_tick,
)
from server.api.user_scope import UserRegistry
from server.core.pipeline import run_pipeline
from server.core.serializers import engine_state_from_pipeline, snapshot_from_pipeline

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Server-wide pipeline knobs (not user-settable)
# ---------------------------------------------------------------------------
# Legacy mock scenario exposed these as "mock" constants; the pipeline code
# still asks for them. For v1 multi-user, they are server-wide defaults —
# users can't configure risk dimensions or smoothing half-life per account.

RISK_DIMENSION_COLS: list[str] = ["symbol", "expiry"]
SMOOTHING_HL_SECS: int = 60
TIME_GRID_INTERVAL: str = "1m"

# Starter bankroll for a fresh account. Non-zero so newly-registered streams
# produce a non-zero desired position out of the box (the sizing formula is
# edge · bankroll / var — a zero default made every position collapse to 0
# until the trader manually set a value). Small so no one mistakes it for
# real sizing; the trader is expected to overwrite it in the StatusBar pill.
DEFAULT_BANKROLL: float = 1000.0


# ---------------------------------------------------------------------------
# Per-user engine state
# ---------------------------------------------------------------------------

class EngineState:
    """Everything downstream of the pipeline for a single user."""

    def __init__(self) -> None:
        self.snapshot_buffer: SnapshotRingBuffer | None = None
        self.position_history: PositionHistoryBuffer = PositionHistoryBuffer()
        self.pipeline_snapshot: dict[str, Any] | None = None
        self.state: dict[str, Any] | None = None
        self.pipeline_results: dict[str, pl.DataFrame] | None = None
        self.bankroll: float = DEFAULT_BANKROLL
        self.transform_config: dict[str, Any] | None = None

    def rerun_pipeline(
        self,
        streams: list[Any],
        bankroll: float | None = None,
        transform_config: dict[str, Any] | None = None,
        aggregate_market_values: dict[tuple[str, str], float] | None = None,
        space_market_values: dict[tuple[str, str, str], float] | None = None,
        symbol_correlations: dict[tuple[str, str], float] | None = None,
        expiry_correlations: dict[tuple[str, str], float] | None = None,
        symbol_correlations_draft: dict[tuple[str, str], float] | None = None,
        expiry_correlations_draft: dict[tuple[str, str], float] | None = None,
    ) -> dict[str, pl.DataFrame]:
        """Re-run the pipeline for this user and update all state."""
        if not streams:
            raise ValueError("Cannot rerun pipeline with zero streams")

        if bankroll is not None:
            self.bankroll = bankroll
        if transform_config is not None:
            self.transform_config = transform_config

        now = datetime.now(timezone.utc).replace(tzinfo=None)

        log.info(
            "Pipeline rerun: %d streams, bankroll=%.2f, now=%s",
            len(streams), self.bankroll, now,
        )

        self.pipeline_results = run_pipeline(
            streams=streams,
            risk_dimension_cols=RISK_DIMENSION_COLS,
            now=now,
            bankroll=self.bankroll,
            smoothing_hl_secs=SMOOTHING_HL_SECS,
            time_grid_interval=TIME_GRID_INTERVAL,
            transform_config=self.transform_config,
            aggregate_market_values=aggregate_market_values or {},
            space_market_values=space_market_values or {},
            symbol_correlations=symbol_correlations or {},
            expiry_correlations=expiry_correlations or {},
            symbol_correlations_draft=symbol_correlations_draft,
            expiry_correlations_draft=expiry_correlations_draft,
        )

        self.pipeline_snapshot = snapshot_from_pipeline(
            results=self.pipeline_results,
            timestamp=now,
            risk_dimension_cols=RISK_DIMENSION_COLS,
            bankroll=self.bankroll,
            smoothing_hl_secs=SMOOTHING_HL_SECS,
            now=now,
        )

        self.state = engine_state_from_pipeline(
            results=self.pipeline_results,
            timestamp=now,
            risk_dimension_cols=RISK_DIMENSION_COLS,
        )

        if self.snapshot_buffer is None:
            self.snapshot_buffer = SnapshotRingBuffer(SnapshotBufferConfig(
                max_snapshots=SNAPSHOT_BUFFER_MAX_DEFAULT,
                lookback_offsets_seconds=SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT,
            ))
        self.snapshot_buffer.push(now, self.pipeline_snapshot)

        # Capture per-dimension desired-position point at `now`. Separate from
        # the LLM snapshot buffer so prompt payloads stay lean while the
        # Position chart gets a full time series across reruns. Per-space
        # calc-space values are captured alongside so the Pipeline chart's
        # decomposition view works across the historical window too.
        # Stage H persists the committed correlation matrices on every
        # point so historical playback uses the matrices that were active
        # at each snapshot, not today's matrices.
        pos_rows = build_from_desired_pos_df(self.pipeline_results["desired_pos_df"], now)
        per_space = build_per_space_at_tick(self.pipeline_results["space_series_df"], now)
        self.position_history.push_rows(
            pos_rows, now, aggregate_market_values or {}, per_space,
            symbol_correlations=symbol_correlations or {},
            expiry_correlations=expiry_correlations or {},
        )

        return self.pipeline_results


_engine_states: UserRegistry[EngineState] = UserRegistry(EngineState)


def get_engine(user_id: str) -> EngineState:
    """Return the per-user ``EngineState`` (lazily constructed)."""
    return _engine_states.get(user_id)


def active_user_ids() -> list[str]:
    """List user ids with a live engine state (used by the WS ticker)."""
    return _engine_states.active_users()


def current_positions_per_dim(df: pl.DataFrame) -> pl.DataFrame:
    """Pick the earliest row per ``(symbol, expiry)`` from ``desired_pos_df``.

    ``desired_pos_df`` is a forward projection from ``now``; the first row
    after sort-by-timestamp is the "current" value. ``maintain_order``
    guards against hash-order non-determinism (see tasks/lessons.md).
    """
    if df.is_empty():
        return df
    return (
        df.sort(["symbol", "expiry", "timestamp"])
        .group_by(["symbol", "expiry"], maintain_order=True)
        .agg(pl.col("smoothed_desired_position").first())
    )


# ---------------------------------------------------------------------------
# Thin functional wrappers kept for backwards compatibility with callers.
# ---------------------------------------------------------------------------

def rerun_pipeline(
    user_id: str,
    streams: list[Any],
    bankroll: float | None = None,
    transform_config: dict[str, Any] | None = None,
) -> dict[str, pl.DataFrame]:
    from server.api.correlation_alert_store import (
        clear_all as clear_correlation_alerts,
        record as record_correlation_alert,
    )
    from server.api.correlation_store import (
        get_expiry_store as get_expiry_corr,
        get_symbol_store as get_symbol_corr,
    )
    from server.api.market_value_store import to_dict as mv_to_dict

    sym_corr = get_symbol_corr(user_id)
    exp_corr = get_expiry_corr(user_id)
    try:
        results = get_engine(user_id).rerun_pipeline(
            streams=streams,
            bankroll=bankroll,
            transform_config=transform_config,
            aggregate_market_values=mv_to_dict(user_id),
            symbol_correlations=sym_corr.committed_map(),
            expiry_correlations=exp_corr.committed_map(),
            symbol_correlations_draft=sym_corr.draft_map(),
            expiry_correlations_draft=exp_corr.draft_map(),
        )
    except SingularCorrelationError as e:
        # Persist the alert so the next WS tick surfaces it in the
        # Notifications Center. Re-raise so the caller knows the rerun
        # did not succeed (the ticker path logs-and-continues; routes
        # convert to 400 / 409 as appropriate).
        record_correlation_alert(user_id, e)
        raise
    # Successful rerun — clear any stale singular alerts so the user
    # doesn't keep seeing a warning after fixing the matrix.
    clear_correlation_alerts(user_id)
    return results


def set_bankroll(user_id: str, value: float) -> None:
    get_engine(user_id).bankroll = value
    log.info("Bankroll updated for user=%s to %.2f", user_id, value)


def get_bankroll(user_id: str) -> float:
    return get_engine(user_id).bankroll


def get_engine_state(user_id: str) -> dict[str, Any]:
    state = get_engine(user_id).state
    return state if state is not None else {}


def get_pipeline_snapshot(user_id: str) -> dict[str, Any] | None:
    return get_engine(user_id).pipeline_snapshot


def get_pipeline_results(user_id: str) -> dict[str, pl.DataFrame] | None:
    return get_engine(user_id).pipeline_results


def get_snapshot_buffer(user_id: str) -> SnapshotRingBuffer | None:
    return get_engine(user_id).snapshot_buffer


def get_position_history(user_id: str) -> PositionHistoryBuffer:
    return get_engine(user_id).position_history


def get_transform_config(user_id: str) -> dict[str, Any] | None:
    return get_engine(user_id).transform_config


def set_transform_config(user_id: str, config: dict[str, Any]) -> None:
    get_engine(user_id).transform_config = config
    log.info("Transform config updated for user=%s: %s", user_id, list(config.keys()))


# ---------------------------------------------------------------------------
# Atomic rerun + broadcast helper
# ---------------------------------------------------------------------------

async def rerun_and_broadcast(
    user_id: str,
    stream_configs: list,
    *,
    bankroll: float | None = None,
    transform_config: dict | None = None,
) -> None:
    """Re-run this user's pipeline and restart their WS ticker.

    The ticker restart import is lazy to avoid a circular import between
    ``engine_state`` and ``ws``.
    """
    from server.api.ws import restart_ticker

    kwargs: dict[str, Any] = {}
    if bankroll is not None:
        kwargs["bankroll"] = bankroll
    if transform_config is not None:
        kwargs["transform_config"] = transform_config

    await asyncio.to_thread(rerun_pipeline, user_id, stream_configs, **kwargs)
    await restart_ticker(user_id)
