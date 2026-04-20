"""Canonical expiry-key normalisation.

Expiry flows through multiple layers (feeder → Pydantic → market-value
store → Polars pipeline → WS serializer) and each layer historically did
its own ad-hoc ``.isoformat()`` / ``str()`` / ``strftime()``. Any mismatch
silently breaks dict-key lookups across the boundary — the store holds
``"2026-03-28T00:00:00+00:00"`` while the pipeline looks up
``"2026-03-28T00:00:00"`` and the match fails.

Canonical form: **naive-ISO midnight** — ``"YYYY-MM-DDTHH:MM:SS"`` with no
timezone suffix and no microseconds. Matches what ``datetime.isoformat()``
returns on the pipeline's naive ``pl.Datetime`` expiry column via
``to_dicts()``.
"""

from __future__ import annotations

from datetime import date, datetime


def canonical_expiry_key(expiry: object) -> str:
    """Normalise any expiry representation to the canonical naive-ISO key.

    Accepts:
      * ``datetime`` — tz-aware or naive; tz stripped, microseconds dropped.
      * ``date`` — promoted to midnight naive datetime.
      * ``str`` — parsed as ISO (with or without timezone), or DDMMMYY
        (e.g. ``"27MAR26"``). Unrecognised strings pass through unchanged
        so legacy keys aren't silently rewritten.

    Raises ``TypeError`` for other types — callers should always hand in one
    of the three above.
    """
    if isinstance(expiry, datetime):
        return expiry.replace(tzinfo=None, microsecond=0).isoformat()
    if isinstance(expiry, date):
        return datetime(expiry.year, expiry.month, expiry.day).isoformat()
    if isinstance(expiry, str):
        # Try ISO first (covers tz-aware ``+00:00`` suffix and naive forms).
        try:
            return canonical_expiry_key(datetime.fromisoformat(expiry))
        except ValueError:
            pass
        # Try DDMMMYY — the SDK test's documented short form.
        try:
            return canonical_expiry_key(datetime.strptime(expiry, "%d%b%y"))
        except ValueError:
            pass
        # Date-only ISO without a time component is already handled by
        # ``fromisoformat`` on 3.11+; fall back for safety.
        try:
            return canonical_expiry_key(date.fromisoformat(expiry))
        except ValueError:
            pass
        return expiry  # unparseable — preserve verbatim
    raise TypeError(f"Cannot canonicalise expiry of type {type(expiry).__name__}")
