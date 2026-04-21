import { useMemo } from "react";
import type { DesiredPosition } from "../types";
import { HIGHLIGHT_DURATION_MS } from "../constants";
import { parseExpiry } from "../utils";

/**
 * Derives the grid data (symbols, expiries, cell map, recently-updated
 * keys) from the latest positions payload.
 */
export function usePositionHistory(positions: DesiredPosition[]) {
  return useMemo(() => {
    const now = Date.now();
    const symbolSet = new Set<string>();
    const expirySet = new Set<string>();
    const gridMap = new Map<string, DesiredPosition>();
    const recent = new Set<string>();

    for (const p of positions) {
      symbolSet.add(p.symbol);
      expirySet.add(p.expiry);
      const key = `${p.symbol}-${p.expiry}`;
      gridMap.set(key, p);

      if (now - p.updatedAt < HIGHLIGHT_DURATION_MS) {
        recent.add(key);
      }
    }

    return {
      symbols: Array.from(symbolSet).sort(),
      // Sort expiries chronologically so React's key-based reconciliation
      // keeps cell DOM nodes stable across WS ticks. Without this, the
      // 350 ms hover timer that drives the stream-attribution tooltip in
      // DesiredPositionGrid is cancelled by remounts on every tick.
      expiries: Array.from(expirySet).sort((a, b) => parseExpiry(a) - parseExpiry(b)),
      grid: gridMap,
      recentKeys: recent,
    };
  }, [positions]);
}
