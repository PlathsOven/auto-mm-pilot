"""Pipeline time series endpoints — scoped to the calling user."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime as _dt

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import RISK_DIMENSION_COLS, get_pipeline_results
from server.api.market_value_store import to_dict as mv_to_dict
from server.api.models import (
    PipelineDimensionsResponse,
    PipelineTimeSeriesResponse,
)
from server.api.stream_registry import parse_datetime_tolerant
from server.api.ws import get_current_tick_ts

log = logging.getLogger(__name__)

router = APIRouter()


def _pipeline_dimensions_sync(user_id: str) -> dict:
    results = get_pipeline_results(user_id)
    if results is None:
        return {"dimensions": []}

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
    return {"dimensions": dim_rows}


def _pipeline_timeseries_sync(user_id: str, symbol: str, expiry_dt: _dt) -> dict | None:
    results = get_pipeline_results(user_id)
    if results is None:
        return None

    block_var_df = results["block_var_df"]
    pos_df = results["desired_pos_df"]

    current_ts = get_current_tick_ts(user_id)

    block_var_filtered = block_var_df.filter(
        (pl.col("symbol") == symbol) & (pl.col("expiry") == expiry_dt)
    ).drop_nulls(subset=["fair"])
    pos_filtered = pos_df.filter(
        (pl.col("symbol") == symbol) & (pl.col("expiry") == expiry_dt)
    ).drop_nulls(subset=["raw_desired_position"])

    if current_ts is not None:
        bv_sliced = block_var_filtered.filter(pl.col("timestamp") >= current_ts)
        pos_sliced = pos_filtered.filter(pl.col("timestamp") >= current_ts)
        if not bv_sliced.is_empty() or not pos_sliced.is_empty():
            block_var_filtered = bv_sliced
            pos_filtered = pos_sliced

    if block_var_filtered.is_empty() and pos_filtered.is_empty():
        return None

    block_names = sorted(block_var_filtered["block_name"].unique().to_list())
    blocks = []
    for bn in block_names:
        bd = block_var_filtered.filter(pl.col("block_name") == bn).sort("timestamp")
        blocks.append({
            "blockName": bn,
            "spaceId": bd["space_id"][0] if bd.height > 0 else "",
            "aggregationLogic": bd["aggregation_logic"][0] if bd.height > 0 else "",
            "timestamps": [t.isoformat() for t in bd["timestamp"].to_list()],
            "fair": bd["fair"].to_list(),
            "marketFair": bd["market_fair"].to_list(),
            "var": bd["var"].to_list(),
        })

    pos_sorted = pos_filtered.sort("timestamp")
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
    }

    current_blocks = []
    if block_var_filtered.height > 0:
        first_ts = block_var_filtered["timestamp"].min()
        latest_block_var = block_var_filtered.filter(pl.col("timestamp") == first_ts)
        current_blocks = [
            {
                "blockName": d["block_name"],
                "spaceId": d["space_id"],
                "fair": d["fair"],
                "marketFair": d["market_fair"],
                "var": d["var"],
            }
            for d in latest_block_var.select(
                "block_name", "space_id", "fair", "market_fair", "var",
            ).to_dicts()
        ]

    current_agg: dict | None = None
    if pos_sorted.height > 0:
        last = pos_sorted.row(0, named=True)
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
        "aggregated": aggregated,
        "currentDecomposition": {
            "blocks": current_blocks,
            "aggregated": current_agg,
            "aggregateMarketValue": agg_mv,
        },
    }


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
    user: User = Depends(current_user),
) -> PipelineTimeSeriesResponse:
    try:
        expiry_dt = parse_datetime_tolerant(expiry)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid expiry format: {exc}") from exc

    payload = await asyncio.to_thread(_pipeline_timeseries_sync, user.id, symbol, expiry_dt)
    if payload is None:
        results = get_pipeline_results(user.id)
        if results is None:
            raise HTTPException(status_code=404, detail="No pipeline results available")
        raise HTTPException(status_code=404, detail=f"No data for {symbol}/{expiry}")
    payload["expiry"] = expiry
    return PipelineTimeSeriesResponse(**payload)
