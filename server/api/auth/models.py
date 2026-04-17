"""
ORM models for the multi-user persistence layer.

Tables:
- ``users``         — identity + bcrypt password hash + admin flag.
- ``sessions``      — UI session tokens (opaque, in-memory on client).
- ``api_keys``      — one-per-user SDK key (separate table so rotation is row-replace).
- ``usage_events``  — analytics events (panel opens, block creates, focus, …).

All datetimes are UTC-naive — matching the existing convention elsewhere in
``server/api``. Strings only for timestamps exposed on the wire.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from server.api.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # Normalised (lowercase) username used for uniqueness + login lookup.
    username_normalised: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    # Display form preserves the casing the user chose at signup.
    username_display: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[list["Session"]] = relationship(
        "Session", back_populates="user", cascade="all, delete-orphan",
    )
    api_key: Mapped["ApiKey | None"] = relationship(
        "ApiKey", back_populates="user", cascade="all, delete-orphan", uselist=False,
    )
    events: Mapped[list["UsageEvent"]] = relationship(
        "UsageEvent", back_populates="user", cascade="all, delete-orphan",
    )


class Session(Base):
    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="sessions")


class ApiKey(Base):
    __tablename__ = "api_keys"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="api_key")


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    event_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    user: Mapped[User] = relationship("User", back_populates="events")


# Index for admin analytics queries (count events by type per user).
Index("ix_usage_events_user_type", UsageEvent.user_id, UsageEvent.event_type)
