import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { TransformStep } from "../types";
import { fetchTransforms } from "../services/transformApi";

const POLL_INTERVAL_MS = 10000;

interface TransformsContextValue {
  /** Map of step key (e.g. "position_sizing") → step state, or null until first load. */
  steps: Record<string, TransformStep> | null;
  loading: boolean;
  error: string | null;
  /** Force an immediate refetch — call after a save in Studio Pipeline. */
  refresh: () => Promise<void>;
}

const TransformsContext = createContext<TransformsContextValue | null>(null);

export function TransformsProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<Record<string, TransformStep> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchTransforms();
      setSteps(res.steps);
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

  return (
    <TransformsContext.Provider value={{ steps, loading, error, refresh }}>
      {children}
    </TransformsContext.Provider>
  );
}

export function useTransforms() {
  const ctx = useContext(TransformsContext);
  if (!ctx) throw new Error("useTransforms must be used within TransformsProvider");
  return ctx;
}
