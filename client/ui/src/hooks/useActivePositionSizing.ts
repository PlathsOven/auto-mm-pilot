import { useMemo } from "react";
import { useTransforms } from "../providers/TransformsProvider";

export interface ActivePositionSizing {
  /** Selected transform name, e.g. "kelly" or "power_utility". */
  name: string;
  /** Param values currently set on that transform. */
  params: Record<string, unknown>;
}

/**
 * Returns the currently-selected `position_sizing` transform from the
 * TransformsProvider cache. Returns null until the first /api/transforms
 * fetch resolves.
 */
export function useActivePositionSizing(): ActivePositionSizing | null {
  const { steps } = useTransforms();
  return useMemo(() => {
    const ps = steps?.position_sizing;
    if (!ps) return null;
    return { name: ps.selected, params: ps.params };
  }, [steps]);
}
