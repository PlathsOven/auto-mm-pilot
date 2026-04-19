/**
 * HTTP client for pipeline time series endpoints.
 *
 * Endpoints:
 *   GET  /api/pipeline/dimensions   — Available symbol/expiry pairs
 *   GET  /api/pipeline/timeseries   — Full block + aggregated time series
 */

import type {
  TimeSeriesDimension,
  PipelineTimeSeriesResponse,
} from "../types";
import { apiFetch } from "./api";

export async function fetchDimensions(signal?: AbortSignal): Promise<TimeSeriesDimension[]> {
  const data = await apiFetch<{ dimensions: TimeSeriesDimension[] }>(
    "/api/pipeline/dimensions",
    { signal },
  );
  return data.dimensions;
}

export async function fetchTimeSeries(
  symbol: string,
  expiry: string,
  lookbackSeconds: number | null,
  signal?: AbortSignal,
): Promise<PipelineTimeSeriesResponse> {
  const params = new URLSearchParams({ symbol, expiry });
  if (lookbackSeconds !== null && lookbackSeconds > 0) {
    params.set("lookback_seconds", String(lookbackSeconds));
  }
  return apiFetch<PipelineTimeSeriesResponse>(
    `/api/pipeline/timeseries?${params}`,
    { signal },
  );
}
