"""
Auth endpoints — signup, login, logout.

Sessions are opaque 32-byte tokens stored in ``sessions``; clients keep them
in memory only (re-login on every app launch). API keys are minted per user
on signup and surfaced via the Account page.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from server.api.auth.dependencies import current_user
from server.api.auth.models import ApiKey, Session as SessionRow, User
from server.api.auth.passwords import hash_password, verify_password
from server.api.auth.tokens import (
    generate_api_key,
    generate_session_token,
    invalidate_session_token,
)
from server.api.config import POSIT_ADMIN_USERNAMES, SESSION_TTL_HOURS
from server.api.db import SessionLocal
from server.api.models import LoginRequest, LoginResponse, SignupRequest, UserPublic

log = logging.getLogger(__name__)

router = APIRouter()


def _admin_usernames() -> set[str]:
    return {u.strip().lower() for u in POSIT_ADMIN_USERNAMES.split(",") if u.strip()}


def _to_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        username=user.username_display,
        created_at=user.created_at,
        is_admin=user.is_admin,
    )


def _extract_session_token(request: Request) -> str | None:
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip() or None
    return None


# ---------------------------------------------------------------------------
# Sync helpers (run via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _signup_sync(username: str, password: str) -> tuple[User, str]:
    """Create a new user + session. Returns (user, session_token).

    Raises ``ValueError('duplicate')`` if the username is already taken.
    """
    now = datetime.utcnow()
    normalised = username.lower()
    display = username

    with SessionLocal() as db:
        existing = db.execute(
            select(User).where(User.username_normalised == normalised)
        ).scalar_one_or_none()
        if existing is not None:
            raise ValueError("duplicate")

        admin_set = _admin_usernames()
        user = User(
            id=str(uuid.uuid4()),
            username_normalised=normalised,
            username_display=display,
            password_hash=hash_password(password),
            is_admin=normalised in admin_set,
            created_at=now,
            last_login_at=now,
        )
        db.add(user)

        api_key_row = ApiKey(
            key=generate_api_key(),
            user_id=user.id,
            created_at=now,
        )
        db.add(api_key_row)

        token = generate_session_token()
        db.add(SessionRow(
            token=token,
            user_id=user.id,
            created_at=now,
            expires_at=now + timedelta(hours=SESSION_TTL_HOURS),
        ))
        db.commit()
        db.refresh(user)
        return user, token


def _login_sync(username: str, password: str) -> tuple[User, str] | None:
    """Verify credentials, refresh last_login_at, issue a new session token."""
    now = datetime.utcnow()
    normalised = username.lower()

    with SessionLocal() as db:
        user = db.execute(
            select(User).where(User.username_normalised == normalised)
        ).scalar_one_or_none()
        if user is None or not verify_password(password, user.password_hash):
            return None

        user.last_login_at = now
        token = generate_session_token()
        db.add(SessionRow(
            token=token,
            user_id=user.id,
            created_at=now,
            expires_at=now + timedelta(hours=SESSION_TTL_HOURS),
        ))
        db.commit()
        db.refresh(user)
        return user, token


def _logout_sync(token: str) -> None:
    with SessionLocal() as db:
        row = db.execute(select(SessionRow).where(SessionRow.token == token)).scalar_one_or_none()
        if row is not None:
            db.delete(row)
            db.commit()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/auth/signup", response_model=LoginResponse, status_code=201)
async def signup(req: SignupRequest) -> LoginResponse:
    try:
        user, token = await asyncio.to_thread(_signup_sync, req.username, req.password)
    except ValueError as exc:
        if str(exc) == "duplicate":
            raise HTTPException(status_code=409, detail="Username already taken") from exc
        raise
    log.info("User signed up: %s", user.username_display)
    return LoginResponse(session_token=token, user=_to_public(user))


@router.post("/api/auth/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    result = await asyncio.to_thread(_login_sync, req.username, req.password)
    if result is None:
        # Intentionally generic — no user-enumeration leak.
        raise HTTPException(status_code=401, detail="Invalid username or password")
    user, token = result
    log.info("User logged in: %s", user.username_display)
    return LoginResponse(session_token=token, user=_to_public(user))


@router.post("/api/auth/logout", status_code=204)
async def logout(
    request: Request,
    _user: User = Depends(current_user),
) -> None:
    token = _extract_session_token(request)
    if token is not None:
        invalidate_session_token(token)
        await asyncio.to_thread(_logout_sync, token)
