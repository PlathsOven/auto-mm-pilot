import { useState, useEffect, useCallback, useRef } from "react";
import type {
  TimeSeriesDimension,
  PipelineTimeSeriesResponse,
} from "../types";
import { fetchDimensions, fetchTimeSeries } from "../services/pipelineApi";
import { dimensionKey, formatExpiry } from "../utils";
import {
  POLL_INTERVAL_TIMESERIES_MS,
  PIPELINE_TIMESERIES_CACHE_MAX_ENTRIES,
} from "../constants";

// ---------------------------------------------------------------------------
// Module-level LRU cache for time series responses
// ---------------------------------------------------------------------------
//
// Survives PipelineChart unmount/remount cycles so switching tabs back to
// Brain re-displays the previous instrument synchronously instead of going
// through "pipeline is loading". The polling effect refreshes cache entries
// in the background so cached data never goes more than ~5s stale.

const tsCache = new Map<string, PipelineTimeSeriesResponse>();

function tsCacheSet(key: string, value: PipelineTimeSeriesResponse): void {
  // Re-insert to mark as most-recently-used (Map preserves insertion order).
  if (tsCache.has(key)) tsCache.delete(key);
  tsCache.set(key, value);
  while (tsCache.size > PIPELINE_TIMESERIES_CACHE_MAX_ENTRIES) {
    const oldest = tsCache.keys().next().value;
    if (oldest === undefined) break;
    tsCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface SelectedDimension {
  symbol: string;
  expiry: string;
}

export function usePipelineTimeSeries(
  selectedDimension: SelectedDimension | null,
  lookbackSeconds: number | null = null,
) {
  const [dimensions, setDimensions] = useState<TimeSeriesDimension[]>([]);
  const [selected, setSelected] = useState<TimeSeriesDimension | null>(null);
  const [data, setData] = useState<PipelineTimeSeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRequestedKeyRef = useRef<string | null>(null);

  // Loading is derived from state, not stored.
  const loading = data === null && error === null;

  // Fetch available dimensions on mount + poll
  const doFetchDims = useCallback((signal: AbortSignal) => {
    fetchDimensions(signal)
      .then((dims) => {
        if (signal.aborted) return;
        setDimensions(dims);
        setSelected((prev) => {
          if (!prev && dims.length > 0) return dims[0];
          if (prev && !dims.some((d) => d.symbol === prev.symbol && d.expiry === prev.expiry)) {
            return dims.length > 0 ? dims[0] : null;
          }
          return prev;
        });
      })
      .catch((err) => {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    doFetchDims(controller.signal);
    const interval = setInterval(() => doFetchDims(controller.signal), POLL_INTERVAL_TIMESERIES_MS);
    return () => { controller.abort(); clearInterval(interval); };
  }, [doFetchDims]);

  // Fetch time series on selection change + poll every 5s to track ticks.
  useEffect(() => {
    if (!selected) return;
    const cacheKey = dimensionKey(selected.symbol, selected.expiry, lookbackSeconds);
    lastRequestedKeyRef.current = cacheKey;
    setError(null);

    // Cache hit: hydrate synchronously. Cache miss: clear data so the
    // loading placeholder shows while the network request resolves.
    const cached = tsCache.get(cacheKey);
    setData(cached ?? null);

    const controller = new AbortController();

    const doFetch = () => {
      fetchTimeSeries(selected.symbol, selected.expiry, lookbackSeconds, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          if (lastRequestedKeyRef.current !== cacheKey) return;
          tsCacheSet(cacheKey, res);
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

  // Auto-switch dimension when block channelling selects a different instrument
  useEffect(() => {
    if (!selectedDimension || dimensions.length === 0) return;
    const targetExpiry = selectedDimension.expiry;
    const match = dimensions.find(
      (d) => d.symbol === selectedDimension.symbol && formatExpiry(d.expiry) === targetExpiry,
    );
    if (match && (!selected || match.symbol !== selected.symbol || match.expiry !== selected.expiry)) {
      setSelected(match);
    }
  }, [selectedDimension, dimensions, selected]);

  return { dimensions, selected, setSelected, data, error, loading };
}
