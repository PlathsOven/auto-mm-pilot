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

export async function fetchDimensions(): Promise<TimeSeriesDimension[]> {
  const data = await apiFetch<{ dimensions: TimeSeriesDimension[] }>(
    "/api/pipeline/dimensions",
  );
  return data.dimensions;
}

export async function fetchTimeSeries(
  symbol: string,
  expiry: string,
): Promise<PipelineTimeSeriesResponse> {
  const params = new URLSearchParams({ symbol, expiry });
  return apiFetch<PipelineTimeSeriesResponse>(
    `/api/pipeline/timeseries?${params}`,
  );
}
