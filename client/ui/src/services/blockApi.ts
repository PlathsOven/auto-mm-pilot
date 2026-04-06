/**
 * HTTP client for the block configuration table API.
 *
 * Endpoints:
 *   GET   /api/blocks  — List all blocks from current pipeline
 *   POST  /api/blocks  — Create a manual block
 */

import type { BlockRow } from "../types";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function fetchBlocks(): Promise<BlockRow[]> {
  const data = await apiFetch<{ blocks: BlockRow[] }>("/api/blocks");
  return data.blocks;
}

// ---------------------------------------------------------------------------
// Create manual block
// ---------------------------------------------------------------------------

export interface ManualBlockPayload {
  stream_name: string;
  key_cols?: string[];
  scale: number;
  offset: number;
  exponent: number;
  block: {
    annualized: boolean;
    size_type: "fixed" | "relative";
    aggregation_logic: "average" | "offset";
    temporal_position: "static" | "shifting";
    decay_end_size_mult: number;
    decay_rate_prop_per_min: number;
    decay_profile: "linear";
    var_fair_ratio: number;
  };
  snapshot_rows: Record<string, unknown>[];
  space_id?: string;
}

export async function createManualBlock(
  payload: ManualBlockPayload,
): Promise<BlockRow> {
  return apiFetch<BlockRow>("/api/blocks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Update existing block
// ---------------------------------------------------------------------------

export interface UpdateBlockPayload {
  scale?: number;
  offset?: number;
  exponent?: number;
  block?: {
    annualized: boolean;
    size_type: "fixed" | "relative";
    aggregation_logic: "average" | "offset";
    temporal_position: "static" | "shifting";
    decay_end_size_mult: number;
    decay_rate_prop_per_min: number;
    decay_profile: "linear";
    var_fair_ratio: number;
  };
  snapshot_rows?: Record<string, unknown>[];
}

export async function updateBlock(
  streamName: string,
  payload: UpdateBlockPayload,
): Promise<BlockRow> {
  return apiFetch<BlockRow>(`/api/blocks/${encodeURIComponent(streamName)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
