/**
 * HTTP client for the Stage H correlation endpoints.
 *
 *   GET    /api/correlations/symbols              — both slots
 *   PUT    /api/correlations/symbols/draft        — overwrite draft
 *   POST   /api/correlations/symbols/confirm      — promote draft → committed
 *   POST   /api/correlations/symbols/discard      — clear draft
 *   (+ same four for /api/correlations/expiries)
 *
 * All paths are session-token auth — no API key surface.
 */

import type {
  ExpiryCorrelationListResponse,
  SetExpiryCorrelationsRequest,
  SetSymbolCorrelationsRequest,
  SymbolCorrelationListResponse,
} from "../types";
import { apiFetch } from "./api";

// ---------------------------------------------------------------------------
// Symbol correlations
// ---------------------------------------------------------------------------

export async function listSymbolCorrelations(): Promise<SymbolCorrelationListResponse> {
  return apiFetch<SymbolCorrelationListResponse>("/api/correlations/symbols");
}

export async function setSymbolCorrelationsDraft(
  req: SetSymbolCorrelationsRequest,
): Promise<SymbolCorrelationListResponse> {
  return apiFetch<SymbolCorrelationListResponse>(
    "/api/correlations/symbols/draft",
    { method: "PUT", body: JSON.stringify(req) },
  );
}

export async function confirmSymbolCorrelations(): Promise<SymbolCorrelationListResponse> {
  return apiFetch<SymbolCorrelationListResponse>(
    "/api/correlations/symbols/confirm",
    { method: "POST" },
  );
}

export async function discardSymbolCorrelations(): Promise<SymbolCorrelationListResponse> {
  return apiFetch<SymbolCorrelationListResponse>(
    "/api/correlations/symbols/discard",
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Expiry correlations
// ---------------------------------------------------------------------------

export async function listExpiryCorrelations(): Promise<ExpiryCorrelationListResponse> {
  return apiFetch<ExpiryCorrelationListResponse>("/api/correlations/expiries");
}

export async function setExpiryCorrelationsDraft(
  req: SetExpiryCorrelationsRequest,
): Promise<ExpiryCorrelationListResponse> {
  return apiFetch<ExpiryCorrelationListResponse>(
    "/api/correlations/expiries/draft",
    { method: "PUT", body: JSON.stringify(req) },
  );
}

export async function confirmExpiryCorrelations(): Promise<ExpiryCorrelationListResponse> {
  return apiFetch<ExpiryCorrelationListResponse>(
    "/api/correlations/expiries/confirm",
    { method: "POST" },
  );
}

export async function discardExpiryCorrelations(): Promise<ExpiryCorrelationListResponse> {
  return apiFetch<ExpiryCorrelationListResponse>(
    "/api/correlations/expiries/discard",
    { method: "POST" },
  );
}
