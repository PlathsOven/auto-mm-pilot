"""
Parameter presets for LLM-guided block synthesis.

Each preset encodes a canonical (situation → BlockConfig + UnitConversion)
mapping so the Stage 3 synthesiser can pick a preset instead of deriving
parameters from first principles.

Two consumers:
1. The LLM's Stage 3 prompt — the registry is serialised in full into the
   system prompt, so the model sees every preset's ``when_to_use`` and
   ``framework_reasoning`` at decision time.
2. Deterministic code — ``find_preset(preset_id)`` looks up by id and the
   synthesiser emits the block with the preset's params.

To extend: append one ``ParameterPreset`` entry below. Keep the list ordered
from most-common to most-specific so the LLM reads broad cases first.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from server.core.config import BlockConfig


@dataclass(frozen=True)
class UnitConversion:
    """Raw-value → calc-space (variance σ²) conversion parameters.

    The pipeline applies: target = (scale × raw + offset) ^ exponent.
    ``annualized`` tells the pipeline whether to distribute the result
    proportionally over time-to-expiry.
    """

    scale: float
    offset: float
    exponent: float
    annualized: bool


@dataclass(frozen=True)
class ParameterPreset:
    """One canonical situation → (BlockConfig + UnitConversion) mapping.

    Fields:
    - id: stable identifier, snake_case, referenced by stored intents.
    - description: short human label (≤ 1 line).
    - when_to_use: one paragraph shown verbatim to the LLM. Describe
        the trader's situation in the trader's terms.
    - framework_reasoning: why these parameters encode this situation.
        Grounds the LLM's choice in the framework math.
    - block: BlockConfig for every block produced by this preset.
    - unit_conversion: how raw_value maps to variance.
    """

    id: str
    description: str
    when_to_use: str
    framework_reasoning: str
    block: BlockConfig
    unit_conversion: UnitConversion


# E[|ret|] in % → σ conversion scale (half-normal identity: σ = E[|X|] · √(π/2)).
# Divide by 100 to lift from percentage points to decimal return units.
_HALF_NORMAL_PCT_SCALE: float = math.sqrt(math.pi / 2) / 100.0

# Decay rates tuned for common event-resolution half-lives (proportional decay).
_DECAY_RATE_FAST_MACRO: float = 0.03   # ≈ 30-min half-life (FOMC / CPI / ECB)
_DECAY_RATE_PROTOCOL: float = 0.005    # ≈ 3-hour half-life (hard fork / upgrade)
_DECAY_RATE_FLASH: float = 0.05        # ≈ 15-min half-life (unscheduled / liquidations)


# ──────────────────────────────────────────────────────────────────
# PRESETS
#
# Add new entries below. Auto-serialised into the Stage 3 prompt.
# Order: broadest / most-common → narrowest / most-specific.
# ──────────────────────────────────────────────────────────────────

PRESETS: list[ParameterPreset] = [
    ParameterPreset(
        id="base_vol_shifting_pct",
        description="Ongoing vol level in % — 'vols will get bid to 50'",
        when_to_use=(
            "Trader expresses a view on the rolling/ongoing level of "
            "annualised volatility for an asset, stated as a percentage "
            "(e.g. '50 vol', 'IV will settle at 45'). Applies when there "
            "is no specific event; the view is about the base regime."
        ),
        framework_reasoning=(
            "Base vol shifts forward with current time (temporal_position="
            "'shifting'), is annualised (spread proportionally over "
            "time-to-expiry), and does not decay (end_size_mult=1.0, "
            "rate=0.0). Unit conversion: %-vol → decimal vol → variance, "
            "so scale=0.01, exponent=2."
        ),
        block=BlockConfig(
            annualized=True,
            temporal_position="shifting",
            decay_end_size_mult=1.0,
            decay_rate_prop_per_min=0.0,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=0.01, offset=0.0, exponent=2.0, annualized=True,
        ),
    ),

    ParameterPreset(
        id="base_vol_shifting_decimal",
        description="Ongoing vol level as decimal — stream: 0.50",
        when_to_use=(
            "Data stream emits annualised vol as a decimal (e.g. 0.50 "
            "for 50% vol). Same semantics as base_vol_shifting_pct but "
            "the raw value is already in decimal form."
        ),
        framework_reasoning=(
            "Same as base_vol_shifting_pct but scale=1.0 because raw is "
            "already a decimal. exponent=2 converts decimal vol to variance."
        ),
        block=BlockConfig(
            annualized=True,
            temporal_position="shifting",
            decay_end_size_mult=1.0,
            decay_rate_prop_per_min=0.0,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=1.0, offset=0.0, exponent=2.0, annualized=True,
        ),
    ),

    ParameterPreset(
        id="event_vol_fast_decay_pct_move",
        description="Fast macro event (FOMC, CPI, ECB) — expected % move",
        when_to_use=(
            "Trader describes a scheduled macroeconomic release with a "
            "specific release time, and expresses expected impact as an "
            "absolute percent move (e.g. 'I think FOMC will be a 2% "
            "upset'). Market typically prices in within ~30 minutes."
        ),
        framework_reasoning=(
            "Event vol is anchored to its release timestamp "
            "(temporal_position='static'), discrete rather than annualised "
            "(annualized=False), and decays to zero as the market digests "
            "(end_size_mult=0.0). Decay rate 0.03/min ≈ 30-min half-life. "
            "Unit conversion: user gives E[|ret|] in %, so "
            "scale = √(π/2)/100 (half-normal identity) and exponent=2."
        ),
        block=BlockConfig(
            annualized=False,
            temporal_position="static",
            decay_end_size_mult=0.0,
            decay_rate_prop_per_min=_DECAY_RATE_FAST_MACRO,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=_HALF_NORMAL_PCT_SCALE,
            offset=0.0,
            exponent=2.0,
            annualized=False,
        ),
    ),

    ParameterPreset(
        id="event_vol_protocol_upgrade_pct_move",
        description="Slow protocol event (hard fork, upgrade) — expected % move",
        when_to_use=(
            "Trader describes a crypto-specific protocol event (hard "
            "fork, chain upgrade, token migration) resolving over hours "
            "rather than minutes. Magnitude expressed as absolute % move."
        ),
        framework_reasoning=(
            "Same temporal shape as fast macro event (static, "
            "non-annualised, decays to zero) but decay rate is 0.005/min "
            "≈ 3-hour half-life because the market digests the outcome "
            "slowly. Unit conversion: E[|ret|]% → σ → variance."
        ),
        block=BlockConfig(
            annualized=False,
            temporal_position="static",
            decay_end_size_mult=0.0,
            decay_rate_prop_per_min=_DECAY_RATE_PROTOCOL,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=_HALF_NORMAL_PCT_SCALE,
            offset=0.0,
            exponent=2.0,
            annualized=False,
        ),
    ),

    ParameterPreset(
        id="event_vol_flash_pct_move",
        description="Flash event (liquidation cascade, unscheduled news) — expected % move",
        when_to_use=(
            "Trader describes an unscheduled event or a flash risk with "
            "very fast resolution (liquidation cascades, breaking news "
            "hitting headlines). Market resolves within ~15 minutes."
        ),
        framework_reasoning=(
            "Same static/non-annualised/decay-to-zero shape, rate "
            "0.05/min ≈ 15-min half-life. Use for fast-resolving tail-risk "
            "style inputs."
        ),
        block=BlockConfig(
            annualized=False,
            temporal_position="static",
            decay_end_size_mult=0.0,
            decay_rate_prop_per_min=_DECAY_RATE_FLASH,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=_HALF_NORMAL_PCT_SCALE,
            offset=0.0,
            exponent=2.0,
            annualized=False,
        ),
    ),

    ParameterPreset(
        id="realised_variance_passthrough",
        description="Realised variance as decimal — passthrough stream",
        when_to_use=(
            "Data stream emits realised variance directly (σ² as decimal, "
            "e.g. 0.2025 for 45% vol). No transform needed — the raw "
            "value is already in variance units."
        ),
        framework_reasoning=(
            "Passthrough: exponent=1, scale=1. Variance shifts forward "
            "with current time (shifting), annualised across time-to-"
            "expiry, no decay."
        ),
        block=BlockConfig(
            annualized=True,
            temporal_position="shifting",
            decay_end_size_mult=1.0,
            decay_rate_prop_per_min=0.0,
            var_fair_ratio=1.0,
        ),
        unit_conversion=UnitConversion(
            scale=1.0, offset=0.0, exponent=1.0, annualized=True,
        ),
    ),

    # Append new presets below as the desk learns new canonical shapes.
]


def find_preset(preset_id: str) -> ParameterPreset | None:
    """Look up a preset by id. Returns None if not found."""
    return next((p for p in PRESETS if p.id == preset_id), None)


def serialize_presets_for_prompt() -> str:
    """Serialise every preset into a markdown block for Stage 3 prompt injection."""
    lines: list[str] = ["## PARAMETER PRESETS", ""]
    for p in PRESETS:
        lines.extend([
            f"### `{p.id}` — {p.description}",
            f"**When to use:** {p.when_to_use}",
            f"**Why these parameters:** {p.framework_reasoning}",
            f"**BlockConfig:** annualized={p.block.annualized}, "
            f"temporal_position={p.block.temporal_position!r}, "
            f"decay_end_size_mult={p.block.decay_end_size_mult}, "
            f"decay_rate_prop_per_min={p.block.decay_rate_prop_per_min}, "
            f"var_fair_ratio={p.block.var_fair_ratio}",
            f"**UnitConversion:** scale={p.unit_conversion.scale:.6f}, "
            f"offset={p.unit_conversion.offset}, "
            f"exponent={p.unit_conversion.exponent}, "
            f"annualized={p.unit_conversion.annualized}",
            "",
        ])
    return "\n".join(lines)
