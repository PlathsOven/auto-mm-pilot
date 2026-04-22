/**
 * HTTP client for pipeline time series endpoints.
 *
 * Endpoints:
 *   GET  /api/pipeline/dimensions     — Available symbol/expiry pairs
 *   GET  /api/pipeline/timeseries     — Full block + aggregated time series
 *   GET  /api/pipeline/contributions  — Per-space calc-space stack for a
 *                                       unified (now − lookback → expiry)
 *                                       axis — backs the Contributions tab.
 */

import type {
  TimeSeriesDimension,
  PipelineTimeSeriesResponse,
  PipelineContributionsResponse,
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

export async function fetchContributions(
  symbol: string,
  expiry: string,
  lookbackSeconds: number | null,
  signal?: AbortSignal,
): Promise<PipelineContributionsResponse> {
  const params = new URLSearchParams({ symbol, expiry });
  if (lookbackSeconds !== null && lookbackSeconds > 0) {
    params.set("lookback_seconds", String(lookbackSeconds));
  }
  return apiFetch<PipelineContributionsResponse>(
    `/api/pipeline/contributions?${params}`,
    { signal },
  );
}
