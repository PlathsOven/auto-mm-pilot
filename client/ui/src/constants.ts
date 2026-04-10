/** UI constants. Any magic number that appears inline in a component belongs here. */

export const POLL_INTERVAL_TRANSFORMS_MS = 10_000;
export const POLL_INTERVAL_BLOCKS_MS = 5_000;
export const POLL_INTERVAL_TIMESERIES_MS = 5_000;
export const POLL_INTERVAL_SELECTION_MS = 5_000;

export const HOVER_DELAY_MS = 350;

export const SIDEBAR_DEFAULT_WIDTH_PX = 176;
export const SIDEBAR_MIN_WIDTH_PX = 120;
export const SIDEBAR_MAX_WIDTH_PX = 400;

export const UPDATE_HISTORY_MAX_LENGTH = 100;
export const GLOBAL_CONTEXT_TICK_MS = 47;

// ---------------------------------------------------------------------------
// Block canvas — color palette + formatting
// ---------------------------------------------------------------------------

/** Distinct, saturated colors for block decomposition. Same color in both
 *  canvas lanes and in the Block Inspector table. */
export const BLOCK_COLORS = [
  "#00cc96", // green
  "#4f5bd5", // indigo
  "#ef553b", // red
  "#ab63fa", // purple
  "#ffa15a", // orange
  "#19d3f3", // cyan
  "#ff6692", // pink
  "#b6e880", // lime
  "#ff97ff", // magenta
  "#fecb52", // yellow
];

/** Scientific notation formatter for small / large numbers. */
export function sci(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 0.01 && abs < 1e6) return v.toFixed(6);
  return v.toExponential(3);
}
