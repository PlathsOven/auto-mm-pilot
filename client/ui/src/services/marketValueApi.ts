/**
 * HTTP client for aggregate market value endpoints.
 *
 * Endpoints:
 *   GET    /api/market-values              — List all aggregate market values
 *   PUT    /api/market-values              — Batch-set entries
 *   DELETE /api/market-values/:symbol/:exp — Remove one entry
 */

import type { MarketValueEntry, MarketValueListResponse } from "../types";
import { apiFetch } from "./api";

export async function fetchMarketValues(
  signal?: AbortSignal,
): Promise<MarketValueEntry[]> {
  const data = await apiFetch<MarketValueListResponse>(
    "/api/market-values",
    { signal },
  );
  return data.entries;
}

export async function setMarketValues(
  entries: MarketValueEntry[],
): Promise<MarketValueEntry[]> {
  const data = await apiFetch<MarketValueListResponse>(
    "/api/market-values",
    {
      method: "PUT",
      body: JSON.stringify({ entries }),
    },
  );
  return data.entries;
}

export async function deleteMarketValue(
  symbol: string,
  expiry: string,
): Promise<void> {
  await apiFetch<{ deleted: boolean }>(
    `/api/market-values/${encodeURIComponent(symbol)}/${encodeURIComponent(expiry)}`,
    { method: "DELETE" },
  );
}
