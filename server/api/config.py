"""
Centralised configuration for the server API layer.

Reads environment variables with sensible defaults.
API keys are NEVER hardcoded — use a .env file or host-level env vars.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    # Allow importing this module in environments without python-dotenv
    # (e.g. the prototyping notebook).  .env loading is skipped.
    def load_dotenv(*_args, **_kwargs):  # type: ignore[misc]
        pass

# Load .env from the server/api directory (or project root fallback)
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)
else:
    load_dotenv()  # fallback: searches up to project root


def _parse_str_list(env_var: str, defaults: tuple[str, ...]) -> tuple[str, ...]:
    """Parse a comma-separated env var into an ordered string tuple, or use defaults."""
    raw = os.getenv(env_var, "")
    if raw.strip():
        return tuple(m.strip() for m in raw.split(",") if m.strip())
    return defaults


def _parse_int_list(env_var: str, defaults: tuple[int, ...]) -> tuple[int, ...]:
    """Parse a comma-separated env var into an ordered int tuple, or use defaults."""
    raw = os.getenv(env_var, "")
    if raw.strip():
        return tuple(int(v.strip()) for v in raw.split(",") if v.strip())
    return defaults


# ── Snapshot buffer defaults (single source of truth) ────────────────────
# Import these constants directly when you need the defaults without
# instantiating the full OpenRouterConfig (e.g. from the notebook).
SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT: tuple[int, ...] = (300, 3600, 21600, 86400)  # 5m, 1h, 6h, 24h
SNAPSHOT_BUFFER_MAX_DEFAULT: int = 2048


@dataclass(frozen=True)
class OpenRouterConfig:
    """OpenRouter connection settings."""

    api_key: str = field(default_factory=lambda: os.getenv("OPENROUTER_API_KEY", ""))
    base_url: str = "https://openrouter.ai/api/v1"

    # Priority-ordered model fallback lists — override via comma-separated env vars.
    # The client tries each model in order; on failure it falls through to the next.
    investigation_models: tuple[str, ...] = field(
        default_factory=lambda: _parse_str_list(
            "OPENROUTER_INVESTIGATION_MODELS",
            ("anthropic/claude-sonnet-4", "openai/gpt-4.1", "google/gemini-2.5-pro-preview-06-05"),
        )
    )
    justification_models: tuple[str, ...] = field(
        default_factory=lambda: _parse_str_list(
            "OPENROUTER_JUSTIFICATION_MODELS",
            ("anthropic/claude-sonnet-4", "openai/gpt-4.1-mini", "google/gemini-2.5-flash-preview"),
        )
    )

    # Generation parameters
    max_tokens_investigation: int = 8196
    max_tokens_justification: int = 1024
    temperature_investigation: float = 0.
    temperature_justification: float = 0.

    # Snapshot buffer — controls how much pipeline history the LLM sees.
    # lookback_offsets_seconds: which historical points to sample (seconds before now).
    # snapshot_buffer_max: maximum stored snapshots in the ring buffer.
    # Canonical defaults are the module-level constants above.
    snapshot_lookback_offsets: tuple[int, ...] = field(
        default_factory=lambda: _parse_int_list(
            "SNAPSHOT_LOOKBACK_OFFSETS",
            SNAPSHOT_LOOKBACK_OFFSETS_DEFAULT,
        )
    )
    snapshot_buffer_max: int = field(
        default_factory=lambda: int(os.getenv(
            "SNAPSHOT_BUFFER_MAX", str(SNAPSHOT_BUFFER_MAX_DEFAULT),
        ))
    )


def get_openrouter_config() -> OpenRouterConfig:
    """Factory that returns a validated config instance."""
    cfg = OpenRouterConfig()
    if not cfg.api_key:
        raise EnvironmentError(
            "OPENROUTER_API_KEY is not set. "
            "Add it to server/api/.env or export it as an environment variable."
        )
    return cfg
