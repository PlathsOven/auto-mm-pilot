import { useMemo, useRef } from "react";
import type { DesiredPosition } from "../types";
import { HIGHLIGHT_DURATION_MS, TIMEFRAME_OPTIONS } from "../components/grid-config";
import type { TimeframeLabel } from "../components/grid-config";
import { parseExpiry } from "../utils";

interface HistoryEntry {
  value: number;
  timestamp: number;
}

/**
 * Tracks per-cell position history in a ref and derives the grid data
 * (assets, expiries, cell map, recently-updated keys) on every tick.
 */
export function usePositionHistory(
  positions: DesiredPosition[],
  timeframe: TimeframeLabel,
) {
  const historyRef = useRef<Map<string, HistoryEntry[]>>(new Map());

  return useMemo(() => {
    const now = Date.now();
    const assetSet = new Set<string>();
    const expirySet = new Set<string>();
    const gridMap = new Map<string, { pos: DesiredPosition; change: number }>();
    const recent = new Set<string>();

    for (const p of positions) {
      assetSet.add(p.asset);
      expirySet.add(p.expiry);
      const key = `${p.asset}-${p.expiry}`;

      const history = historyRef.current.get(key) ?? [];
      history.push({ value: p.desiredPos, timestamp: now });
      if (history.length > 500) history.splice(0, history.length - 500);
      historyRef.current.set(key, history);

      let change = p.changeMagnitude;
      const tfOption = TIMEFRAME_OPTIONS.find((t) => t.label === timeframe);
      if (tfOption && tfOption.ms > 0) {
        const cutoff = now - tfOption.ms;
        const baseline = history.find((h) => h.timestamp >= cutoff);
        if (baseline) {
          change = +(p.desiredPos - baseline.value).toFixed(3);
        }
      }

      gridMap.set(key, { pos: p, change });

      if (now - p.updatedAt < HIGHLIGHT_DURATION_MS) {
        recent.add(key);
      }
    }

    return {
      assets: Array.from(assetSet).sort(),
      // Sort expiries chronologically so React's key-based reconciliation
      // keeps cell DOM nodes stable across WS ticks. Without this, the
      // 350 ms hover timer that drives the stream-attribution tooltip in
      // DesiredPositionGrid is cancelled by remounts on every tick.
      expiries: Array.from(expirySet).sort((a, b) => parseExpiry(a) - parseExpiry(b)),
      grid: gridMap,
      recentKeys: recent,
    };
  }, [positions, timeframe]);
}
