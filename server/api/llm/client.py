"""
OpenRouter HTTP client.

Thin async wrapper around the OpenRouter chat-completions API.
Supports both single-shot and streaming responses.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from server.api.config import OpenRouterConfig

_APP_REFERER = "https://auto-mm-pilot.app"
_APP_TITLE = "Auto-MM-Pilot"


class OpenRouterClient:
    """Async HTTP client for the OpenRouter chat-completions endpoint."""

    def __init__(self, config: OpenRouterConfig) -> None:
        self._config = config
        self._endpoint = f"{config.base_url}/chat/completions"
        self._headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": _APP_REFERER,
            "X-Title": _APP_TITLE,
        }

    async def complete(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.4,
    ) -> dict[str, Any]:
        """Send a non-streaming chat-completion request. Returns the full response JSON."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                self._endpoint,
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    async def stream(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        """Send a streaming chat-completion request. Yields content delta strings."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                self._endpoint,
                headers=self._headers,
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[len("data: "):]
                    if data.strip() == "[DONE]":
                        break
                    chunk = json.loads(data)
                    delta = (
                        chunk.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content", "")
                    )
                    if delta:
                        yield delta
