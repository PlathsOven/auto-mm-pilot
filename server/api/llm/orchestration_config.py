"""
Configuration for the LLM orchestration layer.

Every threshold, timeout, temperature, and token budget the five-stage
Build pipeline uses lives here. Tune by editing the defaults below or by
setting the corresponding env var — no prompt or code edits required.

Stages beyond Milestone 1 (intent extractor / synthesiser / critique /
feedback-detector / silent-rejection sweep / post-commit-edit detection)
read these knobs when they come online; the full surface is seeded here
up front so later milestones are pure wiring rather than schema churn.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class LlmOrchestrationConfig:
    """All tunable knobs for the LLM orchestration layer."""

    # ── Stage 1: Router ─────────────────────────────────────────────────
    router_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_ROUTER_MAX_TOKENS", "200"))
    )
    router_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_ROUTER_TEMPERATURE", "0.0"))
    )

    # ── Stage 2: Intent extractor ───────────────────────────────────────
    intent_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_INTENT_MAX_TOKENS", "1500"))
    )
    intent_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_INTENT_TEMPERATURE", "0.2"))
    )

    # ── Stage 3: Synthesiser ────────────────────────────────────────────
    synthesis_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_SYNTHESIS_MAX_TOKENS", "2000"))
    )
    synthesis_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_SYNTHESIS_TEMPERATURE", "0.1"))
    )

    # ── Stage 3.5: Critique ─────────────────────────────────────────────
    critique_max_tokens: int = field(
        default_factory=lambda: int(os.getenv("LLM_CRITIQUE_MAX_TOKENS", "800"))
    )
    critique_temperature: float = field(
        default_factory=lambda: float(os.getenv("LLM_CRITIQUE_TEMPERATURE", "0.0"))
    )

    # ── Feedback loop thresholds ────────────────────────────────────────

    # Silent-rejection sweep — proposals that surface but are neither
    # confirmed nor explicitly rejected within this many seconds are logged
    # to llm_failures with signal_type="silent_rejection".
    silent_rejection_threshold_secs: int = field(
        default_factory=lambda: int(os.getenv(
            "LLM_SILENT_REJECTION_THRESHOLD_SECS", "120",
        ))
    )

    # How often the silent-rejection sweep runs. Shorter = faster signal
    # capture + more DB churn. Longer = lag between abandonment and flag.
    silent_rejection_sweep_interval_secs: int = field(
        default_factory=lambda: int(os.getenv(
            "LLM_SILENT_REJECTION_SWEEP_INTERVAL_SECS", "30",
        ))
    )

    # Post-commit edit threshold — if a trader edits or deletes a block
    # within this many seconds of creating it, the edit is flagged as an
    # LLM first-pass failure. Beyond this window, edits are assumed to
    # reflect new information rather than a correction.
    post_commit_edit_threshold_secs: int = field(
        default_factory=lambda: int(os.getenv(
            "LLM_POST_COMMIT_EDIT_THRESHOLD_SECS", "600",
        ))
    )

    # Feedback detector — how many recent messages of context to include
    # when asking the detector model whether the latest exchange contains
    # a correction / discontent / preference signal.
    detector_context_window: int = field(
        default_factory=lambda: int(os.getenv("LLM_DETECTOR_CONTEXT_WINDOW", "6"))
    )

    # ── Target budgets (design targets, not enforced at runtime) ─────────
    # End-to-end latency budget from trader submit to proposal visible.
    # Breaching this triggers the Milestone 2 follow-up: merge Stages 1 + 2
    # into a single structured-output LLM call. Not enforced at runtime.
    end_to_end_latency_budget_secs: float = field(
        default_factory=lambda: float(os.getenv(
            "LLM_END_TO_END_LATENCY_BUDGET_SECS", "5.0",
        ))
    )


def get_llm_orchestration_config() -> LlmOrchestrationConfig:
    """Return a fresh config reading current env vars."""
    return LlmOrchestrationConfig()
