"""
Shared manual-block apply flow.

Canonical "bring this stream into existence" primitive used by both the
``POST /api/blocks`` (+ Manual block button) and ``POST /api/blocks/commit``
(Build-orchestrator confirm) paths. Consolidates the
``create → configure → ingest_snapshot → manual_blocks.mark →
rerun_and_broadcast`` sequence with consistent rollback semantics so a
bug fix in that sequence lands in one place rather than two.

Callers build the runtime ``BlockConfig`` (so validation errors on the
dataclass invariants surface BEFORE any registry mutation) and pass
already-serialised ``snapshot_rows`` dicts. When ``snapshot_rows`` is
empty the helper skips the ingest + manual-block mark, covering the
``create_stream`` action as well — the downstream pipeline rerun still
runs, making this a single "bring this stream live" entry point
regardless of whether a snapshot comes with it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from server.api.engine_state import rerun_and_broadcast
from server.api.stream_registry import get_stream_registry
from server.core.config import BlockConfig

log = logging.getLogger(__name__)


async def apply_manual_block(
    *,
    user_id: str,
    stream_name: str,
    key_cols: list[str],
    scale: float,
    offset: float,
    exponent: float,
    block: BlockConfig,
    snapshot_rows: list[dict[str, Any]],
    applies_to: list[tuple[str, str]] | None = None,
    space_id_override: str | None = None,
) -> None:
    """Register, configure, optionally ingest, mark, rerun — all-or-nothing.

    Raises ``HTTPException`` on any step that fails. Rolls back the
    registry entry (``registry.delete``) before raising so the server's
    in-memory state never contains a half-registered stream.

    Status-code mapping:
    - 409 — ``registry.create`` raised ``ValueError`` (name collision).
    - 404 — ``registry.configure`` raised ``KeyError``.
    - 422 — ``registry.ingest_snapshot`` raised ``KeyError`` / ``ValueError``.
    - 400 — ``rerun_and_broadcast`` raised ``ValueError``
      (applies_to + other ``build_blocks_df`` validation errors).
    - 500 — ``rerun_and_broadcast`` raised anything else.
    """
    registry = get_stream_registry(user_id)

    try:
        registry.create(stream_name, key_cols)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        registry.configure(
            stream_name,
            scale=scale,
            offset=offset,
            exponent=exponent,
            block=block,
            applies_to=applies_to,
        )
    except KeyError as exc:
        # ``create`` succeeded so the stream is registered. Rolling back
        # keeps the registry self-consistent if configure loses the race.
        try:
            registry.delete(stream_name)
        except KeyError:
            pass
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if snapshot_rows:
        try:
            registry.ingest_snapshot(stream_name, snapshot_rows)
        except (KeyError, ValueError) as exc:
            try:
                registry.delete(stream_name)
            except KeyError:
                pass
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        if space_id_override:
            reg = registry.get(stream_name)
            if reg:
                reg.space_id_override = space_id_override

        # UTC-naive ISO matches the server-wide datetime convention
        # (see server/api/auth/models.py + llm/models.py); both callers
        # previously emitted different formats here.
        marker_ts = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        registry.manual_blocks.mark(stream_name, marker_ts)

    stream_configs = registry.build_stream_configs()
    if not stream_configs:
        return

    try:
        await rerun_and_broadcast(user_id, stream_configs)
    except ValueError as exc:
        try:
            registry.delete(stream_name)
        except KeyError:
            pass
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log.exception(
            "Pipeline re-run failed after manual block apply for stream=%s",
            stream_name,
        )
        try:
            registry.delete(stream_name)
        except KeyError:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"Block registered but pipeline re-run failed: {exc}",
        ) from exc
