"""Pipeline time series endpoints — scoped to the calling user."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime as _dt, timedelta, timezone

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from fastapi.responses import Response

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import (
    RISK_DIMENSION_COLS,
    get_pipeline_results,
    get_position_history,
)
from server.api.expiry import canonical_expiry_key
from server.api.market_value_store import to_dict as mv_to_dict
from server.api.models import (
    PipelineDimensionsResponse,
    PipelineTimeSeriesResponse,
    ServerPayload,
)
from server.api.stream_registry import parse_datetime_tolerant
from server.api.ws import get_current_tick_ts, get_latest_payload

# Decimal → vol points. Same value as ``VOL_POINTS_SCALE`` in the WS
# serializer; kept local so this router doesn't drag in tick-time helpers.
_VOL_POINTS_SCALE: float = 100.0

log = logging.getLogger(__name__)

router = APIRouter()


def _pipeline_dimensions_sync(user_id: str) -> dict:
    # `dimension_cols` is server-wide config — emit it even when the user
    # has no pipeline results yet so the SDK can validate `create_stream`
    # key_cols on a fresh account.
    results = get_pipeline_results(user_id)
    if results is None:
        return {"dimensions": [], "dimension_cols": list(RISK_DIMENSION_COLS)}

    pos_df = results["desired_pos_df"]
    dims = (
        pos_df.select(RISK_DIMENSION_COLS)
        .unique()
        .sort(RISK_DIMENSION_COLS)
    )
    dim_rows = dims.to_dicts()
    for d in dim_rows:
        exp = d["expiry"]
        d["expiry"] = exp.isoformat() if hasattr(exp, "isoformat") else str(exp)
    return {"dimensions": dim_rows, "dimension_cols": list(RISK_DIMENSION_COLS)}


def _pipeline_timeseries_sync(
    user_id: str,
    symbol: str,
    expiry_dt: _dt,
    lookback_seconds: int | None = None,
) -> dict | None:
    results = get_pipeline_results(user_id)
    if results is None:
        return None

    block_var_df = results["block_var_df"]
    pos_df = results["desired_pos_df"]
    blocks_df = results["blocks_df"]

    # (block_name, stream_name) → start_timestamp lookup. `block_fair_df`
    # (and therefore `block_var_df`) doesn't carry `start_timestamp`, so
    # we source it from the flat `blocks_df` whose identity is the full
    # composite key. Used to stamp the per-block series payload with its
    # block-side identity material.
    start_ts_map: dict[tuple[str, str], _dt | None] = {}
    if {"block_name", "stream_name", "start_timestamp"} <= set(blocks_df.columns):
        for r in blocks_df.select("block_name", "stream_name", "start_timestamp").to_dicts():
            start_ts_map[(r["block_name"], r["stream_name"])] = r.get("start_timestamp")

    current_ts = get_current_tick_ts(user_id)
    expiry_date = expiry_dt.date()

    # Cast expiry to date for the equality check so columns stored as
    # `pl.Datetime` and `pl.Date` both match — different stream-config
    # paths can leave one or the other dtype, and a strict `== expiry_dt`
    # silently drops everything in the mismatched case (the bug behind
    # "no contributing blocks for any cell").
    block_var_filtered = block_var_df.filter(
        (pl.col("symbol") == symbol)
        & (pl.col("expiry").cast(pl.Date) == expiry_date)
    ).drop_nulls(subset=["fair"])
    pos_filtered = pos_df.filter(
        (pl.col("symbol") == symbol)
        & (pl.col("expiry").cast(pl.Date) == expiry_date)
    ).drop_nulls(subset=["raw_desired_position"])

    # Independent slicing: positions are backward-looking (rerun_time → now)
    # so the trader sees how the position evolved; block fair/variance are
    # forward-looking (now → expiry decay curves). The earlier shared-OR
    # condition wiped out one when the other had data, breaking the chart's
    # current-decomposition snapshot in either direction.
    #
    # `desired_pos_df` is computed at rerun as a forward projection from
    # rerun_time → expiry, and the ticker advances `current_ts` through that
    # range as real time catches up. Rows with `timestamp <= current_ts` are
    # the "already-revealed" projections — those are the backward-looking
    # history the Position view wants. Without the upper-bound filter the
    # chart also plotted the unrevealed future decay (which ends at 0 at
    # expiry), producing the phantom trailing-0 the user reported.
    # Slice anchor for past-vs-future: prefer the WS ticker's `current_tick_ts`
    # (which advances through `desired_pos_df`'s forward grid as real time
    # passes), and fall back to wall-clock UTC so the chart is still correct
    # on a fresh request where the ticker hasn't set state yet.
    slice_ts = current_ts if current_ts is not None else _dt.now(timezone.utc).replace(tzinfo=None)
    bv_sliced = block_var_filtered.filter(pl.col("timestamp") >= slice_ts)
    if not bv_sliced.is_empty():
        block_var_filtered = bv_sliced
    pos_sliced = pos_filtered.filter(pl.col("timestamp") <= slice_ts)
    log.info(
        "pipeline timeseries: user=%s sym=%s exp=%s slice_ts=%s current_ts=%s "
        "pos_full=%d pos_sliced=%d",
        user_id, symbol, expiry_date, slice_ts, current_ts,
        pos_filtered.height, pos_sliced.height,
    )
    if not pos_sliced.is_empty():
        pos_filtered = pos_sliced

    if block_var_filtered.is_empty() and pos_filtered.is_empty():
        return None

    block_names = sorted(block_var_filtered["block_name"].unique().to_list())
    # Canonical forward-looking timestamp axis for fair/variance views — the
    # union of every block's timestamps. Each block's data array is then
    # pivoted onto this axis (None where the block doesn't have a value at
    # that tick) so the chart can use one shared x-axis for all blocks.
    block_axis = (
        block_var_filtered.select("timestamp").unique().sort("timestamp")["timestamp"].to_list()
    )
    block_timestamps = [t.isoformat() for t in block_axis]
    block_axis_index = {t: i for i, t in enumerate(block_axis)}

    blocks = []
    for bn in block_names:
        bd = block_var_filtered.filter(pl.col("block_name") == bn).sort("timestamp")
        fair_arr: list[float | None] = [None] * len(block_axis)
        var_arr: list[float | None] = [None] * len(block_axis)
        for row in bd.select("timestamp", "fair", "var").to_dicts():
            idx = block_axis_index.get(row["timestamp"])
            if idx is None:
                continue
            fair_arr[idx] = row["fair"]
            var_arr[idx] = row["var"]
        stream_name_val = bd["stream_name"][0] if bd.height > 0 and "stream_name" in bd.columns else ""
        start_ts_val = start_ts_map.get((bn, stream_name_val))
        blocks.append({
            "blockName": bn,
            "streamName": stream_name_val,
            "spaceId": bd["space_id"][0] if bd.height > 0 else "",
            "startTimestamp": start_ts_val.isoformat() if start_ts_val is not None else None,
            "timestamps": block_timestamps,
            "fair": fair_arr,
            "var": var_arr,
        })

    pos_sorted = pos_filtered.sort("timestamp")

    # Current user-entered aggregate market vol, scaled to vol points. The
    # history buffer stores per-tick snapshots; the projection path has no
    # historical signal so it broadcasts the live value across the window.
    mv_store = mv_to_dict(user_id)
    mv_key = (symbol, canonical_expiry_key(expiry_dt))
    current_market_vol_vp = mv_store.get(mv_key, 0.0) * _VOL_POINTS_SCALE

    if lookback_seconds is not None and lookback_seconds > 0:
        # Position view wants a true historical window. `desired_pos_df` is
        # a forward projection wiped at every rerun, so for anything beyond
        # the last few ticks we must read from the per-dimension ring buffer
        # that accumulates across reruns (see `server/api/position_history`).
        history = get_position_history(user_id).get_range(
            symbol=symbol,
            expiry=expiry_dt.isoformat(),
            since=slice_ts - timedelta(seconds=lookback_seconds),
        )
        aggregated = {
            "timestamps": [p.timestamp.isoformat() for p in history],
            "totalFair": [p.total_fair for p in history],
            "totalMarketFair": [p.total_market_fair for p in history],
            "edge": [p.edge for p in history],
            "smoothedEdge": [p.smoothed_edge for p in history],
            "var": [p.var for p in history],
            "smoothedVar": [p.smoothed_var for p in history],
            "rawDesiredPosition": [p.raw_desired_position for p in history],
            "smoothedDesiredPosition": [p.smoothed_desired_position for p in history],
            "marketVol": [p.market_vol for p in history],
        }
    else:
        timestamps = [t.isoformat() for t in pos_sorted["timestamp"].to_list()]
        aggregated = {
            "timestamps": timestamps,
            "totalFair": pos_sorted["total_fair"].to_list(),
            "totalMarketFair": pos_sorted["total_market_fair"].to_list(),
            "edge": pos_sorted["edge"].to_list(),
            "smoothedEdge": pos_sorted["smoothed_edge"].to_list(),
            "var": pos_sorted["var"].to_list(),
            "smoothedVar": pos_sorted["smoothed_var"].to_list(),
            "rawDesiredPosition": pos_sorted["raw_desired_position"].to_list(),
            "smoothedDesiredPosition": pos_sorted["smoothed_desired_position"].to_list(),
            "marketVol": [current_market_vol_vp] * len(timestamps),
        }

    current_blocks = []
    if block_var_filtered.height > 0:
        first_ts = block_var_filtered["timestamp"].min()
        latest_block_var = block_var_filtered.filter(pl.col("timestamp") == first_ts)
        cols = latest_block_var.columns
        select_cols = ["block_name", "space_id", "fair", "var"]
        if "stream_name" in cols:
            select_cols.insert(1, "stream_name")
        for d in latest_block_var.select(select_cols).to_dicts():
            stream_name_val = d.get("stream_name", "")
            start_ts_val = start_ts_map.get((d["block_name"], stream_name_val))
            current_blocks.append({
                "blockName": d["block_name"],
                "streamName": stream_name_val,
                "spaceId": d["space_id"],
                "startTimestamp": start_ts_val.isoformat() if start_ts_val is not None else None,
                "fair": d["fair"],
                "var": d["var"],
            })

    current_agg: dict | None = None
    if pos_sorted.height > 0:
        # pos_sorted is ascending; the current-decomposition snapshot is the
        # most recent revealed row (== current_ts after the slice above).
        last = pos_sorted.row(pos_sorted.height - 1, named=True)
        current_agg = {
            "totalFair": last["total_fair"],
            "totalMarketFair": last["total_market_fair"],
            "edge": last["edge"],
            "smoothedEdge": last["smoothed_edge"],
            "var": last["var"],
            "smoothedVar": last["smoothed_var"],
            "rawDesiredPosition": last["raw_desired_position"],
            "smoothedDesiredPosition": last["smoothed_desired_position"],
        }

    aggregate_mvs = mv_to_dict(user_id)
    expiry_iso = expiry_dt.isoformat()
    agg_mv_entry = aggregate_mvs.get((symbol, expiry_iso))
    agg_mv = {"totalVol": agg_mv_entry} if agg_mv_entry is not None else None

    return {
        "symbol": symbol,
        "blocks": blocks,
        "blockTimestamps": block_timestamps,
        "aggregated": aggregated,
        "currentDecomposition": {
            "blocks": current_blocks,
            "aggregated": current_agg,
            "aggregateMarketValue": agg_mv,
        },
    }


@router.get("/api/positions", response_model=ServerPayload)
async def get_positions(user: User = Depends(current_user)) -> Response:
    """Return the latest pipeline broadcast payload as a one-shot REST snapshot.

    Same wire shape as the ``/ws`` broadcast (``ServerPayload``). Useful for
    notebook-style consumers that don't want to keep a WebSocket open, and
    as the fallback path the SDK polls when the WS is down.

    The underlying payload is cached as a JSON string by the ticker, so the
    handler returns it verbatim — no re-serialisation round-trip per request.
    """
    latest = get_latest_payload(user.id)
    if latest is None:
        raise HTTPException(
            status_code=404,
            detail="No positions available yet — pipeline has not produced a tick",
        )
    return Response(content=latest, media_type="application/json")


@router.get("/api/pipeline/dimensions", response_model=PipelineDimensionsResponse)
async def pipeline_dimensions(
    user: User = Depends(current_user),
) -> PipelineDimensionsResponse:
    payload = await asyncio.to_thread(_pipeline_dimensions_sync, user.id)
    return PipelineDimensionsResponse(**payload)


@router.get("/api/pipeline/timeseries", response_model=PipelineTimeSeriesResponse)
async def pipeline_timeseries(
    symbol: str,
    expiry: str,
    lookback_seconds: int | None = None,
    user: User = Depends(current_user),
) -> PipelineTimeSeriesResponse:
    try:
        expiry_dt = parse_datetime_tolerant(expiry)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid expiry format: {exc}") from exc

    payload = await asyncio.to_thread(
        _pipeline_timeseries_sync, user.id, symbol, expiry_dt, lookback_seconds,
    )
    if payload is None:
        results = get_pipeline_results(user.id)
        if results is None:
            raise HTTPException(status_code=404, detail="No pipeline results available")
        raise HTTPException(status_code=404, detail=f"No data for {symbol}/{expiry}")
    payload["expiry"] = expiry
    return PipelineTimeSeriesResponse(**payload)
