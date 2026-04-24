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
from server.api.config import VOL_POINTS_SCALE
from server.api.engine_state import (
    RISK_DIMENSION_COLS,
    get_pipeline_results,
    get_position_history,
)
from server.api.expiry import canonical_expiry_key
from server.api.market_value_store import to_dict as mv_to_dict
from server.api.models import (
    PipelineContributionsResponse,
    PipelineDimensionsResponse,
    PipelineTimeSeriesResponse,
    ServerPayload,
)
from server.api.datetime_parsing import parse_datetime_tolerant
from server.api.ws import get_current_tick_ts, get_latest_payload

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


def _build_block_timeseries(
    block_var_filtered: pl.DataFrame,
    start_ts_map: dict[tuple[str, str], _dt | None],
) -> tuple[list[dict], list[str]]:
    """Pivot per-block fair/var rows onto a shared timestamp axis.

    Returns ``(blocks, block_timestamps)`` where ``blocks`` is a list of
    wire-shape dicts — one per distinct block — each carrying ``fair`` /
    ``var`` value arrays aligned index-wise with ``block_timestamps``.
    Missing ticks for a block are filled with ``None`` so the chart can use
    one shared x-axis for every block.
    """
    if block_var_filtered.is_empty():
        return [], []

    block_names = sorted(block_var_filtered["block_name"].unique().to_list())
    block_axis = (
        block_var_filtered.select("timestamp").unique().sort("timestamp")["timestamp"].to_list()
    )
    block_timestamps = [t.isoformat() for t in block_axis]
    block_axis_index = {t: i for i, t in enumerate(block_axis)}
    has_stream_col = "stream_name" in block_var_filtered.columns

    blocks: list[dict] = []
    for bn in block_names:
        bd = block_var_filtered.filter(pl.col("block_name") == bn).sort("timestamp")
        fair_arr: list[float | None] = [None] * len(block_axis)
        var_arr: list[float | None] = [None] * len(block_axis)
        for ts, fair_val, var_val in bd.select("timestamp", "fair", "var").rows():
            idx = block_axis_index.get(ts)
            if idx is None:
                continue
            fair_arr[idx] = fair_val
            var_arr[idx] = var_val
        stream_name_val = bd["stream_name"][0] if bd.height > 0 and has_stream_col else ""
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

    return blocks, block_timestamps


def _slice_timeseries_frames(
    block_series_df: pl.DataFrame,
    pos_df: pl.DataFrame,
    symbol: str,
    expiry_date: _dt,
    slice_ts: _dt,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Filter + slice the pipeline frames for a single (symbol, expiry).

    Independent slicing: positions are backward-looking (rerun_time → now) so
    the trader sees how the position evolved; block fair/variance are
    forward-looking (now → expiry decay curves). ``desired_pos_df`` is the
    rerun's forward projection; rows with ``timestamp <= slice_ts`` are the
    already-revealed past. If either slice is empty, fall back to the full
    filtered frame so single-rerun cases still render.
    """
    # Cast expiry to date so a DataFrame with either pl.Date or pl.Datetime
    # expiry columns matches — different stream-config paths emit either.
    block_var_filtered = block_series_df.filter(
        (pl.col("symbol") == symbol)
        & (pl.col("expiry").cast(pl.Date) == expiry_date)
    ).drop_nulls(subset=["fair"])
    pos_filtered = pos_df.filter(
        (pl.col("symbol") == symbol)
        & (pl.col("expiry").cast(pl.Date) == expiry_date)
    ).drop_nulls(subset=["raw_desired_position"])

    bv_sliced = block_var_filtered.filter(pl.col("timestamp") >= slice_ts)
    if not bv_sliced.is_empty():
        block_var_filtered = bv_sliced
    pos_sliced = pos_filtered.filter(pl.col("timestamp") <= slice_ts)
    if not pos_sliced.is_empty():
        pos_filtered = pos_sliced
    return block_var_filtered, pos_filtered


def _per_space_from_history(history: list) -> dict[str, dict[str, list[float]]]:
    """Reconstruct per-space time series from a list of ``PositionHistoryPoint``.

    Each point carries a per-space dict captured at its rerun moment. A
    space that appears in one rerun but not another (e.g. a new stream was
    added) shows up as 0.0 for points that predate it — the stacked chart
    treats the missing space as "not contributing yet". ``getattr`` guards
    against older instances that predate the ``per_space`` field surviving
    across a hot reload.
    """
    if not history:
        return {}
    space_ids: set[str] = set()
    for p in history:
        space_ids.update(getattr(p, "per_space", {}).keys())
    per_space: dict[str, dict[str, list[float]]] = {}
    for sid in sorted(space_ids):
        fair_arr: list[float] = []
        var_arr: list[float] = []
        market_arr: list[float] = []
        for p in history:
            entry = getattr(p, "per_space", {}).get(sid)
            if entry is None:
                fair_arr.append(0.0); var_arr.append(0.0); market_arr.append(0.0)
            else:
                fair_arr.append(entry[0]); var_arr.append(entry[1]); market_arr.append(entry[2])
        per_space[sid] = {"fair": fair_arr, "var": var_arr, "marketFair": market_arr}
    return per_space


def _aggregated_from_history(
    user_id: str, symbol: str, expiry_dt: _dt,
    slice_ts: _dt, lookback_seconds: int,
) -> dict:
    """Read from the per-dimension ring buffer for a true historical window.

    ``desired_pos_df`` is wiped at every rerun, so any lookback beyond the
    last rerun must come from the persistent buffer that accumulates across
    reruns (see ``server/api/position_history``). Per-space calc-space
    values are captured at each rerun alongside the aggregate, so the
    decomposition view works across the full historical window too.
    """
    history = get_position_history(user_id).get_range(
        symbol=symbol,
        expiry=expiry_dt.isoformat(),
        since=slice_ts - timedelta(seconds=lookback_seconds),
    )
    return {
        "timestamps": [p.timestamp.isoformat() for p in history],
        "totalFair": [p.total_fair for p in history],
        "smoothedTotalFair": [p.smoothed_total_fair for p in history],
        "totalMarketFair": [p.total_market_fair for p in history],
        "smoothedTotalMarketFair": [p.smoothed_total_market_fair for p in history],
        "edge": [p.edge for p in history],
        "smoothedEdge": [p.smoothed_edge for p in history],
        "var": [p.var for p in history],
        "smoothedVar": [p.smoothed_var for p in history],
        "rawDesiredPosition": [p.raw_desired_position for p in history],
        "smoothedDesiredPosition": [p.smoothed_desired_position for p in history],
        "marketVol": [p.market_vol for p in history],
        "perSpace": _per_space_from_history(history),
    }


def _per_space_from_projection(
    space_series_df: pl.DataFrame,
    symbol: str,
    expiry_date: _dt,
    timestamps: list[_dt],
) -> dict[str, dict[str, list[float]]]:
    """Pivot ``space_series_df`` to per-space fair/var/market arrays aligned
    with the pos-sorted timestamp order.

    Returns a dict keyed by ``space_id``; each value is
    ``{"fair": [...], "var": [...], "marketFair": [...]}`` in calc space
    (variance-linear). Missing ticks for a space are filled with 0 so the
    chart's stacked view stays continuous.
    """
    if space_series_df.is_empty() or not timestamps:
        return {}
    filtered = space_series_df.filter(
        (pl.col("symbol") == symbol)
        & (pl.col("expiry").cast(pl.Date) == expiry_date)
        & (pl.col("timestamp").is_in(timestamps))
    )
    if filtered.is_empty():
        return {}
    ts_index = {t: i for i, t in enumerate(timestamps)}
    per_space: dict[str, dict[str, list[float]]] = {}
    for space_id in sorted(filtered["space_id"].unique().to_list()):
        sd = filtered.filter(pl.col("space_id") == space_id)
        fair_arr = [0.0] * len(timestamps)
        var_arr = [0.0] * len(timestamps)
        market_arr = [0.0] * len(timestamps)
        for ts, fair, var, mkt in sd.select(
            "timestamp", "space_fair", "space_var", "space_market_fair",
        ).rows():
            idx = ts_index.get(ts)
            if idx is None:
                continue
            fair_arr[idx] = float(fair) if fair is not None else 0.0
            var_arr[idx] = float(var) if var is not None else 0.0
            market_arr[idx] = float(mkt) if mkt is not None else 0.0
        per_space[space_id] = {
            "fair": fair_arr,
            "var": var_arr,
            "marketFair": market_arr,
        }
    return per_space


def _aggregated_from_projection(
    pos_sorted: pl.DataFrame,
    current_market_vol_vp: float,
    space_series_df: pl.DataFrame,
    symbol: str,
    expiry_date: _dt,
) -> dict:
    """Build the aggregated payload from the live forward projection.

    The projection has no historical market-vol signal, so the live user-set
    value is broadcast across every timestamp in the window. ``perSpace`` is
    derived from the same forward grid as ``pos_sorted`` so the
    decomposition chart stacks cleanly.
    """
    timestamps = pos_sorted["timestamp"].to_list()
    return {
        "timestamps": [t.isoformat() for t in timestamps],
        "totalFair": pos_sorted["total_fair"].to_list(),
        "smoothedTotalFair": pos_sorted["smoothed_total_fair"].to_list(),
        "totalMarketFair": pos_sorted["total_market_fair"].to_list(),
        "smoothedTotalMarketFair": pos_sorted["smoothed_total_market_fair"].to_list(),
        "edge": pos_sorted["edge"].to_list(),
        "smoothedEdge": pos_sorted["smoothed_edge"].to_list(),
        "var": pos_sorted["var"].to_list(),
        "smoothedVar": pos_sorted["smoothed_var"].to_list(),
        "rawDesiredPosition": pos_sorted["raw_desired_position"].to_list(),
        "smoothedDesiredPosition": pos_sorted["smoothed_desired_position"].to_list(),
        "marketVol": [current_market_vol_vp] * len(timestamps),
        "perSpace": _per_space_from_projection(
            space_series_df, symbol, expiry_date, timestamps,
        ),
    }


def _current_decomposition(
    block_var_filtered: pl.DataFrame,
    pos_sorted: pl.DataFrame,
    start_ts_map: dict[tuple[str, str], _dt | None],
) -> tuple[list[dict], dict | None]:
    """Pick the "now" snapshot — per-block fair/var at the first revealed
    timestamp, plus the most recent aggregated row."""
    current_blocks: list[dict] = []
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
        # pos_sorted is ascending; "now" is the most recent revealed row.
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
    return current_blocks, current_agg


def _pipeline_timeseries_sync(
    user_id: str,
    symbol: str,
    expiry_dt: _dt,
    lookback_seconds: int | None = None,
) -> dict | None:
    results = get_pipeline_results(user_id)
    if results is None:
        return None

    block_series_df = results["block_series_df"]
    space_series_df = results["space_series_df"]
    pos_df = results["desired_pos_df"]
    blocks_df = results["blocks_df"]

    # (block_name, stream_name) → start_timestamp lookup. ``block_series_df``
    # doesn't carry ``start_timestamp``; source it from the flat ``blocks_df``.
    start_ts_map: dict[tuple[str, str], _dt | None] = {}
    if {"block_name", "stream_name", "start_timestamp"} <= set(blocks_df.columns):
        for r in blocks_df.select("block_name", "stream_name", "start_timestamp").to_dicts():
            start_ts_map[(r["block_name"], r["stream_name"])] = r.get("start_timestamp")

    current_ts = get_current_tick_ts(user_id)
    # Past-vs-future anchor: prefer the WS ticker's ``current_tick_ts`` (which
    # advances through ``desired_pos_df``'s forward grid as real time passes);
    # fall back to wall-clock UTC on a fresh request before the ticker has set
    # state.
    slice_ts = current_ts if current_ts is not None else _dt.now(timezone.utc).replace(tzinfo=None)

    block_var_filtered, pos_filtered = _slice_timeseries_frames(
        block_series_df, pos_df, symbol, expiry_dt.date(), slice_ts,
    )
    log.info(
        "pipeline timeseries: user=%s sym=%s exp=%s slice_ts=%s current_ts=%s pos=%d",
        user_id, symbol, expiry_dt.date(), slice_ts, current_ts, pos_filtered.height,
    )

    if block_var_filtered.is_empty() and pos_filtered.is_empty():
        return None

    blocks, block_timestamps = _build_block_timeseries(block_var_filtered, start_ts_map)
    pos_sorted = pos_filtered.sort("timestamp")

    # Current user-entered aggregate market vol, scaled to vol points.
    mv_store = mv_to_dict(user_id)
    mv_key = (symbol, canonical_expiry_key(expiry_dt))
    current_market_vol_vp = mv_store.get(mv_key, 0.0) * VOL_POINTS_SCALE

    if lookback_seconds is not None and lookback_seconds > 0:
        aggregated = _aggregated_from_history(
            user_id, symbol, expiry_dt, slice_ts, lookback_seconds,
        )
    else:
        aggregated = _aggregated_from_projection(
            pos_sorted, current_market_vol_vp,
            space_series_df, symbol, expiry_dt.date(),
        )

    current_blocks, current_agg = _current_decomposition(
        block_var_filtered, pos_sorted, start_ts_map,
    )

    agg_mv_entry = mv_store.get((symbol, expiry_dt.isoformat()))
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


def _pipeline_contributions_sync(
    user_id: str,
    symbol: str,
    expiry_dt: _dt,
    lookback_seconds: int,
) -> dict | None:
    """Build the per-space contributions payload.

    Historical segment: ring-buffer points with ``timestamp >= slice_ts −
    lookback``. Forward segment: ``space_series_df`` rows with
    ``timestamp >= slice_ts`` on the current rerun's forward grid. The two
    segments share calc-space units (variance-linear) and stack additively
    across ``space_id`` — see ``docs/product.md`` §"How Blocks Aggregate"
    and ``server/core/pipeline.py`` Stage D.2.
    """
    results = get_pipeline_results(user_id)
    if results is None:
        return None

    current_ts = get_current_tick_ts(user_id)
    slice_ts = current_ts if current_ts is not None else _dt.now(timezone.utc).replace(tzinfo=None)

    history = get_position_history(user_id).get_range(
        symbol=symbol,
        expiry=expiry_dt.isoformat(),
        since=slice_ts - timedelta(seconds=lookback_seconds),
    )

    space_series_df = results["space_series_df"]
    forward_df = (
        space_series_df.filter(
            (pl.col("symbol") == symbol)
            & (pl.col("expiry").cast(pl.Date) == expiry_dt.date())
            & (pl.col("timestamp") >= slice_ts)
        )
        if not space_series_df.is_empty()
        else space_series_df
    )

    # Collect every space_id that appears in either segment — spaces that
    # only exist in history (e.g. a stream was dropped) or only in the
    # forward projection (e.g. a stream was just added) still get a row,
    # filled with 0 on the side where they're absent.
    space_ids: set[str] = set()
    for p in history:
        space_ids.update(p.per_space.keys())
    if not forward_df.is_empty():
        space_ids.update(forward_df["space_id"].unique().to_list())

    if not history and forward_df.is_empty():
        return None

    # ----- historical segment (one entry per rerun) -----
    hist_timestamps: list[_dt] = [p.timestamp for p in history]
    hist_per_space: dict[str, dict[str, list[float]]] = {
        sid: {"fair": [], "var": [], "market_fair": []} for sid in space_ids
    }
    # A ring-buffer point can store an empty ``per_space`` dict for a dim
    # whose ``desired_pos_df`` row was retained (so ``total_fair`` was
    # captured fine) but whose ``space_series_df`` slice at the rerun
    # moment didn't yield a row for this dim — see
    # ``build_per_space_at_tick`` in ``position_history.py``. The old
    # zero-default here produced V-shape blips to 0 in the Contributions
    # chart while the Metric tab's aggregate ``Fair`` stayed smooth.
    # Forward-fill from the last non-empty entry so the stacked-area view
    # stays continuous without fabricating contributions. Seed with the
    # first non-empty entry so leading empty points don't read as 0.
    last_per_space: dict[str, tuple[float, float, float]] = {}
    for p in history:
        if p.per_space:
            last_per_space = dict(p.per_space)
            break
    for p in history:
        src = p.per_space if p.per_space else last_per_space
        for sid in space_ids:
            entry = src.get(sid)
            if entry is None:
                hist_per_space[sid]["fair"].append(0.0)
                hist_per_space[sid]["var"].append(0.0)
                hist_per_space[sid]["market_fair"].append(0.0)
            else:
                hist_per_space[sid]["fair"].append(float(entry[0]))
                hist_per_space[sid]["var"].append(float(entry[1]))
                hist_per_space[sid]["market_fair"].append(float(entry[2]))
        if p.per_space:
            # Replace (don't merge) so a space that has disappeared from
            # the rerun's per_space stops being carried forward.
            last_per_space = dict(p.per_space)

    # ----- forward segment (forward grid, dense in space_ids that have rows) -----
    if forward_df.is_empty():
        fwd_timestamps: list[_dt] = []
        fwd_per_space: dict[str, dict[str, list[float]]] = {
            sid: {"fair": [], "var": [], "market_fair": []} for sid in space_ids
        }
    else:
        fwd_timestamps = (
            forward_df.select("timestamp").unique().sort("timestamp")["timestamp"].to_list()
        )
        ts_index = {t: i for i, t in enumerate(fwd_timestamps)}
        fwd_per_space = {
            sid: {
                "fair": [0.0] * len(fwd_timestamps),
                "var": [0.0] * len(fwd_timestamps),
                "market_fair": [0.0] * len(fwd_timestamps),
            }
            for sid in space_ids
        }
        for ts, sid, fair, var, mkt in forward_df.select(
            "timestamp", "space_id", "space_fair", "space_var", "space_market_fair",
        ).rows():
            idx = ts_index.get(ts)
            if idx is None or sid not in fwd_per_space:
                continue
            fwd_per_space[sid]["fair"][idx] = float(fair) if fair is not None else 0.0
            fwd_per_space[sid]["var"][idx] = float(var) if var is not None else 0.0
            fwd_per_space[sid]["market_fair"][idx] = float(mkt) if mkt is not None else 0.0

    combined_timestamps = [t.isoformat() for t in (hist_timestamps + fwd_timestamps)]
    per_space_out: dict[str, dict[str, list[float]]] = {}
    for sid in sorted(space_ids):
        per_space_out[sid] = {
            "fair": hist_per_space[sid]["fair"] + fwd_per_space[sid]["fair"],
            "var": hist_per_space[sid]["var"] + fwd_per_space[sid]["var"],
            "market_fair": hist_per_space[sid]["market_fair"] + fwd_per_space[sid]["market_fair"],
        }

    return {
        "symbol": symbol,
        "current_ts": slice_ts.isoformat() if slice_ts is not None else None,
        "timestamps": combined_timestamps,
        "per_space": per_space_out,
    }


# Default lookback when the client omits ``lookback_seconds`` — one hour is
# long enough to see a few reruns on typical cadence without pulling huge
# windows on fresh accounts.
_DEFAULT_CONTRIBUTIONS_LOOKBACK_SECONDS: int = 60 * 60


@router.get("/api/pipeline/contributions", response_model=PipelineContributionsResponse)
async def pipeline_contributions(
    symbol: str,
    expiry: str,
    lookback_seconds: int | None = None,
    user: User = Depends(current_user),
) -> PipelineContributionsResponse:
    """Per-space calc-space contributions over ``now − lookback → expiry``.

    Concatenates the ring-buffer history with the current rerun's forward
    projection and emits a single unified timestamp axis plus a
    ``current_ts`` seam marker. See ``_pipeline_contributions_sync`` for
    the data sources.
    """
    try:
        expiry_dt = parse_datetime_tolerant(expiry)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid expiry format: {exc}") from exc

    effective_lookback = (
        lookback_seconds
        if lookback_seconds is not None and lookback_seconds > 0
        else _DEFAULT_CONTRIBUTIONS_LOOKBACK_SECONDS
    )

    payload = await asyncio.to_thread(
        _pipeline_contributions_sync, user.id, symbol, expiry_dt, effective_lookback,
    )
    if payload is None:
        results = get_pipeline_results(user.id)
        if results is None:
            raise HTTPException(status_code=404, detail="No pipeline results available")
        raise HTTPException(status_code=404, detail=f"No data for {symbol}/{expiry}")
    payload["expiry"] = expiry
    return PipelineContributionsResponse(**payload)
