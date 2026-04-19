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
