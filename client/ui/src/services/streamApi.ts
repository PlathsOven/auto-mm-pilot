/**
 * HTTP client for the stream registry & ingestion API.
 *
 * Endpoints:
 *   POST   /api/streams                — Create a stream
 *   GET    /api/streams                — List all streams
 *   PATCH  /api/streams/{name}         — Update stream name/key_cols
 *   DELETE /api/streams/{name}         — Delete a stream
 *   POST   /api/snapshots              — Ingest snapshot rows
 *   POST   /api/market-pricing         — Update market pricing
 *   PATCH  /api/config/bankroll        — Set bankroll
 */

import type {
  BankrollResponse,
  BlockConfigPayload,
  RegisteredStream,
  SnapshotResponse,
} from "../types";
import { apiFetch } from "./api";

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

export async function deleteStream(streamName: string): Promise<void> {
  return apiFetch<void>(`/api/streams/${encodeURIComponent(streamName)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Stream activation (PENDING → READY)
// ---------------------------------------------------------------------------

export interface ConfigureStreamRequest {
  scale: number;
  offset: number;
  exponent: number;
  block: BlockConfigPayload;
  description?: string | null;
  sample_csv?: string | null;
  value_column?: string | null;
  /** (symbol, expiry) pairs this stream's blocks fan out to. null = every pair. */
  applies_to?: [string, string][] | null;
}

/**
 * Apply pipeline-facing parameters and transition a PENDING stream to READY.
 *
 * Backed by `POST /api/streams/{name}/configure` (formerly only reachable
 * from the admin HTML). Used by Studio Stream Canvas's Activate button.
 */
export async function configureStream(
  streamName: string,
  payload: ConfigureStreamRequest,
): Promise<RegisteredStream> {
  return apiFetch<RegisteredStream>(
    `/api/streams/${encodeURIComponent(streamName)}/configure`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

// ---------------------------------------------------------------------------
// Snapshot ingestion
// ---------------------------------------------------------------------------

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
// Bankroll
// ---------------------------------------------------------------------------

export async function fetchBankroll(): Promise<number> {
  const data = await apiFetch<BankrollResponse>("/api/config/bankroll");
  return data.bankroll;
}

export async function updateBankroll(
  bankroll: number,
): Promise<BankrollResponse> {
  return apiFetch<BankrollResponse>("/api/config/bankroll", {
    method: "PATCH",
    body: JSON.stringify({ bankroll }),
  });
}
