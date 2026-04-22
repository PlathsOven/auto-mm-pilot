"""Posit SDK exceptions."""
from __future__ import annotations


class PositError(Exception):
    """Base class for all Posit SDK errors."""


class PositAuthError(PositError):
    """The server rejected the API key."""


class PositConnectionError(PositError):
    """The SDK could not connect or lost the connection unexpectedly."""


class PositApiError(PositError):
    """The server returned a non-2xx HTTP or WS error response."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(f"HTTP {status_code}: {message}")
        self.status_code = status_code
        self.message = message


class PositValidationError(PositError):
    """A client-side argument failed validation before any network call.

    Raised in preference to letting the server return 422 — catching problems
    here gives the caller a clearer stack frame and avoids round-trips on
    obviously bad input (missing risk-dimension key_cols, incompatible
    BlockConfig flags, unparseable timestamps, etc.).
    """


class PositStreamNotRegistered(PositError):
    """A push targeted a stream not registered on this server.

    Raised synchronously before any network call when the SDK's local
    registered-streams cache doesn't include the target. Also raised after
    the fact if the server returns a 409 ``STREAM_NOT_REGISTERED`` — which
    happens when the cache is stale (e.g. after a server restart that
    wiped the in-memory registry). Either way: **no snapshot rows are sent
    to an unregistered stream**. The caller must call ``create_stream`` /
    ``upsert_stream`` before retrying.
    """

    def __init__(self, stream_name: str) -> None:
        super().__init__(
            f"Stream '{stream_name}' is not registered on the server. "
            f"Call create_stream() or upsert_stream() first."
        )
        self.stream_name = stream_name


class PositZeroEdgeWarning(UserWarning):
    """Positions came back zero after a push that omitted ``market_value``.

    Emitted via ``warnings.warn`` on the first ``positions()`` / ``get_positions``
    payload after the SDK observed a snapshot push without ``market_value`` on
    a stream. Without ``market_value``, each block's market defaults to its
    own fair → ``edge = 0`` → ``desired_pos = 0``; the stream reports healthy
    but positions silently flatline. Subclassing ``UserWarning`` means
    notebooks and plain ``python -W`` surface it by default; logs-only
    warnings are easy to miss.

    Suppress via ``warnings.simplefilter("ignore", PositZeroEdgeWarning)`` if
    you accept the consequence.
    """


class PositZeroEdgeBlocked(PositApiError):
    """The server refused the first push on a freshly-configured stream.

    Raised by ``ingest_snapshot`` / ``push_snapshot`` when the server's
    zero-edge guard fires: no row carried ``market_value``, no aggregate
    market value covered the pairs, and the call did not pass
    ``allow_zero_edge=True``. The server returns HTTP 422 with
    ``detail.code = "ZERO_EDGE_BLOCKED"``; the SDK translates to this typed
    subclass so integrators can react without string-matching on a message.

    ``missing_pairs`` lists the ``(symbol, expiry)`` pairs that lacked any
    market value source. Fix forward by setting per-row ``market_value``,
    calling ``set_market_values(...)`` for those pairs, or passing
    ``allow_zero_edge=True`` to confirm zero positions are expected.
    """

    def __init__(
        self,
        stream_name: str,
        missing_pairs: list[tuple[str, str]],
        message: str,
    ) -> None:
        super().__init__(status_code=422, message=message)
        self.stream_name = stream_name
        self.missing_pairs = missing_pairs
