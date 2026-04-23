"""Snapshot + connector-input ingestion endpoints — scoped to the calling user."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from server.api.auth.dependencies import current_user
from server.api.auth.models import User
from server.api.connector_state import get_connector_state_store
from server.api.engine_state import rerun_and_broadcast
from server.api.market_value_store import get_store as get_market_value_store
from server.api.models import (
    ConnectorInputRequest,
    ConnectorInputResponse,
    SnapshotRequest,
    SnapshotResponse,
)
from server.api.sequence_counter import get_counter as get_sequence_counter
from server.api.stream_registry import (
    StreamIsConnectorFed,
    StreamIsNotConnectorFed,
    get_stream_registry,
)
from server.api.unregistered_push_store import get_store as get_unregistered_push_store
from server.api.zero_edge_guard import ZERO_EDGE_CODE, ZeroEdgeBlocked, check_zero_edge

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/snapshots", response_model=SnapshotResponse)
async def ingest_snapshot(
    req: SnapshotRequest,
    user: User = Depends(current_user),
) -> SnapshotResponse:
    """Ingest snapshot rows for a READY stream and re-run the pipeline."""
    registry = get_stream_registry(user.id)
    rows_payload = [r.model_dump() for r in req.rows]

    reg = registry.get(req.stream_name)
    if reg is not None:
        try:
            check_zero_edge(
                reg,
                rows_payload,
                get_market_value_store(user.id),
                allow_zero_edge=req.allow_zero_edge,
            )
        except ZeroEdgeBlocked as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": ZERO_EDGE_CODE,
                    "stream": exc.stream_name,
                    "missing_pairs": [
                        {"symbol": s, "expiry": e} for s, e in exc.pairs
                    ],
                    "hint": (
                        "Add market_value per row, call PUT /api/market-values "
                        "for the missing pair(s), or set allow_zero_edge=true."
                    ),
                },
            ) from exc

    try:
        accepted = registry.ingest_snapshot(req.stream_name, rows_payload)
    except KeyError as exc:
        # Record the attempt for the UI notification surface before raising.
        # The first row is representative — same-name attempts dedupe, so
        # subsequent pushes only bump the counter + last_seen timestamp.
        if req.rows:
            get_unregistered_push_store(user.id).record(
                req.stream_name, req.rows[0].model_dump(mode="json"),
            )
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
    except StreamIsConnectorFed as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STREAM_IS_CONNECTOR_FED",
                "stream": exc.stream_name,
                "connector": exc.connector_name,
                "hint": (
                    f"Push to POST /api/streams/{exc.stream_name}/connector-input "
                    f"instead — connector '{exc.connector_name}' owns this stream."
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
        server_seq=get_sequence_counter(user.id).next(),
    )


@router.post(
    "/api/streams/{stream_name}/connector-input",
    response_model=ConnectorInputResponse,
)
async def ingest_connector_input(
    stream_name: str,
    req: ConnectorInputRequest,
    user: User = Depends(current_user),
) -> ConnectorInputResponse:
    """Push connector input rows for a connector-fed stream.

    Mirrors POST /api/snapshots for streams whose ``raw_value`` is owned
    by a server-side connector. The connector consumes the inbound rows
    and may emit zero-or-more ``SnapshotRow`` entries onto the stream
    (each one reflects an internal-state change worth re-running the
    pipeline for).
    """
    if req.stream_name != stream_name:
        raise HTTPException(
            status_code=400,
            detail=(
                f"URL stream {stream_name!r} does not match request body "
                f"stream_name {req.stream_name!r}"
            ),
        )

    registry = get_stream_registry(user.id)
    connector_store = get_connector_state_store(user.id)
    rows_payload = [r.model_dump() for r in req.rows]

    try:
        rows_accepted, rows_emitted = registry.ingest_connector_input(
            stream_name, rows_payload, connector_store,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STREAM_NOT_REGISTERED",
                "stream": stream_name,
                "hint": (
                    "Register the stream + configure with a connector_name "
                    "before pushing connector inputs."
                ),
            },
        ) from exc
    except StreamIsNotConnectorFed as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STREAM_IS_NOT_CONNECTOR_FED",
                "stream": exc.stream_name,
                "hint": (
                    f"Stream '{exc.stream_name}' is user-fed; push snapshots "
                    f"via POST /api/snapshots instead."
                ),
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    pipeline_rerun = False
    if rows_emitted > 0:
        stream_configs = registry.build_stream_configs()
        if stream_configs:
            try:
                await rerun_and_broadcast(user.id, stream_configs)
                pipeline_rerun = True
            except Exception as exc:
                log.exception("Pipeline re-run failed after connector input")
                raise HTTPException(
                    status_code=500,
                    detail=f"Rows accepted but pipeline re-run failed: {exc}",
                ) from exc

    return ConnectorInputResponse(
        stream_name=stream_name,
        rows_accepted=rows_accepted,
        rows_emitted=rows_emitted,
        pipeline_rerun=pipeline_rerun,
        server_seq=get_sequence_counter(user.id).next(),
    )
