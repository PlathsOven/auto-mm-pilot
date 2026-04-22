import { useEffect, useRef, useState } from "react";
import type { PipelineContributionsResponse } from "../types";
import { fetchContributions } from "../services/pipelineApi";
import { dimensionKey } from "../utils";
import {
  POLL_INTERVAL_TIMESERIES_MS,
  PIPELINE_TIMESERIES_CACHE_MAX_ENTRIES,
} from "../constants";

// Module-level LRU cache, scoped separately from the timeseries hook's
// cache — the two endpoints have different response shapes and either
// can be invalidated independently when we extend them later.
const cache = new Map<string, PipelineContributionsResponse>();

function cacheSet(key: string, value: PipelineContributionsResponse): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > PIPELINE_TIMESERIES_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

interface SelectedDimension {
  symbol: string;
  expiry: string;
}

/** Contributions-tab data source — fetches ``/api/pipeline/contributions``
 *  for the selected ``(symbol, expiry)`` and polls on the shared interval.
 *
 *  The Contributions tab reuses the same ``POSITION_LOOKBACK_OPTIONS`` the
 *  Metric tab uses for its Position view, so the caller passes the
 *  resolved seconds straight through.
 */
export function usePipelineContributions(
  selected: SelectedDimension | null,
  lookbackSeconds: number | null,
) {
  const [data, setData] = useState<PipelineContributionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRequestedKeyRef = useRef<string | null>(null);

  const loading = data === null && error === null;

  useEffect(() => {
    if (!selected) {
      setData(null);
      setError(null);
      return;
    }
    const cacheKey = dimensionKey(selected.symbol, selected.expiry, lookbackSeconds);
    lastRequestedKeyRef.current = cacheKey;
    setError(null);
    const cached = cache.get(cacheKey);
    setData(cached ?? null);

    const controller = new AbortController();

    const doFetch = () => {
      fetchContributions(selected.symbol, selected.expiry, lookbackSeconds, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          if (lastRequestedKeyRef.current !== cacheKey) return;
          cacheSet(cacheKey, res);
          setData(res);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (lastRequestedKeyRef.current !== cacheKey) return;
          setError(err instanceof Error ? err.message : String(err));
        });
    };

    doFetch();
    const interval = setInterval(doFetch, POLL_INTERVAL_TIMESERIES_MS);

    return () => { controller.abort(); clearInterval(interval); };
  }, [selected, lookbackSeconds]);

  return { data, error, loading };
}
