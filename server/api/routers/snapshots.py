"""Snapshot ingestion endpoint — scoped to the calling user."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.engine_state import rerun_and_broadcast
from server.api.models import SnapshotRequest, SnapshotResponse
from server.api.stream_registry import get_stream_registry

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/snapshots", response_model=SnapshotResponse)
async def ingest_snapshot(
    req: SnapshotRequest,
    user: User = Depends(current_user),
) -> SnapshotResponse:
    """Ingest snapshot rows for a READY stream and re-run the pipeline."""
    registry = get_stream_registry(user.id)
    try:
        accepted = registry.ingest_snapshot(
            req.stream_name, [r.model_dump() for r in req.rows],
        )
    except KeyError as exc:
        # Distinguish "never registered" (409 STREAM_NOT_REGISTERED, machine-
        # readable so the SDK can translate to PositStreamNotRegistered and
        # hand-rolled clients get an actionable hint) from "registered but
        # not READY" (422, handled below) and "server error" (500).
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STREAM_NOT_REGISTERED",
                "stream": req.stream_name,
                "hint": (
                    "Register the stream with POST /api/streams first, then "
                    "POST /api/streams/{name}/configure to move it to READY."
                ),
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    stream_configs = registry.build_stream_configs()
    pipeline_rerun = False
    if stream_configs:
        try:
            await rerun_and_broadcast(user.id, stream_configs)
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
