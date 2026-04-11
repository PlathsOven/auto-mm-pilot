"""Pipeline time series endpoints (read-only, for charting)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime as _dt

import polars as pl
from fastapi import APIRouter, HTTPException

from server.api.engine_state import get_pipeline_results, RISK_DIMENSION_COLS
from server.api.ws import get_current_tick_ts

log = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Sync helpers (run via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _pipeline_dimensions_sync() -> dict:
    """Sync helper — runs in a worker thread via ``asyncio.to_thread``."""
    results = get_pipeline_results()
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


def _parse_expiry(raw: str) -> _dt:
    """Accept ISO 8601 (``2026-01-02``) or canonical DDMMMYY (``02JAN26``).

    The WebSocket payload normalises expiries to DDMMMYY via ``_format_expiry``
    in ``ws.py``, so the client often forwards that format verbatim.  This
    helper accepts both so callers never have to guess which one the server
    wants.
    """
    try:
        return _dt.fromisoformat(raw)
    except ValueError:
        return _dt.strptime(raw, "%d%b%y")


def _pipeline_timeseries_sync(symbol: str, expiry_dt: _dt) -> dict | None:
    """Sync helper — runs in a worker thread via ``asyncio.to_thread``.

    Returns ``None`` if no data exists for the requested dimension; the
    async wrapper translates that into a 404.  Returns the dict payload
    otherwise.
    """
    results = get_pipeline_results()
    if results is None:
        return None

    block_var_df = results["block_var_df"]
    pos_df = results["desired_pos_df"]

    # Slice to current tick if the ticker is running
    current_ts = get_current_tick_ts()

    # Filter to requested dimension
    block_var_filtered = block_var_df.filter(
        (pl.col("symbol") == symbol) & (pl.col("expiry") == expiry_dt)
    ).drop_nulls(subset=["fair"])
    pos_filtered = pos_df.filter(
        (pl.col("symbol") == symbol) & (pl.col("expiry") == expiry_dt)
    ).drop_nulls(subset=["raw_desired_position"])

    if current_ts is not None:
        bv_sliced = block_var_filtered.filter(pl.col("timestamp") >= current_ts)
        pos_sliced = pos_filtered.filter(pl.col("timestamp") >= current_ts)
        # If the ticker has advanced past this instrument's last timestamp,
        # fall back to the full (unfiltered) data instead of returning 404.
        if not bv_sliced.is_empty() or not pos_sliced.is_empty():
            block_var_filtered = bv_sliced
            pos_filtered = pos_sliced

    if block_var_filtered.is_empty() and pos_filtered.is_empty():
        return None

    # Block-level time series (camelCase for the wire)
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

    # Aggregated time series (camelCase for the wire)
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

    # Current decomposition (first timestamp = current tick, camelCase)
    current_blocks = []
    if block_var_filtered.height > 0:
        first_ts = block_var_filtered["timestamp"].min()
        latest_block_var = block_var_filtered.filter(pl.col("timestamp") == first_ts)
        for row in latest_block_var.iter_rows(named=True):
            current_blocks.append({
                "blockName": row["block_name"],
                "spaceId": row["space_id"],
                "fair": row["fair"],
                "marketFair": row["market_fair"],
                "var": row["var"],
            })

    current_agg = {}
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

    return {
        "symbol": symbol,
        "blocks": blocks,
        "aggregated": aggregated,
        "currentDecomposition": {
            "blocks": current_blocks,
            "aggregated": current_agg,
        },
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/pipeline/dimensions")
async def pipeline_dimensions() -> dict:
    """Return available (symbol, expiry) pairs from the current pipeline run."""
    return await asyncio.to_thread(_pipeline_dimensions_sync)


@router.get("/api/pipeline/timeseries")
async def pipeline_timeseries(symbol: str, expiry: str) -> dict:
    """Return full block-level and aggregated time series for a symbol/expiry."""
    # Parse expiry string (tolerant of both ISO and DDMMMYY)
    try:
        expiry_dt = _parse_expiry(expiry)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid expiry format: {exc}") from exc

    payload = await asyncio.to_thread(_pipeline_timeseries_sync, symbol, expiry_dt)
    if payload is None:
        results = get_pipeline_results()
        if results is None:
            raise HTTPException(status_code=404, detail="No pipeline results available")
        raise HTTPException(status_code=404, detail=f"No data for {symbol}/{expiry}")
    payload["expiry"] = expiry
    return payload
