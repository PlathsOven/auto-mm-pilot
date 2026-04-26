/**
 * HTTP client for the Stage H correlation endpoints.
 *
 *   GET    /api/correlations/symbols              — both slots
 *   PUT    /api/correlations/symbols/draft        — overwrite draft
 *   POST   /api/correlations/symbols/confirm      — promote draft → committed
 *   POST   /api/correlations/symbols/discard      — clear draft
 *   (+ same four for /api/correlations/expiries)
 *   GET    /api/correlations/expiries/methods     — calculator library
 *   POST   /api/correlations/expiries/apply-method — run calculator → draft
 *
 * All paths are session-token auth — no API key surface.
 */

import type {
  ApplyExpiryCorrelationMethodRequest,
  ExpiryCorrelationListResponse,
  ExpiryCorrelationMethodsResponse,
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

// ---------------------------------------------------------------------------
// Expiry correlation calculator library
// ---------------------------------------------------------------------------

export async function listExpiryCorrelationMethods(): Promise<ExpiryCorrelationMethodsResponse> {
  return apiFetch<ExpiryCorrelationMethodsResponse>(
    "/api/correlations/expiries/methods",
  );
}

export async function applyExpiryCorrelationMethod(
  req: ApplyExpiryCorrelationMethodRequest,
): Promise<ExpiryCorrelationListResponse> {
  return apiFetch<ExpiryCorrelationListResponse>(
    "/api/correlations/expiries/apply-method",
    { method: "POST", body: JSON.stringify(req) },
  );
}
