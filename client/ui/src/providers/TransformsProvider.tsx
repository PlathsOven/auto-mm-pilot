import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TransformStep } from "../types";
import { fetchTransforms } from "../services/transformApi";
import { fetchBankroll } from "../services/streamApi";

const POLL_INTERVAL_MS = 10000;

interface TransformsContextValue {
  /** Map of step key (e.g. "position_sizing") → step state, or null until first load. */
  steps: Record<string, TransformStep> | null;
  /** Current server bankroll, or NaN until first load. */
  bankroll: number;
  loading: boolean;
  error: string | null;
  /** Force an immediate refetch — call after a save in Studio Pipeline. */
  refresh: () => Promise<void>;
}

const TransformsContext = createContext<TransformsContextValue | null>(null);

/**
 * Caches server-side pipeline configuration for the UI.
 *
 * Fetches both `/api/transforms` (the step registry with selected transform,
 * params, and symbolic formula strings) and `/api/config/bankroll` (the
 * scalar used by position sizing) in a single poll loop so consumers have a
 * consistent view.
 */
export function TransformsProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<Record<string, TransformStep> | null>(null);
  const [bankroll, setBankroll] = useState<number>(NaN);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [transformsRes, bankrollValue] = await Promise.all([
        fetchTransforms(),
        fetchBankroll(),
      ]);
      setSteps(transformsRes.steps);
      setBankroll(bankrollValue);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo(
    () => ({ steps, bankroll, loading, error, refresh }),
    [steps, bankroll, loading, error, refresh],
  );

  return (
    <TransformsContext.Provider value={value}>
      {children}
    </TransformsContext.Provider>
  );
}

export function useTransforms() {
  const ctx = useContext(TransformsContext);
  if (!ctx) throw new Error("useTransforms must be used within TransformsProvider");
  return ctx;
}
