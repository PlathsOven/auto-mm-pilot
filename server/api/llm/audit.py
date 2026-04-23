"""
Audit-log helper for every outbound LLM request.

Usage — non-streaming::

    async with record_call(
        user_id=user_id,
        conversation_turn_id=turn_id,
        stage="investigation",
        mode="investigate",
        model=model,
        messages=messages,
        temperature=temp,
        max_tokens=max_tokens,
    ) as handle:
        resp = await client.complete_with_fallback(...)
        handle.capture_openrouter_response(resp)

Usage — streaming::

    async with record_call(..., stage="investigation") as handle:
        async for delta in client.stream_with_fallback(...):
            handle.accumulate_delta(delta)
            yield delta

The context manager persists one ``LlmCall`` row on exit — success or
exception — so crashed requests still leave a trace. Persistence failures
are logged and swallowed; audit must never break the request path.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from server.api.db import SessionLocal
from server.api.llm.models import LlmCall

log = logging.getLogger(__name__)


@dataclass
class LlmCallHandle:
    """Mutable sink the caller fills in during the LLM call.

    The ``record_call`` context manager reads these fields on exit and
    persists a matching ``LlmCall`` row. Defaults leave fields null so
    partially-completed calls still log what is known.
    """

    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    error: str | None = None
    _stream_buffer: list[str] = field(default_factory=list)

    def accumulate_delta(self, delta: str) -> None:
        """Append a streamed token to the response buffer.

        Called from inside a streaming generator. ``content`` is resolved
        from the buffer automatically on context-manager exit if no caller
        has set it explicitly (e.g. by calling ``capture_openrouter_response``
        on the final response dict).
        """
        self._stream_buffer.append(delta)

    def capture_openrouter_response(self, resp: dict[str, Any]) -> None:
        """Pull content, tool_calls, finish_reason, and usage out of an OpenRouter JSON response."""
        choice = (resp.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        self.content = message.get("content")
        tool_calls = message.get("tool_calls")
        if tool_calls:
            self.tool_calls = tool_calls
        self.finish_reason = choice.get("finish_reason")
        usage = resp.get("usage") or {}
        self.prompt_tokens = usage.get("prompt_tokens")
        self.completion_tokens = usage.get("completion_tokens")


@asynccontextmanager
async def record_call(
    *,
    user_id: str,
    conversation_turn_id: str,
    stage: str,
    mode: str | None,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    tools: list[dict[str, Any]] | None = None,
) -> AsyncIterator[LlmCallHandle]:
    """Wrap an outbound LLM call; persist an ``LlmCall`` row on exit.

    Always records a row — whether the call succeeded, raised, or was
    cancelled. DB failures are logged and swallowed: audit must never
    break the request path.
    """
    started = time.perf_counter()
    handle = LlmCallHandle()
    try:
        yield handle
    except BaseException as exc:
        # Capture, persist, and re-raise. Covers cancellations too.
        handle.error = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        # Resolve streaming content from the buffer if the caller didn't
        # set ``content`` explicitly (non-streaming path sets it via
        # ``capture_openrouter_response``).
        if handle.content is None and handle._stream_buffer:
            handle.content = "".join(handle._stream_buffer)

        try:
            await asyncio.to_thread(
                _persist,
                user_id=user_id,
                conversation_turn_id=conversation_turn_id,
                stage=stage,
                mode=mode,
                model=model,
                messages=messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens,
                handle=handle,
                latency_ms=elapsed_ms,
            )
        except Exception:
            log.warning("LlmCall persist failed", exc_info=True)


def _persist(
    *,
    user_id: str,
    conversation_turn_id: str,
    stage: str,
    mode: str | None,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    temperature: float,
    max_tokens: int,
    handle: LlmCallHandle,
    latency_ms: int,
) -> None:
    """Insert one ``LlmCall`` row — sync ORM, called via ``asyncio.to_thread``."""
    row = LlmCall(
        user_id=user_id,
        conversation_turn_id=conversation_turn_id,
        stage=stage,
        mode=mode,
        model=model,
        request_messages=messages,
        request_tools=tools,
        request_temperature=temperature,
        request_max_tokens=max_tokens,
        response_content=handle.content,
        response_tool_calls=handle.tool_calls,
        response_finish_reason=handle.finish_reason,
        prompt_tokens=handle.prompt_tokens,
        completion_tokens=handle.completion_tokens,
        latency_ms=latency_ms,
        error=handle.error,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    with SessionLocal() as sess:
        sess.add(row)
        sess.commit()
