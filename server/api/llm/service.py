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
from server.api.llm.prompts import get_investigation_prompt, get_justification_prompt
from server.api.llm.snapshot_buffer import SnapshotRingBuffer


class LlmService:
    """High-level LLM orchestration for the two engine roles."""

    def __init__(self, config: OpenRouterConfig | None = None) -> None:
        self._config = config or get_openrouter_config()
        self._client = OpenRouterClient(self._config)

    # ------------------------------------------------------------------
    # Investigation chat (Zone E) — bidirectional: read state + issue
    # parameter change commands back to the engine.
    # ------------------------------------------------------------------

    async def investigate(
        self,
        *,
        conversation: list[dict[str, str]],
        engine_state: dict[str, Any],
        pipeline_snapshot: dict[str, Any] | None = None,
        snapshot_buffer: SnapshotRingBuffer | None = None,
        now: datetime | None = None,
    ) -> str:
        """Non-streaming investigation response."""
        stream_contexts = serialize_stream_contexts()
        history_context = self._extract_history(snapshot_buffer, now)
        system_prompt = get_investigation_prompt(
            engine_state, stream_contexts, pipeline_snapshot, history_context,
        )
        messages = [{"role": "system", "content": system_prompt}, *conversation]
        resp = await self._client.complete_with_fallback(
            models=self._config.investigation_models,
            messages=messages,
            max_tokens=self._config.max_tokens_investigation,
            temperature=self._config.temperature_investigation,
        )
        return resp["choices"][0]["message"]["content"]

    async def investigate_stream(
        self,
        *,
        conversation: list[dict[str, str]],
        engine_state: dict[str, Any],
        pipeline_snapshot: dict[str, Any] | None = None,
        snapshot_buffer: SnapshotRingBuffer | None = None,
        now: datetime | None = None,
    ) -> AsyncIterator[str]:
        """Streaming investigation response — yields content deltas."""
        stream_contexts = serialize_stream_contexts()
        history_context = self._extract_history(snapshot_buffer, now)
        system_prompt = get_investigation_prompt(
            engine_state, stream_contexts, pipeline_snapshot, history_context,
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

    # ------------------------------------------------------------------
    # Justification narrator (Zone D) — generates concise one-line
    # reasons for position changes on update cards.
    # ------------------------------------------------------------------

    async def justify(
        self,
        *,
        asset: str,
        expiry: str,
        old_pos: float,
        new_pos: float,
        delta: float,
        pipeline_snapshot: dict[str, Any] | None = None,
    ) -> str:
        """Generate a concise one-line justification for a position change."""
        system_prompt = get_justification_prompt(pipeline_snapshot)
        user_content = (
            f"Asset: {asset}\n"
            f"Expiry: {expiry}\n"
            f"Position change: {old_pos:+.2f} → {new_pos:+.2f} $vega (delta {delta:+.2f})\n"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        resp = await self._client.complete_with_fallback(
            models=self._config.justification_models,
            messages=messages,
            max_tokens=self._config.max_tokens_justification,
            temperature=self._config.temperature_justification,
        )
        choice = resp["choices"][0]
        content = choice["message"].get("content")
        if not content:
            return "Unable to generate justification."
        text = content.strip()
        if choice.get("finish_reason") == "length":
            text += " …"
        return text
