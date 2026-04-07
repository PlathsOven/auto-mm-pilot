import { useMemo } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import { useActivePositionSizing } from "./useActivePositionSizing";

/**
 * Derives the server-side bankroll by inverting the active position_sizing
 * formula on any non-zero position in the WS payload.
 *
 * The server uses the same bankroll for every position, so any non-zero
 * (smoothedEdge, smoothedVar, desiredPos) tuple yields the exact value.
 *
 * Why inversion instead of a dedicated `GET /api/config/bankroll` endpoint?
 * Phase 1 is intentionally additive on the client only — bankroll editing
 * lands in Studio Pipeline (Phase 3), which is when an authoritative GET
 * endpoint becomes worthwhile. Until then, inversion is mathematically exact
 * and avoids touching the server.
 *
 * Returns NaN if no usable position exists yet (all zero, or no payload).
 */
export function useDerivedBankroll(): number {
  const { payload } = useWebSocket();
  const positionSizing = useActivePositionSizing();

  return useMemo(() => {
    if (!payload || !positionSizing) return NaN;

    for (const p of payload.positions) {
      const edge = p.smoothedEdge;
      const variance = p.smoothedVar;
      const position = p.desiredPos;
      if (edge === 0 || variance === 0 || position === 0) continue;

      switch (positionSizing.name) {
        case "kelly":
          return (position * variance) / edge;
        case "power_utility": {
          const gamma =
            typeof positionSizing.params.risk_aversion === "number"
              ? (positionSizing.params.risk_aversion as number)
              : 2.0;
          return (position * gamma * variance) / edge;
        }
        default:
          // Unknown sizing rule — can't invert. Caller will use a fallback caption.
          return NaN;
      }
    }
    return NaN;
  }, [payload, positionSizing]);
}
