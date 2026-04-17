/**
 * Draft state types, defaults, and builder functions for BlockDrawer.
 *
 * Extracted from BlockDrawer.tsx to keep the main component under 300 lines.
 */

import type { BlockRow } from "../../../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawerMode = "create" | "edit" | "inspect";

export interface DraftBlockConfig {
  annualized: boolean;
  size_type: "fixed" | "relative";
  aggregation_logic: "average" | "offset";
  temporal_position: "static" | "shifting";
  decay_end_size_mult: number;
  decay_rate_prop_per_min: number;
  var_fair_ratio: number;
}

export interface SnapshotRowDraft {
  /** Unique client-side key for React list rendering. */
  _key: number;
  [col: string]: unknown;
}

export interface Draft {
  stream_name: string;
  key_cols_raw: string;
  scale: number;
  offset: number;
  exponent: number;
  space_id: string;
  block: DraftBlockConfig;
  snapshot_headers: string[];
  snapshot_rows: SnapshotRowDraft[];
}

// ---------------------------------------------------------------------------
// Key generator
// ---------------------------------------------------------------------------

let _nextKey = 1;
export function nextKey(): number {
  return _nextKey++;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_HEADERS = ["timestamp", "symbol", "expiry", "raw_value", "market_value"];

export function emptyRow(headers: string[]): SnapshotRowDraft {
  const row: SnapshotRowDraft = { _key: nextKey() };
  for (const h of headers) row[h] = "";
  return row;
}

export const EMPTY_DRAFT: Draft = {
  stream_name: "",
  key_cols_raw: "symbol, expiry",
  scale: 1.0,
  offset: 0.0,
  exponent: 1.0,
  space_id: "",
  block: {
    annualized: true,
    size_type: "fixed",
    aggregation_logic: "average",
    temporal_position: "shifting",
    decay_end_size_mult: 1.0,
    decay_rate_prop_per_min: 0.0,
    var_fair_ratio: 1.0,
  },
  snapshot_headers: [...DEFAULT_HEADERS],
  snapshot_rows: [
    {
      _key: nextKey(),
      timestamp: "2026-01-15T16:00:00Z",
      symbol: "BTC",
      expiry: "27MAR26",
      raw_value: "0.74",
      market_value: "",
    },
  ],
};

/** Strict numeric — matches integers, decimals, scientific notation. */
export const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

// ---------------------------------------------------------------------------
// Draft builders
// ---------------------------------------------------------------------------

export function draftFromBlock(b: BlockRow): Draft {
  const headers = [...DEFAULT_HEADERS];
  const row: SnapshotRowDraft = {
    _key: nextKey(),
    timestamp: b.start_timestamp ?? new Date().toISOString(),
    symbol: b.symbol,
    expiry: b.expiry,
    raw_value: String(b.raw_value),
    market_value: b.market_value != null ? String(b.market_value) : "",
  };
  return {
    stream_name: b.stream_name,
    key_cols_raw: "symbol, expiry",
    scale: b.scale,
    offset: b.offset,
    exponent: b.exponent,
    space_id: b.space_id,
    block: {
      annualized: b.annualized,
      size_type: b.size_type,
      aggregation_logic: b.aggregation_logic,
      temporal_position: b.temporal_position,
      decay_end_size_mult: b.decay_end_size_mult,
      decay_rate_prop_per_min: b.decay_rate_prop_per_min,
      var_fair_ratio: b.var_fair_ratio,
    },
    snapshot_headers: headers,
    snapshot_rows: [row],
  };
}

/**
 * Build a draft from engine-command params (emitted by the LLM in opinion mode).
 * Falls back to EMPTY_DRAFT defaults for any missing fields.
 */
export function draftFromCommandParams(params: Record<string, unknown>): Draft {
  const blk = (params.block ?? {}) as Record<string, unknown>;
  const keyCols = params.key_cols as string[] | undefined;
  const rawRows = params.snapshot_rows as Record<string, unknown>[] | undefined;

  // Determine snapshot headers from the first row (if provided)
  const firstRow = rawRows?.[0];
  const headers = firstRow
    ? Object.keys(firstRow).filter((k) => k !== "_key")
    : [...DEFAULT_HEADERS];

  // Add start_timestamp header if any row has it and it's not already present
  if (!headers.includes("start_timestamp") && rawRows?.some((r) => "start_timestamp" in r)) {
    headers.push("start_timestamp");
  }

  const rows: SnapshotRowDraft[] = rawRows
    ? rawRows.map((r) => {
        const row: SnapshotRowDraft = { _key: nextKey() };
        for (const h of headers) {
          row[h] = r[h] != null ? String(r[h]) : "";
        }
        return row;
      })
    : [emptyRow(headers)];

  return {
    stream_name: (params.stream_name as string) ?? "",
    key_cols_raw: keyCols?.join(", ") ?? "symbol, expiry",
    scale: typeof params.scale === "number" ? params.scale : 1.0,
    offset: typeof params.offset === "number" ? params.offset : 0.0,
    exponent: typeof params.exponent === "number" ? params.exponent : 1.0,
    space_id: (params.space_id as string) ?? "",
    block: {
      annualized: typeof blk.annualized === "boolean" ? blk.annualized : EMPTY_DRAFT.block.annualized,
      size_type: (blk.size_type as "fixed" | "relative") ?? EMPTY_DRAFT.block.size_type,
      aggregation_logic: (blk.aggregation_logic as "average" | "offset") ?? EMPTY_DRAFT.block.aggregation_logic,
      temporal_position: (blk.temporal_position as "static" | "shifting") ?? EMPTY_DRAFT.block.temporal_position,
      decay_end_size_mult: typeof blk.decay_end_size_mult === "number" ? blk.decay_end_size_mult : EMPTY_DRAFT.block.decay_end_size_mult,
      decay_rate_prop_per_min: typeof blk.decay_rate_prop_per_min === "number" ? blk.decay_rate_prop_per_min : EMPTY_DRAFT.block.decay_rate_prop_per_min,
      var_fair_ratio: typeof blk.var_fair_ratio === "number" ? blk.var_fair_ratio : EMPTY_DRAFT.block.var_fair_ratio,
    },
    snapshot_headers: headers,
    snapshot_rows: rows,
  };
}
