"""
Stage 4 — Impact preview.

Runs the pipeline on a cloned stream-config list (plus the proposed
payload), diffs the resulting desired-position against the user's
current live ``desired_pos_df``, and returns the per-(symbol, expiry)
deltas.

Pure — does not mutate live ``EngineState``. ``run_pipeline`` has no
side effects; we call it directly rather than going through
``EngineState.rerun_pipeline`` (which caches + broadcasts).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import polars as pl

from server.api.engine_state import (
    RISK_DIMENSION_COLS,
    SMOOTHING_HL_SECS,
    TIME_GRID_INTERVAL,
    current_positions_per_dim,
    get_engine,
)
from server.api.llm.orchestration_config import get_llm_orchestration_config
from server.api.market_value_store import to_dict as market_values_to_dict
from server.api.models import (
    PositionDelta,
    PreviewResponse,
    ProposalSnapshotRow,
    ProposedBlockPayload,
)
from server.api.stream_registry import (
    get_stream_registry,
    parse_datetime_tolerant,
)
from server.core.config import BlockConfig, StreamConfig
from server.core.pipeline import run_pipeline

# Column names from the pipeline output used by the diff.
_POSITION_COL = "smoothed_desired_position"


def build_preview(
    user_id: str,
    payload: ProposedBlockPayload,
) -> PreviewResponse:
    """Produce the Stage-4 preview for ``payload`` in ``user_id``'s state.

    - ``create_stream`` proposals always preview as zero-impact — the
      stream registers but carries no data until a feed pushes snapshots.
    - ``create_manual_block`` proposals fan the supplied ``snapshot_rows``
      into a ``StreamConfig`` and rerun the pipeline; deltas reflect the
      new block's contribution.
    """
    engine = get_engine(user_id)
    registry = get_stream_registry(user_id)

    # create_stream has no snapshot → proposes registration only → no
    # position impact until data flows in. Return an empty diff with a
    # clarifying note.
    if payload.action == "create_stream" or not payload.snapshot_rows:
        before_total = _sum_abs_positions(
            engine.pipeline_results.get("desired_pos_df")
            if engine.pipeline_results else None
        )
        return PreviewResponse(
            deltas=[],
            total_bankroll_usage_before=before_total,
            total_bankroll_usage_after=before_total,
            notes=[
                "Stream registered but carries no data yet — desired "
                "positions will shift once live snapshots begin arriving.",
            ],
        )

    proposed_config = _payload_to_stream_config(payload)

    # Clone current configs. If a stream with the proposed name already
    # exists, the preview replaces it (so the trader sees a coherent
    # what-if diff) AND adds a note — the commit endpoint will refuse
    # the same name with 409, so this makes the inconsistency visible
    # rather than silent.
    name_collision = any(
        sc.stream_name == payload.stream_name
        for sc in registry.build_stream_configs()
    )
    current_configs = [
        sc for sc in registry.build_stream_configs()
        if sc.stream_name != payload.stream_name
    ]
    simulated_configs = [*current_configs, proposed_config]

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    aggregate_mv = market_values_to_dict(user_id)

    # Any run_pipeline failure propagates — the /api/blocks/preview
    # handler in routers/build.py logs + converts to a 500.
    simulated = run_pipeline(
        streams=simulated_configs,
        risk_dimension_cols=RISK_DIMENSION_COLS,
        now=now,
        bankroll=engine.bankroll,
        smoothing_hl_secs=SMOOTHING_HL_SECS,
        time_grid_interval=TIME_GRID_INTERVAL,
        transform_config=engine.transform_config,
        aggregate_market_values=aggregate_mv,
        space_market_values={},
    )

    before_df = engine.pipeline_results.get("desired_pos_df") if engine.pipeline_results else None
    after_df = simulated["desired_pos_df"]

    deltas = _compute_deltas(before_df, after_df)
    before_total = _sum_abs_positions(before_df)
    after_total = _sum_abs_positions(after_df)

    notes: list[str] = []
    if name_collision:
        notes.append(
            f"Stream '{payload.stream_name}' already exists — preview "
            "shows a what-if replacement, but commit will refuse "
            "(delete the existing stream first or rename this one)."
        )
    if engine.state is not None:
        state_ts = engine.state.get("timestamp")
        if isinstance(state_ts, str):
            try:
                live_ts = datetime.fromisoformat(state_ts.replace("Z", "+00:00"))
                if live_ts.tzinfo is not None:
                    live_ts = live_ts.astimezone(timezone.utc).replace(tzinfo=None)
                age = (now - live_ts).total_seconds()
                if age > get_llm_orchestration_config().preview_stale_threshold_secs:
                    notes.append(
                        f"Before state captured {age:.0f}s ago; live tick "
                        "will refresh after commit.",
                    )
            except ValueError:
                pass

    return PreviewResponse(
        deltas=deltas,
        total_bankroll_usage_before=before_total,
        total_bankroll_usage_after=after_total,
        notes=notes,
    )


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def _payload_to_stream_config(payload: ProposedBlockPayload) -> StreamConfig:
    """Build a ``StreamConfig`` directly from a proposal payload.

    Bypasses ``StreamRegistry`` so preview never mutates the registry.
    The construction mirrors ``StreamRegistration.to_stream_config`` —
    rows go into a polars DataFrame with key_cols + timestamp + raw_value
    (+ optional start_timestamp for event blocks).
    """
    snapshot_df = _rows_to_dataframe(payload.snapshot_rows)
    block = BlockConfig(
        annualized=payload.block.annualized,
        temporal_position=payload.block.temporal_position,
        decay_end_size_mult=payload.block.decay_end_size_mult,
        decay_rate_prop_per_min=payload.block.decay_rate_prop_per_min,
        var_fair_ratio=payload.block.var_fair_ratio,
    )
    return StreamConfig(
        stream_name=payload.stream_name,
        snapshot=snapshot_df,
        key_cols=list(payload.key_cols),
        scale=payload.scale,
        offset=payload.offset,
        exponent=payload.exponent,
        block=block,
    )


def _rows_to_dataframe(rows: list[ProposalSnapshotRow]) -> pl.DataFrame:
    """Shape the snapshot rows into a pipeline-ready DataFrame.

    Columns: ``symbol`` / ``expiry`` plus ``timestamp`` and ``raw_value``,
    plus ``start_timestamp`` iff any row carries one (event-vol blocks).

    ``expiry`` is parsed to ``datetime`` so it concats cleanly with
    pipeline-side streams that store expiries as Datetime (the trader-
    facing ingestion path normalises the same way).
    """
    any_start = any(r.start_timestamp is not None for r in rows)
    records: list[dict[str, Any]] = []
    for r in rows:
        expiry = r.expiry
        parsed_expiry = _parse_expiry(expiry) if isinstance(expiry, str) else expiry
        record: dict[str, Any] = {
            "timestamp": r.timestamp,
            "symbol": r.symbol,
            "expiry": parsed_expiry,
            "raw_value": r.raw_value,
        }
        if any_start:
            record["start_timestamp"] = r.start_timestamp
        records.append(record)
    df = pl.DataFrame(records)

    # Pipeline expects certain dtypes — coerce defensively.
    casts: list[pl.Expr] = []
    if "timestamp" in df.columns:
        casts.append(pl.col("timestamp").cast(pl.Datetime, strict=False))
    if "expiry" in df.columns and df.schema["expiry"] != pl.Datetime:
        casts.append(pl.col("expiry").cast(pl.Datetime, strict=False))
    if "start_timestamp" in df.columns:
        casts.append(pl.col("start_timestamp").cast(pl.Datetime, strict=False))
    if "raw_value" in df.columns:
        casts.append(pl.col("raw_value").cast(pl.Float64, strict=False))
    if casts:
        df = df.with_columns(casts)

    return df


def _parse_expiry(raw: str) -> datetime:
    """Parse an expiry string into a naive UTC datetime."""
    dt = parse_datetime_tolerant(raw)
    if dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt


def _compute_deltas(
    before_df: pl.DataFrame | None,
    after_df: pl.DataFrame,
) -> list[PositionDelta]:
    """Build the list of ``(symbol, expiry)`` position deltas.

    Left-joins the "current row" per dim from each frame on
    ``(symbol, expiry)`` and emits one ``PositionDelta`` per dim that
    appears in the after-frame. ``percent_change`` is ``None`` when
    ``before == 0`` (undefined).
    """
    after_current = current_positions_per_dim(after_df)
    if after_current.is_empty():
        return []

    before_current = (
        current_positions_per_dim(before_df) if before_df is not None else None
    )
    if before_current is None or before_current.is_empty():
        rows = after_current.with_columns(
            pl.lit(0.0).alias("before"),
            pl.col(_POSITION_COL).alias("after"),
            pl.col(_POSITION_COL).alias("absolute_change"),
            pl.lit(None, dtype=pl.Float64).alias("percent_change"),
            pl.col("expiry").cast(pl.Utf8).alias("expiry_str"),
        )
    else:
        rows = (
            after_current.rename({_POSITION_COL: "after"})
            .join(
                before_current.rename({_POSITION_COL: "before"}),
                on=["symbol", "expiry"],
                how="left",
            )
            .with_columns(pl.col("before").fill_null(0.0))
            .with_columns(
                (pl.col("after") - pl.col("before")).alias("absolute_change"),
                pl.when(pl.col("before") != 0.0)
                .then((pl.col("after") - pl.col("before")) / pl.col("before") * 100.0)
                .otherwise(None)
                .alias("percent_change"),
                pl.col("expiry").cast(pl.Utf8).alias("expiry_str"),
            )
        )

    return [
        PositionDelta(
            symbol=r["symbol"],
            expiry=r["expiry_str"],
            before=float(r["before"]),
            after=float(r["after"]),
            absolute_change=float(r["absolute_change"]),
            percent_change=(
                float(r["percent_change"])
                if r["percent_change"] is not None else None
            ),
        )
        for r in rows.to_dicts()
    ]


def _sum_abs_positions(df: pl.DataFrame | None) -> float:
    """Sum ``|smoothed_desired_position|`` across current-tick rows per dim."""
    if df is None or df.is_empty():
        return 0.0
    current = current_positions_per_dim(df)
    return float(current[_POSITION_COL].abs().sum())
