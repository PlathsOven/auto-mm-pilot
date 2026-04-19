/**
 * HTTP client for the block configuration table API.
 *
 * Endpoints:
 *   GET   /api/blocks  — List all blocks from current pipeline
 *   POST  /api/blocks  — Create a manual block
 */

import type { BlockConfigPayload, BlockRow, SnapshotRow } from "../types";
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
  block: BlockConfigPayload;
  snapshot_rows: SnapshotRow[];
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
  block?: BlockConfigPayload;
  snapshot_rows?: SnapshotRow[];
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
