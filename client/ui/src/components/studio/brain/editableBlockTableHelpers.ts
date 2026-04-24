import type { BlockRow } from "../../../types";
import { formatNullable } from "../../../utils";

/**
 * A family groups all per-dim rows sharing (stream_name, block_name). The
 * Block Inspector's default view renders one row per family with a fair/var
 * range summary; expansion shows the per-dim rows underneath.
 */
export interface BlockFamily {
  key: string;                 // "stream|block"
  block_name: string;
  stream_name: string;
  source: "stream" | "manual";
  dims: BlockRow[];
  symbols: string[];
  expiries: string[];
  fair_min: number | null;
  fair_max: number | null;
  var_min: number | null;
  var_max: number | null;
}

/** True when any of the block's identity columns contains the query substring. */
export function matchesGlobalFilter(b: BlockRow, q: string): boolean {
  return (
    b.block_name.toLowerCase().includes(q) ||
    b.stream_name.toLowerCase().includes(q) ||
    b.symbol.toLowerCase().includes(q) ||
    b.expiry.toLowerCase().includes(q) ||
    b.space_id.toLowerCase().includes(q)
  );
}

/** Collapse per-dim rows into {@link BlockFamily} rollups. Stable order. */
export function groupIntoFamilies(blocks: BlockRow[]): BlockFamily[] {
  const map = new Map<string, BlockFamily>();
  for (const b of blocks) {
    const key = `${b.stream_name}|${b.block_name}`;
    let fam = map.get(key);
    if (!fam) {
      fam = {
        key,
        block_name: b.block_name,
        stream_name: b.stream_name,
        source: b.source,
        dims: [],
        symbols: [],
        expiries: [],
        fair_min: null,
        fair_max: null,
        var_min: null,
        var_max: null,
      };
      map.set(key, fam);
    }
    fam.dims.push(b);
    if (!fam.symbols.includes(b.symbol)) fam.symbols.push(b.symbol);
    if (!fam.expiries.includes(b.expiry)) fam.expiries.push(b.expiry);
    if (b.fair != null) {
      fam.fair_min = fam.fair_min == null ? b.fair : Math.min(fam.fair_min, b.fair);
      fam.fair_max = fam.fair_max == null ? b.fair : Math.max(fam.fair_max, b.fair);
    }
    if (b.var != null) {
      fam.var_min = fam.var_min == null ? b.var : Math.min(fam.var_min, b.var);
      fam.var_max = fam.var_max == null ? b.var : Math.max(fam.var_max, b.var);
    }
  }
  for (const fam of map.values()) {
    fam.symbols.sort();
    fam.expiries.sort();
    fam.dims.sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      if (a.expiry !== b.expiry) return a.expiry.localeCompare(b.expiry);
      return a.space_id.localeCompare(b.space_id);
    });
  }
  return Array.from(map.values());
}

/** Human-readable one-liner for the Dims column — collapses the family's
 *  per-dim list to a count sentence or the single concrete dim when
 *  height is one. */
export function formatDimsSummary(fam: BlockFamily): string {
  const symCount = fam.symbols.length;
  const expCount = fam.expiries.length;
  const total = fam.dims.length;
  if (total === 1) return `${fam.symbols[0]} · ${fam.expiries[0]}`;
  return `${symCount} ${plural("symbol", symCount)} × ${expCount} ${plural("expiry", expCount)} · ${total} ${plural("dim", total)}`;
}

function plural(word: string, n: number): string {
  if (n === 1) return word;
  if (word === "expiry") return "expiries";
  return `${word}s`;
}

/** Compact fair/var range label — collapses to a single value when the
 *  family has one dim or when every dim agrees. */
export function formatRange(lo: number | null, hi: number | null): string {
  if (lo == null && hi == null) return "—";
  if (lo == null || hi == null) return formatNullable(lo ?? hi);
  if (lo === hi) return formatNullable(lo);
  return `${formatNullable(lo)}…${formatNullable(hi)}`;
}
