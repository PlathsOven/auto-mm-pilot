import { useState, useRef, useCallback, useEffect } from "react";
import { HOVER_DELAY_MS } from "../constants";

export function usePositionHover() {
  const [hoverCell, setHoverCell] = useState<{ symbol: string; expiry: string; key: string } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const onMouseEnter = useCallback((symbol: string, expiry: string, key: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverCell({ symbol, expiry, key });
    }, HOVER_DELAY_MS);
  }, []);

  const onMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoverCell(null);
  }, []);

  return { hoverCell, onMouseEnter, onMouseLeave };
}
