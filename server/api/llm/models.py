"""
ORM models for the LLM orchestration layer.

Milestone 1 registers ``LlmCall`` only — every outbound LLM request is
written here with its full payload, tool calls, latency, and token counts.
Later milestones add ``LlmFailure`` / ``UserContextEntry`` / ``BlockIntent``
to this module; keeping the LLM concerns in their own models file (separate
from ``server/api/auth/models.py``) scopes the blast radius of schema changes.

All datetimes are UTC-naive — matching the existing convention in
``server/api/auth/models.py``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from server.api.db import Base


class LlmCall(Base):
    """Append-only audit log. One row per outbound LLM request.

    Rows are grouped by ``conversation_turn_id`` — every LLM call spawned
    by a single user turn (router + intent + synthesis + critique, or
    investigation + correction-detector) shares the same id.
    """

    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    conversation_turn_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # Stage values (spec §9.1): "router", "intent", "synthesis", "critique",
    # "investigation", "general", "correction_detector", "feedback_detector".
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    request_messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    request_tools: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    request_temperature: Mapped[float] = mapped_column(Float, nullable=False)
    request_max_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    response_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_tool_calls: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    response_finish_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_llm_calls_user_stage", LlmCall.user_id, LlmCall.stage)
Index("ix_llm_calls_turn", LlmCall.conversation_turn_id)
