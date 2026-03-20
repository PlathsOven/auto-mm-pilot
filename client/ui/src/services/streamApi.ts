/**
 * HTTP client for the stream registry & ingestion API.
 *
 * Endpoints:
 *   POST   /api/streams                — Create a stream
 *   GET    /api/streams                — List all streams
 *   PATCH  /api/streams/{name}         — Update stream name/key_cols
 *   POST   /api/streams/{name}/configure — Admin: set pipeline params
 *   DELETE /api/streams/{name}         — Delete a stream
 *   POST   /api/snapshots              — Ingest snapshot rows
 *   POST   /api/market-pricing         — Update market pricing
 *   PATCH  /api/config/bankroll        — Set bankroll
 */

import { API_BASE } from "../config";
import type {
  RegisteredStream,
  BlockConfigPayload,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "Unknown error");
    throw new Error(`${res.status}: ${body}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ---------------------------------------------------------------------------
// Stream CRUD
// ---------------------------------------------------------------------------

export async function createStream(
  streamName: string,
  keyCols: string[],
): Promise<RegisteredStream> {
  return apiFetch<RegisteredStream>("/api/streams", {
    method: "POST",
    body: JSON.stringify({ stream_name: streamName, key_cols: keyCols }),
  });
}

export async function listStreams(): Promise<RegisteredStream[]> {
  const data = await apiFetch<{ streams: RegisteredStream[] }>("/api/streams");
  return data.streams;
}

export async function updateStream(
  currentName: string,
  patch: { stream_name?: string; key_cols?: string[] },
): Promise<RegisteredStream> {
  return apiFetch<RegisteredStream>(`/api/streams/${encodeURIComponent(currentName)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function configureStream(
  streamName: string,
  config: {
    scale: number;
    offset: number;
    exponent: number;
    block: BlockConfigPayload;
  },
): Promise<RegisteredStream> {
  return apiFetch<RegisteredStream>(
    `/api/streams/${encodeURIComponent(streamName)}/configure`,
    { method: "POST", body: JSON.stringify(config) },
  );
}

export async function deleteStream(streamName: string): Promise<void> {
  return apiFetch<void>(`/api/streams/${encodeURIComponent(streamName)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Snapshot ingestion
// ---------------------------------------------------------------------------

export interface SnapshotResponse {
  stream_name: string;
  rows_accepted: number;
  pipeline_rerun: boolean;
}

export async function ingestSnapshot(
  streamName: string,
  rows: Record<string, unknown>[],
): Promise<SnapshotResponse> {
  return apiFetch<SnapshotResponse>("/api/snapshots", {
    method: "POST",
    body: JSON.stringify({ stream_name: streamName, rows }),
  });
}

// ---------------------------------------------------------------------------
// Market pricing
// ---------------------------------------------------------------------------

export interface MarketPricingResponse {
  spaces_updated: number;
  pipeline_rerun: boolean;
}

export async function updateMarketPricing(
  pricing: Record<string, number>,
): Promise<MarketPricingResponse> {
  return apiFetch<MarketPricingResponse>("/api/market-pricing", {
    method: "POST",
    body: JSON.stringify({ pricing }),
  });
}

// ---------------------------------------------------------------------------
// Bankroll
// ---------------------------------------------------------------------------

export interface BankrollResponse {
  bankroll: number;
  pipeline_rerun: boolean;
}

export async function updateBankroll(
  bankroll: number,
): Promise<BankrollResponse> {
  return apiFetch<BankrollResponse>("/api/config/bankroll", {
    method: "PATCH",
    body: JSON.stringify({ bankroll }),
  });
}
