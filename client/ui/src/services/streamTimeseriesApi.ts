import type { StreamTimeseriesResponse } from "../types";
import { apiFetch } from "./api";

/** Fetch per-key time series for a registered stream. */
export async function fetchStreamTimeseries(
  streamName: string,
  signal?: AbortSignal,
): Promise<StreamTimeseriesResponse> {
  return apiFetch<StreamTimeseriesResponse>(
    `/api/streams/${encodeURIComponent(streamName)}/timeseries`,
    { signal },
  );
}
