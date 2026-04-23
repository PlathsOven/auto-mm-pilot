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
    investigation + feedback_detector) shares the same id.
    """

    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    conversation_turn_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # Stage values (spec §9.1): "router", "intent", "synthesis", "critique",
    # "investigation", "general", "feedback_detector".
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


class BlockIntent(Base):
    """One row per successful Stage-5 commit.

    Binds a created stream back to the natural-language intent that
    spawned it. The Inspector queries this via ``GET /api/streams/{name}
    /intent`` to answer "why does this block exist?" in the trader's
    own words.

    The three JSON columns carry the full Stage-1→4 trace — intent
    (structured or raw), synthesis (preset selection or custom
    derivation + critique), and the preview diff the trader confirmed.
    Later sessions can audit not just what the block is but why the
    pipeline thought that was the right shape.
    """

    __tablename__ = "block_intents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    stream_name: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    original_phrasing: Mapped[str] = mapped_column(Text, nullable=False)
    intent_output: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    synthesis_output: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    preview_response: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    # Denormalised for analytics — which presets does the desk reach for?
    preset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    custom_derivation_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_block_intents_user_stream", BlockIntent.user_id, BlockIntent.stream_name)


class LlmFailure(Base):
    """One row per detected signal that the LLM got it wrong.

    Sources: the feedback detector (chat-message discontent or factual
    correction), explicit UI events (preview_rejection), and downstream
    block mutations that suggest the original proposal missed
    (post_commit_edit). Studied offline to drive prompt / preset
    changes — no runtime read path in M4.
    """

    __tablename__ = "llm_failures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    conversation_turn_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # FK stays nullable — the detector's own LlmCall id isn't always
    # available when we write the failure row.
    llm_call_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("llm_calls.id", ondelete="SET NULL"), nullable=True,
    )
    # Spec §9.2 signal_type values: factual_correction / discontent /
    # preview_rejection / silent_rejection / post_commit_edit.
    signal_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # Spec §9.2 trigger values: chat_message / preview_ui /
    # commit_followup / idle_timeout.
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    llm_output_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    trader_response_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    detector_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


Index("ix_llm_failures_user_signal", LlmFailure.user_id, LlmFailure.signal_type)


class UserContextEntry(Base):
    """Sparse per-user key-value store — the LLM's evolving profile of
    the trader. Injected into every mode's prompt to personalise.

    Keys are a controlled vocabulary (spec §9.3.1). Values are freeform
    JSON so each key stores whatever shape fits. The unique
    ``(user_id, key)`` index lets the detector upsert idempotently on
    repeat observations — value is refined, observation_count
    increments, updated_at advances.
    """

    __tablename__ = "user_context_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    # Why the detector wrote this — useful context when a human reviews
    # why their prompts are being personalised a certain way.
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_observed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    observation_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


Index(
    "ix_user_context_user_key",
    UserContextEntry.user_id,
    UserContextEntry.key,
    unique=True,
)
