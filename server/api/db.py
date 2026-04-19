"""
SQLAlchemy engine + session factory for the multi-user persistence layer.

Backend: SQLite by default (persistent volume on Railway). Swap via
``DATABASE_URL`` env var. Sync ORM wrapped in ``asyncio.to_thread`` at
the router layer — no async SQLAlchemy complexity.
"""

from __future__ import annotations

import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from server.api.config import DATABASE_URL

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Shared declarative base for every ORM model in server/api/auth/models.py."""


# SQLite requires ``check_same_thread=False`` when the same engine is reused
# across FastAPI handlers running in different threads (via asyncio.to_thread).
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, future=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    """Create every ORM table if missing.

    Called once from the FastAPI lifespan handler. Idempotent — safe to
    run on every boot. No migrations in v1; the ORM is the source of truth.
    """
    # Import is lazy to avoid a circular dependency at module load time.
    from server.api.auth import models  # noqa: F401  ensures tables are registered

    Base.metadata.create_all(bind=engine)
    log.info("DB initialised (url=%s)", DATABASE_URL)
