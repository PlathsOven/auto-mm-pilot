"""
Centralised configuration for the server API layer.

Reads environment variables with sensible defaults.
API keys are NEVER hardcoded — use a .env file or host-level env vars.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the server/api directory (or project root fallback)
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)
else:
    load_dotenv()  # fallback: searches up to project root


@dataclass(frozen=True)
class OpenRouterConfig:
    """OpenRouter connection settings."""

    api_key: str = field(default_factory=lambda: os.getenv("OPENROUTER_API_KEY", ""))
    base_url: str = "https://openrouter.ai/api/v1"

    # Default models — override via env vars
    investigation_model: str = field(
        default_factory=lambda: os.getenv(
            "OPENROUTER_INVESTIGATION_MODEL",
            "anthropic/claude-sonnet-4",
        )
    )
    justification_model: str = field(
        default_factory=lambda: os.getenv(
            "OPENROUTER_JUSTIFICATION_MODEL",
            "anthropic/claude-sonnet-4",
        )
    )

    # Generation parameters
    max_tokens_investigation: int = 1024
    max_tokens_justification: int = 128
    temperature_investigation: float = 0.4
    temperature_justification: float = 0.3


def get_openrouter_config() -> OpenRouterConfig:
    """Factory that returns a validated config instance."""
    cfg = OpenRouterConfig()
    if not cfg.api_key:
        raise EnvironmentError(
            "OPENROUTER_API_KEY is not set. "
            "Add it to server/api/.env or export it as an environment variable."
        )
    return cfg
