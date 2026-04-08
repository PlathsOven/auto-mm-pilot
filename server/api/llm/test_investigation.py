#!/usr/bin/env python3
"""
Interactive CLI for testing the Investigation LLM (Zone E).

Uses pipeline snapshots exported from mvp_new.ipynb (via the export cell)
so the LLM has exact, notebook-consistent historical data for the snapshot
buffer.  Falls back to the hardcoded T=17:00 snapshot (no history) if the
exported JSON is not found.

Usage:
    # From project root:
    python -m server.api.llm.test_investigation

    # Or directly:
    python server/api/llm/test_investigation.py

To generate the exported snapshots:
    1. Open prototyping/mvp_new.ipynb
    2. Run All (including the final export cell)
    3. This produces server/api/llm/test_data/pipeline_snapshots.json

Requires OPENROUTER_API_KEY in server/api/.env (see .env.example).
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Ensure the project root is on sys.path so `server.*` imports resolve
# regardless of which directory the script is invoked from.
_PROJECT_ROOT = str(Path(__file__).resolve().parents[3])
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from server.api.config import get_openrouter_config
from server.api.llm.client import OpenRouterClient
from server.api.llm.context_db import serialize_stream_contexts
from server.api.llm.prompts import get_investigation_prompt
from server.api.llm.snapshot_buffer import SnapshotBufferConfig, SnapshotRingBuffer


# ---------------------------------------------------------------------------
# Mock pipeline snapshot — derived from mvp_new.ipynb with the default
# scenario: BTC, expiry 2026-01-02, bankroll 100k, 3 streams.
# This is the compact representation the LLM needs (not the full time grid).
# ---------------------------------------------------------------------------

def _build_mock_pipeline_snapshot() -> dict[str, Any]:
    """Build a hardcoded pipeline snapshot matching the notebook scenario.

    Exact values from the mvp_new.ipynb scenario at timestamp 2026-01-01 17:00:00.
    Used as fallback when the exported JSON is not available.
    """
    return {
        "block_summary": [
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "rv",
                "stream_name": "rv",
                "space_id": "shifting",
                "aggregation_logic": "average",
                "raw_value": 0.45,
                "target_value": 0.2025,
                "target_market_value": 0.30250000000000005,
                "var_fair_ratio": 1.0,
                "annualized": True,
                "size_type": "fixed",
                "temporal_position": "shifting",
                "decay_end_size_mult": 1.0,
                "decay_rate_prop_per_min": 0.0,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "mean_iv",
                "stream_name": "mean_iv",
                "space_id": "shifting",
                "aggregation_logic": "offset",
                "raw_value": 0.5,
                "target_value": 0.25,
                "target_market_value": 0.30250000000000005,
                "var_fair_ratio": 2.0,
                "annualized": True,
                "size_type": "relative",
                "temporal_position": "shifting",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_0",
                "stream_name": "events",
                "space_id": "static_20260101_000000",
                "aggregation_logic": "offset",
                "raw_value": 2.5,
                "target_value": 0.0006250000000000001,
                "target_market_value": 9e-06,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_1",
                "stream_name": "events",
                "space_id": "static_20260101_040000",
                "aggregation_logic": "offset",
                "raw_value": 3.1,
                "target_value": 0.0009610000000000002,
                "target_market_value": 6.25e-06,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_2",
                "stream_name": "events",
                "space_id": "static_20260101_080000",
                "aggregation_logic": "offset",
                "raw_value": 1.8,
                "target_value": 0.00032400000000000007,
                "target_market_value": 1.6e-05,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_3",
                "stream_name": "events",
                "space_id": "static_20260101_120000",
                "aggregation_logic": "offset",
                "raw_value": 4.0,
                "target_value": 0.0016,
                "target_market_value": 1.2249999999999998e-05,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
            {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
                "block_name": "events_event_4",
                "stream_name": "events",
                "space_id": "static_20260101_160000",
                "aggregation_logic": "offset",
                "raw_value": 2.0,
                "target_value": 0.0004,
                "target_market_value": 4e-06,
                "var_fair_ratio": 3.0,
                "annualized": False,
                "size_type": "fixed",
                "temporal_position": "static",
                "decay_end_size_mult": 0.0,
                "decay_rate_prop_per_min": 0.01,
            },
        ],
        "current_agg": {
            "symbol": "BTC",
            "expiry": "2026-01-02 00:00:00",
            "timestamp": "2026-01-01 17:00:00",
            "total_fair": 4.3850102669404515e-06,
            "total_market_fair": 6.151387938246256e-07,
            "edge": 3.7698714731158265e-06,
            "var": 1.2385010266940453e-05,
        },
        "current_position": {
            "smoothed_edge": 2.2342497634247776e-06,
            "smoothed_var": 7.731552482277452e-06,
            "raw_desired_position": 30438.985449845102,
            "smoothed_desired_position": 28897.815394077796,
        },
        "scenario": {
            "bankroll": 100_000,
            "smoothing_hl_secs": 1800,
            "now": "2026-01-01 00:00:00",
            "risk_dimension": {
                "symbol": "BTC",
                "expiry": "2026-01-02 00:00:00",
            },
        },
    }


# ---------------------------------------------------------------------------
# Exported snapshot loader
# ---------------------------------------------------------------------------

_SNAPSHOTS_JSON = Path(__file__).resolve().parent / "test_data" / "pipeline_snapshots.json"


def _load_exported_snapshots() -> dict[str, dict[str, Any]] | None:
    """Load pipeline snapshots exported from mvp_new.ipynb.

    Returns a dict keyed by timestamp string (e.g. '2026-01-01 17:00:00'),
    or ``None`` if the file does not exist.
    """
    if not _SNAPSHOTS_JSON.exists():
        return None
    with open(_SNAPSHOTS_JSON) as f:
        return json.load(f)


def _build_snapshot_buffer_from_exported(
    snapshots: dict[str, dict[str, Any]],
    config: SnapshotBufferConfig,
) -> SnapshotRingBuffer:
    """Build a ring buffer from notebook-exported snapshots (exact values)."""
    buf = SnapshotRingBuffer(config)
    for ts_str in sorted(snapshots.keys()):
        ts = datetime.fromisoformat(ts_str)
        buf.push(ts, snapshots[ts_str])
    return buf


def _build_mock_engine_state() -> dict[str, Any]:
    """Build a mock engine state matching the existing investigation interface."""
    return {
        "positions": [
            {
                "asset": "BTC",
                "expiry": "2026-01-02",
                "desiredVega": 28897.82,
                "previousDesiredVega": 28500.00,
                "changeMagnitude": 397.82,
                "updatedAt": "2026-01-01T17:00:00Z",
            },
        ],
        "streams": [
            {"id": "stream-realized-vol", "status": "active", "lastUpdate": "2026-01-01T00:00:00Z"},
            {"id": "stream-scheduled-events", "status": "active", "lastUpdate": "2026-01-01T00:00:00Z"},
            {"id": "stream-historical-iv", "status": "active", "lastUpdate": "2025-12-31T18:00:00Z"},
            {"id": "stream-vol-flow", "status": "active", "lastUpdate": "2026-01-01T00:00:00Z"},
            {"id": "stream-correlation", "status": "active", "lastUpdate": "2025-12-31T23:00:00Z"},
        ],
        "context": {
            "now": "2026-01-01T00:00:00Z",
            "riskDimensions": [{"symbol": "BTC", "expiry": "2026-01-02"}],
        },
    }


async def _run_cli() -> None:
    """Interactive investigation chat loop."""
    try:
        config = get_openrouter_config()
    except EnvironmentError as e:
        print(f"\n  ERROR: {e}\n", file=sys.stderr)
        sys.exit(1)

    client = OpenRouterClient(config)
    engine_state = _build_mock_engine_state()
    stream_contexts = serialize_stream_contexts()

    mock_now = datetime(2026, 1, 1, 17, 0, 0)
    buf_config = SnapshotBufferConfig(
        max_snapshots=config.snapshot_buffer_max,
        lookback_offsets_seconds=config.snapshot_lookback_offsets,
    )

    # Try loading notebook-exported snapshots for exact consistency
    exported = _load_exported_snapshots()
    if exported is not None:
        snapshot_buffer = _build_snapshot_buffer_from_exported(exported, buf_config)
        # Use the T=17:00 snapshot from the export as the "current" snapshot
        pipeline_snapshot = exported.get(str(mock_now), _build_mock_pipeline_snapshot())
        print(f"  Loaded {len(exported)} exported snapshots from {_SNAPSHOTS_JSON.name}")
    else:
        pipeline_snapshot = _build_mock_pipeline_snapshot()
        snapshot_buffer = SnapshotRingBuffer(buf_config)
        snapshot_buffer.push(mock_now, pipeline_snapshot)
        print("  WARNING: No exported snapshots found — history context disabled.")
        print(f"           Run the export cell in mvp_new.ipynb to generate {_SNAPSHOTS_JSON}")

    history_context = snapshot_buffer.build_history_context(mock_now)

    system_prompt = get_investigation_prompt(
        engine_state, stream_contexts, pipeline_snapshot, history_context,
    )

    print("=" * 70)
    print("  APT — Investigation LLM Test CLI")
    print("=" * 70)
    print(f"  Models (priority order): {', '.join(config.investigation_models)}")
    print(f"  Max tokens: {config.max_tokens_investigation}")
    print(f"  Temperature: {config.temperature_investigation}")
    print(f"  System prompt length: {len(system_prompt):,} chars")
    print("-" * 70)
    print("  Type your message and press Enter. Type 'quit' to exit.")
    print("  Type '/prompt' to dump the full system prompt.")
    print("  Type '/snapshot' to dump the pipeline snapshot.")
    print("  Type '/history' to dump the history context tables.")
    print("  Type '/clear' to reset conversation history.")
    print("=" * 70)
    print()

    conversation: list[dict[str, str]] = []

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if not user_input:
            continue

        if user_input.lower() == "quit":
            print("Exiting.")
            break

        if user_input == "/prompt":
            print("\n" + "=" * 70)
            print(system_prompt)
            print("=" * 70 + "\n")
            continue

        if user_input == "/snapshot":
            print("\n" + json.dumps(pipeline_snapshot, indent=2, default=str) + "\n")
            continue

        if user_input == "/history":
            if history_context:
                print("\n" + history_context + "\n")
            else:
                print("  [No history context — buffer has fewer than 2 snapshots]\n")
            continue

        if user_input == "/clear":
            conversation.clear()
            print("  [Conversation history cleared]\n")
            continue

        conversation.append({"role": "user", "content": user_input})
        messages = [{"role": "system", "content": system_prompt}, *conversation]

        print("\nAPT: ", end="", flush=True)
        try:
            full_response = ""
            async for delta in client.stream_with_fallback(
                models=config.investigation_models,
                messages=messages,
                max_tokens=config.max_tokens_investigation,
                temperature=config.temperature_investigation,
            ):
                print(delta, end="", flush=True)
                full_response += delta
            print("\n")

            conversation.append({"role": "assistant", "content": full_response})

        except Exception as e:
            print(f"\n  [ERROR: {e}]\n")
            conversation.pop()


def main() -> None:
    """Entry point."""
    asyncio.run(_run_cli())


if __name__ == "__main__":
    main()
