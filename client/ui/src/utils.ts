/** Returns a Tailwind text-color class based on the sign of the value. */
export function valColor(val: number): string {
  if (val > 0) return "text-mm-positive";
  if (val < 0) return "text-mm-negative";
  return "text-mm-neutral";
}

/** Returns an rgba background color tinted by sign (light glass palette). */
export function cellBg(val: number): string {
  if (val > 0) return "rgba(79, 91, 213, 0.06)";
  if (val < 0) return "rgba(212, 64, 92, 0.06)";
  return "transparent";
}

/** Formats an elapsed duration (ms) as a human-readable age string. */
export function formatAge(ms: number): string {
  if (ms < 1000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

/** Creates an auto-incrementing ID generator with a given prefix. */
export function createIdGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}${++counter}`;
}

/** Converts an ISO-8601 (or already-formatted DDMMMYY) expiry to DDMMMYY.
 *
 *  Crucially, ISO strings without a timezone suffix (e.g.
 *  "2026-04-22T00:00:00") are interpreted as UTC, not local. The browser's
 *  default behaviour treats them as local time and converts to UTC on
 *  `getUTCDate()`, which silently shifts the date by one for any user not
 *  in UTC — making "22APR26" appear as "21APR26" in the West and breaking
 *  the channel-by-expiry equality match against the position grid (which
 *  uses the server's pre-formatted DDMMMYY string).
 */
export function formatExpiry(input: string): string {
  // Already DDMMMYY — return upper-cased so the comparison is case-stable.
  if (/^\d{2}[A-Za-z]{3}\d{2}$/.test(input)) return input.toUpperCase();

  // Append 'Z' to naive ISO timestamps so they parse as UTC.
  const normalised = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?)?$/.test(input)
    ? `${input}${input.includes("T") ? "" : "T00:00:00"}Z`
    : input;

  try {
    const d = new Date(normalised);
    if (Number.isNaN(d.getTime())) return input;
    const day = String(d.getUTCDate()).padStart(2, "0");
    const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase();
    const yr = String(d.getUTCFullYear()).slice(2);
    return `${day}${mon}${yr}`;
  } catch {
    return input;
  }
}

const MONTH_INDEX: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Parses a DDMMMYY expiry string (e.g. "27MAR26") back into a UTC millisecond
 * timestamp. Inverse of {@link formatExpiry}, suitable for chronological
 * sorting of expiry columns. Returns NaN on malformed input.
 */
export function parseExpiry(ddmmmyy: string): number {
  if (ddmmmyy.length !== 7) return NaN;
  const day = parseInt(ddmmmyy.slice(0, 2), 10);
  const mon = MONTH_INDEX[ddmmmyy.slice(2, 5).toUpperCase()];
  const yr = parseInt(ddmmmyy.slice(5, 7), 10);
  if (Number.isNaN(day) || mon === undefined || Number.isNaN(yr)) return NaN;
  return Date.UTC(2000 + yr, mon, day);
}

/**
 * Migrate a legacy localStorage key to its new name. If the legacy key is
 * set AND the current key is absent, copy the value and delete the legacy.
 * Silent no-op if localStorage is unavailable (private mode / disabled).
 */
export function migrateLegacyStorageKey(legacy: string, current: string): void {
  try {
    const old = localStorage.getItem(legacy);
    if (old === null) return;
    if (localStorage.getItem(current) === null) {
      localStorage.setItem(current, old);
    }
    localStorage.removeItem(legacy);
  } catch {
    // ignore — private mode / storage disabled
  }
}

/** Formats a UTC timestamp (ms) as HH:MM:SS.mmm */
export function formatUtcTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Whole-string numeric regex — integers, decimals, scientific notation, with
 * an optional leading sign. Critically rejects `"27MAR26"` which `parseFloat`
 * would otherwise happily parse as `27`. Used by snapshot/CSV cell coercion.
 */
export const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Short human-friendly numeric formatter. Scientific notation for extreme
 * magnitudes (|n| ≥ 1000 or |n| < 0.001); otherwise trims trailing zeros up
 * to ``maxDecimals``. Returns ``"?"`` for non-finite input.
 */
export function formatNumber(n: number, maxDecimals = 4): string {
  if (!Number.isFinite(n)) return "?";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000 || abs < 0.001) return n.toExponential(2);
  return Number.parseFloat(n.toFixed(maxDecimals)).toString();
}

/** Fixed-decimal formatter with null/undefined sentinel for data tables. */
export function formatNullable(v: number | null | undefined, decimals = 4): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

// ---------------------------------------------------------------------------
// Position grid value accessor (shared by grid + hooks)
// ---------------------------------------------------------------------------

import type { BlockKey, BlockRow, DesiredPosition, ViewMode } from "./types";

// ---------------------------------------------------------------------------
// Block composite identity
// ---------------------------------------------------------------------------

/** Build a {@link BlockKey} from a {@link BlockRow}. */
export function blockKeyOf(row: BlockRow): BlockKey {
  return {
    blockName: row.block_name,
    streamName: row.stream_name,
    symbol: row.symbol,
    expiry: row.expiry,
    startTimestamp: row.start_timestamp,
  };
}

/** Structural equality on the full composite — `block_name` alone is
 *  not unique across dimensions, so all five fields must match. */
export function blockKeyEquals(a: BlockKey, b: BlockKey): boolean {
  return (
    a.blockName === b.blockName
    && a.streamName === b.streamName
    && a.symbol === b.symbol
    && a.expiry === b.expiry
    && a.startTimestamp === b.startTimestamp
  );
}

/** Stable string form of a {@link BlockKey} — useful as a React key or a
 *  Set/Map member when the value must be primitive. Matches the server
 *  composite: block_name|stream_name|symbol|expiry|start_timestamp. */
export function blockKeyToString(key: BlockKey): string {
  return [
    key.blockName,
    key.streamName,
    key.symbol,
    key.expiry,
    key.startTimestamp ?? "",
  ].join("|");
}

/** Pull the value for a given view mode from a ``DesiredPosition`` row. */
export function getCellValue(p: DesiredPosition, mode: ViewMode): number {
  switch (mode) {
    case "position": return p.desiredPos;
    case "rawPosition": return p.rawDesiredPos;
    case "edge": return p.edgeVol;
    case "smoothedEdge": return p.smoothedEdgeVol;
    case "variance": return p.varianceVol;
    case "smoothedVar": return p.smoothedVarVol;
    case "fair": return p.totalFairVol;
    case "smoothedFair": return p.smoothedTotalFairVol;
    // Market (src): user-entered aggregate vol, straight from the market-
    // value store. Market (calc): pipeline space-aggregation + calc→target
    // output — the value ``edge = fair − market`` is computed against.
    case "marketSource": return p.marketVol;
    case "marketCalculated": return p.totalMarketFairVol;
    case "smoothedMarketCalculated": return p.smoothedTotalMarketFairVol;
  }
}

// ---------------------------------------------------------------------------
// View-mode composition — Metric × Smoothing
// ---------------------------------------------------------------------------

/** One of the six underlying metrics on the Overview + Pipeline controls. */
export type Metric =
  | "desired"
  | "edge"
  | "variance"
  | "fair"
  | "marketCalc"
  | "marketSource";

export type Smoothing = "instant" | "smoothed";

/** Metrics where the Smoothed/Instant toggle is meaningful. `marketSource`
 *  is a user-entered scalar with no time variation, so it defaults to
 *  instant values and renders the toggle disabled. */
export const SMOOTHABLE_METRICS: readonly Metric[] = [
  "desired", "edge", "variance", "fair", "marketCalc",
];

/** Compose a {@link ViewMode} from the 2D (metric, smoothing) control
 *  surface. Metrics with no smoothed variant ignore the smoothing flag. */
export function viewModeOf(metric: Metric, smoothing: Smoothing): ViewMode {
  if (metric === "marketSource") return "marketSource";
  if (smoothing === "instant") {
    switch (metric) {
      case "desired": return "rawPosition";
      case "edge": return "edge";
      case "variance": return "variance";
      case "fair": return "fair";
      case "marketCalc": return "marketCalculated";
    }
  }
  switch (metric) {
    case "desired": return "position";
    case "edge": return "smoothedEdge";
    case "variance": return "smoothedVar";
    case "fair": return "smoothedFair";
    case "marketCalc": return "smoothedMarketCalculated";
  }
}

/** Inverse of {@link viewModeOf} — extracts (metric, smoothing) from a
 *  {@link ViewMode}. Used to hydrate the grid controls from a persisted or
 *  parent-supplied view mode so the dropdown + toggle render consistently. */
export function metricOf(mode: ViewMode): { metric: Metric; smoothing: Smoothing } {
  switch (mode) {
    case "position": return { metric: "desired", smoothing: "smoothed" };
    case "rawPosition": return { metric: "desired", smoothing: "instant" };
    case "edge": return { metric: "edge", smoothing: "instant" };
    case "smoothedEdge": return { metric: "edge", smoothing: "smoothed" };
    case "variance": return { metric: "variance", smoothing: "instant" };
    case "smoothedVar": return { metric: "variance", smoothing: "smoothed" };
    case "fair": return { metric: "fair", smoothing: "instant" };
    case "smoothedFair": return { metric: "fair", smoothing: "smoothed" };
    case "marketCalculated": return { metric: "marketCalc", smoothing: "instant" };
    case "smoothedMarketCalculated": return { metric: "marketCalc", smoothing: "smoothed" };
    case "marketSource": return { metric: "marketSource", smoothing: "instant" };
  }
}
