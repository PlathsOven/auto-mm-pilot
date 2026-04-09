"""Snapshot ingestion endpoint."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from server.api.engine_state import rerun_and_broadcast
from server.api.models import SnapshotRequest, SnapshotResponse
from server.api.stream_registry import get_stream_registry

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/snapshots", response_model=SnapshotResponse)
async def ingest_snapshot(req: SnapshotRequest) -> SnapshotResponse:
    """Ingest snapshot rows for a READY stream and re-run the pipeline."""
    registry = get_stream_registry()
    try:
        accepted = registry.ingest_snapshot(
            req.stream_name, [r.model_dump() for r in req.rows],
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Re-run pipeline with all available streams
    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await rerun_and_broadcast(stream_configs)
            pipeline_rerun = True
        except Exception as exc:
            log.exception("Pipeline re-run failed after snapshot ingestion")
            raise HTTPException(
                status_code=500,
                detail=f"Snapshot accepted but pipeline re-run failed: {exc}",
            ) from exc

    return SnapshotResponse(
        stream_name=req.stream_name,
        rows_accepted=accepted,
        pipeline_rerun=pipeline_rerun,
    )
