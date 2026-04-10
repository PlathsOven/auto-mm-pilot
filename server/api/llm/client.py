"""
OpenRouter HTTP client.

Thin async wrapper around the OpenRouter chat-completions API.
Supports both single-shot and streaming responses.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

import httpx

from server.api.config import OPENROUTER_TIMEOUT_SECS, OPENROUTER_STREAM_TIMEOUT_SECS, OpenRouterConfig

log = logging.getLogger(__name__)

_APP_REFERER = "https://auto-mm-pilot.app"
_APP_TITLE = "APT"


async def _strip_think_tags(stream: AsyncIterator[str]) -> AsyncIterator[str]:
    """Strip <think>...</think> blocks from a streaming response.

    Handles tags that span multiple chunks by buffering until the closing
    tag is found.  Only content *outside* think blocks is yielded.
    """
    buf = ""
    inside = False

    async for chunk in stream:
        buf += chunk

        while buf:
            if inside:
                end = buf.find("</think>")
                if end != -1:
                    # Drop everything up to and including the closing tag
                    buf = buf[end + len("</think>"):]
                    inside = False
                else:
                    # Still waiting for the closing tag — keep the tail in
                    # case "</think>" is arriving across chunks.
                    break
            else:
                start = buf.find("<think>")
                if start != -1:
                    # Yield safe content before the opening tag
                    if start > 0:
                        yield buf[:start]
                    buf = buf[start + len("<think>"):]
                    inside = True
                else:
                    # No opening tag found.  Yield everything except the
                    # last 6 chars (len("<think") - 1) which could be a
                    # partial opening tag arriving across chunks.
                    safe = len(buf) - 6
                    if safe > 0:
                        yield buf[:safe]
                        buf = buf[safe:]
                    break

    # Flush remaining content (only if we're not stuck inside a tag)
    if buf and not inside:
        yield buf


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
        async with httpx.AsyncClient(timeout=OPENROUTER_TIMEOUT_SECS) as client:
            resp = await client.post(
                self._endpoint,
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()

    async def _raw_stream(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        """Send a streaming chat-completion request. Yields raw content deltas."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=OPENROUTER_STREAM_TIMEOUT_SECS) as client:
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

    async def stream(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        """Send a streaming chat-completion request. Yields content deltas with <think> blocks stripped."""
        raw = self._raw_stream(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        async for delta in _strip_think_tags(raw):
            yield delta

    # ------------------------------------------------------------------
    # Fallback wrappers — try models in priority order
    # ------------------------------------------------------------------

    async def complete_with_fallback(
        self,
        *,
        models: tuple[str, ...],
        messages: list[dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.4,
    ) -> dict[str, Any]:
        """Try each model in *models* until one succeeds. Raises the last error if all fail."""
        last_exc: Exception | None = None
        for model in models:
            try:
                return await self.complete(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                log.warning("Model %s failed: %s — falling back", model, exc)
                last_exc = exc
        raise RuntimeError(
            f"All models exhausted ({', '.join(models)}). Last error: {last_exc}"
        ) from last_exc

    async def stream_with_fallback(
        self,
        *,
        models: tuple[str, ...],
        messages: list[dict[str, str]],
        max_tokens: int = 1024,
        temperature: float = 0.4,
    ) -> AsyncIterator[str]:
        """Try each model in *models* for streaming until one succeeds."""
        last_exc: Exception | None = None
        for model in models:
            try:
                async for delta in self.stream(
                    model=model,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                ):
                    yield delta
                return  # stream completed successfully
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                log.warning("Model %s stream failed: %s — falling back", model, exc)
                last_exc = exc
        raise RuntimeError(
            f"All models exhausted ({', '.join(models)}). Last error: {last_exc}"
        ) from last_exc
