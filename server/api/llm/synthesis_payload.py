"""
Synthesis → ``ProposedBlockPayload`` conversion.

Given a Stage-3 tool call (preset selection or custom derivation) plus
the Stage-2 intent, produce a fully-parameterised ``ProposedBlockPayload``
that Stage 4 can preview against the engine.

Validation failures raise ``StageError`` so the build orchestrator can
surface them as typed error events.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from server.api.llm.parameter_presets import find_preset
from server.api.llm.stages import StageError
from server.api.models import (
    BlockConfigDict,
    CustomDerivation,
    DataStreamIntent,
    DiscretionaryViewIntent,
    IntentOutput,
    PresetSelection,
    ProposalSnapshotRow,
    ProposedBlockPayload,
    SynthesisOutput,
    UnitConversionDict,
)


# ──────────────────────────────────────────────────────────────────
# Public entry points — one per synthesiser tool
# ──────────────────────────────────────────────────────────────────

def build_preset_synthesis(
    intent: IntentOutput,
    args: dict[str, Any],
) -> SynthesisOutput:
    """Clone a preset's ``BlockConfig`` + ``UnitConversion`` with overrides."""
    preset_id = args.get("preset_id", "")
    preset = find_preset(preset_id)
    if preset is None:
        raise StageError(f"synthesiser referenced unknown preset: {preset_id!r}")

    symbols = _require_str_list(args, "symbols")
    expiries = _require_str_list(args, "expiries")
    raw_value = _require_number(args, "raw_value")
    start_timestamp = _optional_datetime(args.get("start_timestamp"))
    override = args.get("var_fair_ratio_override")
    reasoning = args.get("reasoning") or "matched preset."

    var_fair_ratio = (
        float(override) if isinstance(override, (int, float)) and override is not None
        else preset.block.var_fair_ratio
    )
    block = BlockConfigDict(
        annualized=preset.block.annualized,
        temporal_position=preset.block.temporal_position,
        decay_end_size_mult=preset.block.decay_end_size_mult,
        decay_rate_prop_per_min=preset.block.decay_rate_prop_per_min,
        var_fair_ratio=var_fair_ratio,
    )
    conv = preset.unit_conversion

    payload = _assemble_payload(
        intent=intent, symbols=symbols, expiries=expiries,
        raw_value=raw_value, start_timestamp=start_timestamp,
        scale=conv.scale, offset=conv.offset, exponent=conv.exponent,
        block=block,
    )
    choice = PresetSelection(
        preset_id=preset_id,
        var_fair_ratio_override=override,
        reasoning=reasoning,
    )
    return SynthesisOutput(choice=choice, proposed_payload=payload)


def build_custom_synthesis(
    intent: IntentOutput,
    args: dict[str, Any],
) -> SynthesisOutput:
    """Validate an LLM-authored BlockConfig + UnitConversion and assemble the payload."""
    symbols = _require_str_list(args, "symbols")
    expiries = _require_str_list(args, "expiries")
    raw_value = _require_number(args, "raw_value")
    start_timestamp = _optional_datetime(args.get("start_timestamp"))
    block_raw = args.get("block") or {}
    conv_raw = args.get("unit_conversion") or {}
    reasoning = args.get("reasoning") or ""

    try:
        block = BlockConfigDict(**block_raw)
        block.to_block_config()  # enforces framework invariants
        conv = UnitConversionDict(**conv_raw)
    except (ValidationError, ValueError) as exc:
        raise StageError(f"custom derivation failed validation: {exc}") from exc

    payload = _assemble_payload(
        intent=intent, symbols=symbols, expiries=expiries,
        raw_value=raw_value, start_timestamp=start_timestamp,
        scale=conv.scale, offset=conv.offset, exponent=conv.exponent,
        block=block,
    )
    choice = CustomDerivation(
        block=block, unit_conversion=conv, reasoning=reasoning,
    )
    return SynthesisOutput(choice=choice, proposed_payload=payload)


# ──────────────────────────────────────────────────────────────────
# Internal
# ──────────────────────────────────────────────────────────────────

def _assemble_payload(
    *,
    intent: IntentOutput,
    symbols: list[str],
    expiries: list[str],
    raw_value: float,
    start_timestamp: datetime | None,
    scale: float,
    offset: float,
    exponent: float,
    block: BlockConfigDict,
) -> ProposedBlockPayload:
    """Convert a tool call + intent into a ``ProposedBlockPayload``."""
    is_stream = isinstance(intent.structured, DataStreamIntent)
    action = "create_stream" if is_stream else "create_manual_block"
    key_cols = (
        intent.structured.key_cols if is_stream else ["symbol", "expiry"]
    )

    snapshot_rows: list[ProposalSnapshotRow] = []
    if action == "create_manual_block":
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        snapshot_rows = [
            ProposalSnapshotRow(
                timestamp=now,
                symbol=sym,
                expiry=exp,
                raw_value=raw_value,
                start_timestamp=start_timestamp,
            )
            for sym in symbols for exp in expiries
        ]

    return ProposedBlockPayload(
        action=action,
        stream_name=_derive_stream_name(intent, symbols),
        key_cols=key_cols,
        scale=scale,
        offset=offset,
        exponent=exponent,
        block=block,
        snapshot_rows=snapshot_rows,
    )


def _require_str_list(args: dict[str, Any], key: str) -> list[str]:
    val = args.get(key)
    if not isinstance(val, list) or not all(isinstance(v, str) for v in val):
        raise StageError(f"tool call missing or malformed {key!r} (expected list[str])")
    if not val:
        raise StageError(f"tool call {key!r} cannot be empty")
    return val


def _require_number(args: dict[str, Any], key: str) -> float:
    val = args.get(key)
    if not isinstance(val, (int, float)):
        raise StageError(f"tool call missing or malformed {key!r} (expected number)")
    return float(val)


def _optional_datetime(val: Any) -> datetime | None:
    if val in (None, ""):
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        # Accept both "...Z" and "+00:00"; store naive UTC to match the
        # codebase convention (see server/api/auth/models.py docstring).
        s = val.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    raise StageError(f"tool call start_timestamp malformed: {val!r}")


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(text: str) -> str:
    return _SLUG_RE.sub("_", text.lower()).strip("_") or "x"


def _derive_stream_name(intent: IntentOutput, symbols: list[str]) -> str:
    """Build a deterministic, readable stream name from the structured intent.

    The trader can rename the stream in the BlockDrawer before committing.
    Falls back to a timestamped generic name if the intent doesn't carry
    enough identity for a descriptive slug.
    """
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    first_sym = symbols[0].lower() if symbols else "x"

    s = intent.structured
    if isinstance(s, DiscretionaryViewIntent):
        topic = s.event_type or s.target_variable or "view"
        return f"opinion_{_slug(topic)}_{first_sym}_{today}"
    if isinstance(s, DataStreamIntent):
        return f"feed_{_slug(s.semantic_type)}"

    # RawIntent or HeadlineIntent → generic
    return f"custom_{first_sym}_{today}"
