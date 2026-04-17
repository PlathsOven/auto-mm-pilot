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

# ── Client-facing WebSocket ──────────────────────────────────────────────
CLIENT_WS_API_KEY: str = os.environ.get("CLIENT_WS_API_KEY", "")
CLIENT_WS_ALLOWED_IPS: str = os.environ.get("CLIENT_WS_ALLOWED_IPS", "")

# ── REST API auth — per-user keys ────────────────────────────────────────
# Comma-separated list of valid API keys (one per user/integration).
# Falls back to CLIENT_WS_API_KEY for single-key backwards-compatibility.
# If neither is set, REST auth is disabled (all requests pass) with a warning.
_POSIT_API_KEYS_RAW: str = os.environ.get("POSIT_API_KEYS", "")


def get_valid_api_keys() -> frozenset[str]:
    """Return the set of valid REST API keys.

    Priority: POSIT_API_KEYS (comma-separated) → CLIENT_WS_API_KEY → empty set.
    An empty set means auth is disabled (dev mode).
    """
    if _POSIT_API_KEYS_RAW.strip():
        return frozenset(k.strip() for k in _POSIT_API_KEYS_RAW.split(",") if k.strip())
    if CLIENT_WS_API_KEY:
        return frozenset([CLIENT_WS_API_KEY])
    return frozenset()

# ── Application mode ─────────────────────────────────────────────────────
POSIT_MODE: str = os.environ.get("POSIT_MODE", "mock").lower()

# ── WebSocket ticker ─────────────────────────────────────────────────────

# How often (in real seconds) we push a new tick to clients
TICK_INTERVAL_SECS: float = 2.0

# Minimum |delta| in smoothed_desired_position required to emit an UpdateCard
UPDATE_THRESHOLD: float = 50.0

# ── OpenRouter HTTP timeouts ─────────────────────────────────────────────

OPENROUTER_TIMEOUT_SECS: float = 30.0
OPENROUTER_STREAM_TIMEOUT_SECS: float = 60.0


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

    # Correction detector — cheap model for background KB extraction.
    detector_models: tuple[str, ...] = field(
        default_factory=lambda: _parse_str_list(
            "OPENROUTER_DETECTOR_MODELS",
            ("anthropic/claude-3.5-haiku", "google/gemini-2.0-flash-001"),
        )
    )
    max_tokens_detector: int = 512
    temperature_detector: float = 0.

    # Generation parameters — set high to accommodate models that spend
    # tokens on internal <think> reasoning (stripped before display).
    max_tokens_investigation: int = 16384
    temperature_investigation: float = 0.

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
