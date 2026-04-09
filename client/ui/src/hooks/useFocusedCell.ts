import { useMemo } from "react";
import { useSelection } from "../providers/SelectionProvider";
import { useWebSocket } from "../providers/WebSocketProvider";
import type { DesiredPosition } from "../types";

export interface FocusedCell {
  symbol: string;
  expiry: string;
  position: DesiredPosition;
}

/**
 * Derives the currently-focused (asset, expiry) cell from SelectionProvider
 * + the latest WS payload. Returns null if no dimension is selected or the
 * matching position isn't yet present in the payload.
 *
 * Driven by `selectDimension()` calls in `DesiredPositionGrid`, so a click on
 * any cell propagates here for the equation strip / hover-cards / Lens.
 */
export function useFocusedCell(): FocusedCell | null {
  const { selectedDimension } = useSelection();
  const { payload } = useWebSocket();

  return useMemo(() => {
    if (!selectedDimension || !payload) return null;
    const { symbol, expiry } = selectedDimension;
    const position = payload.positions.find(
      (p) => p.symbol === symbol && p.expiry === expiry,
    );
    if (!position) return null;
    return { symbol, expiry, position };
  }, [selectedDimension, payload]);
}
