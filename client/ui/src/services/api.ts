/**
 * Shared HTTP client helper for all API calls.
 *
 * Every service module should import `apiFetch` from here instead of
 * duplicating fetch + error handling logic.
 */

import { API_BASE } from "../config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let code: number | null = null;
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: number; message?: string } };
      if (body.error) {
        code = body.error.code ?? null;
        message = body.error.message ?? message;
      }
    } catch {
      // Body isn't JSON — fall back to raw text
      message = (await res.text().catch(() => "")) || `${res.status}`;
    }
    throw new ApiError(res.status, code, message);
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}
