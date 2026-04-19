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
