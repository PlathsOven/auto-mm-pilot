"""
FastAPI dependency helpers: ``current_user`` and ``current_admin``.

Routers declare::

    user: User = Depends(current_user)

and every mutable registry call downstream uses ``user.id`` for scoping.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from server.api.auth.models import User
from server.api.auth.tokens import resolve_user_from_request


def current_user(request: Request) -> User:
    """Resolve the caller to a ``User`` or raise 401."""
    user = resolve_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def current_admin(user: User = Depends(current_user)) -> User:
    """Same as ``current_user`` but additionally enforces ``is_admin``."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
