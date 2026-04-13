"""
LLM service orchestration.

Builds message arrays from system prompts + conversation context,
dispatches to the OpenRouter client, and returns structured responses.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, AsyncIterator

from server.api.config import OpenRouterConfig, get_openrouter_config
from server.api.llm.client import OpenRouterClient
from server.api.llm.context_db import serialize_stream_contexts
from server.api.llm.prompts import ChatMode, build_system_prompt
from server.api.llm.snapshot_buffer import SnapshotRingBuffer


class LlmService:
    """High-level LLM orchestration for the investigation role."""

    def __init__(self, config: OpenRouterConfig | None = None) -> None:
        self._config = config or get_openrouter_config()
        self._client = OpenRouterClient(self._config)

    @property
    def client(self) -> OpenRouterClient:
        """Expose the underlying HTTP client for reuse (e.g. correction detector)."""
        return self._client

    @property
    def config(self) -> OpenRouterConfig:
        """Expose config for reuse (e.g. detector model list)."""
        return self._config

    # ------------------------------------------------------------------
    # Investigation chat (Zone E) — bidirectional: read state + issue
    # parameter change commands back to the engine.
    # ------------------------------------------------------------------

    async def investigate_stream(
        self,
        *,
        conversation: list[dict[str, str]],
        engine_state: dict[str, Any],
        pipeline_snapshot: dict[str, Any] | None = None,
        snapshot_buffer: SnapshotRingBuffer | None = None,
        now: datetime | None = None,
        mode: ChatMode = "investigate",
    ) -> AsyncIterator[str]:
        """Streaming response for any chat mode — yields content deltas."""
        stream_contexts = serialize_stream_contexts()
        history_context = self._extract_history(snapshot_buffer, now)
        system_prompt = build_system_prompt(
            mode,
            engine_state=engine_state,
            stream_contexts_json=stream_contexts,
            pipeline_snapshot=pipeline_snapshot,
            history_context=history_context,
        )
        messages = [{"role": "system", "content": system_prompt}, *conversation]
        async for delta in self._client.stream_with_fallback(
            models=self._config.investigation_models,
            messages=messages,
            max_tokens=self._config.max_tokens_investigation,
            temperature=self._config.temperature_investigation,
        ):
            yield delta

    @staticmethod
    def _extract_history(
        buffer: SnapshotRingBuffer | None,
        now: datetime | None,
    ) -> str | None:
        """Build history context string from the snapshot buffer, if available."""
        if buffer is None or len(buffer) < 2:
            return None
        ts = now or datetime.now(timezone.utc).replace(tzinfo=None)
        return buffer.build_history_context(ts)
