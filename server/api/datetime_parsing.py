"""
Canonical datetime parsing helpers.

``parse_datetime_tolerant`` accepts either ISO 8601 or DDMMMYY form; every
caller that receives a user-supplied timestamp string must route through
it rather than reaching for ``datetime.fromisoformat`` directly, so the
two supported formats stay in sync across the ingest path, the pipeline,
and the LLM layer.

``coerce_datetime_fields`` normalises a list of snapshot-shaped rows:
for each row, columns known to carry a datetime (``timestamp``,
``start_timestamp``, ``expiry`` plus any matching ``key_col``) have their
string values parsed into naive UTC ``datetime`` objects. Naive = tzinfo
stripped — matches the codebase convention that naive represents UTC.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

_DATETIME_FIELDS = {"timestamp", "start_timestamp", "expiry"}


def parse_datetime_tolerant(raw: str) -> datetime:
    """Accept ISO 8601 (``2026-03-27T00:00:00``) or DDMMMYY (``27MAR26``)."""
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return datetime.strptime(raw, "%d%b%y")


def coerce_datetime_fields(
    rows: list[dict[str, Any]],
    key_cols: list[str],
) -> list[dict[str, Any]]:
    """Parse ISO-format strings into ``datetime`` objects for known datetime columns.

    All datetimes are normalised to **naive** (tzinfo stripped) to match the
    codebase convention where naive datetimes represent UTC.
    """
    dt_cols = _DATETIME_FIELDS | {k for k in key_cols if k in _DATETIME_FIELDS}
    coerced: list[dict[str, Any]] = []
    for row in rows:
        out: dict[str, Any] = {}
        for k, v in row.items():
            if k in dt_cols and isinstance(v, str):
                dt = parse_datetime_tolerant(v)
                if dt.tzinfo is not None:
                    dt = dt.replace(tzinfo=None)
                out[k] = dt
            else:
                out[k] = v
        coerced.append(out)
    return coerced
