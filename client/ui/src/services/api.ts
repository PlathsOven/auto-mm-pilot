/**
 * Shared HTTP client helper for all API calls.
 *
 * Auth is pulled from a module-level getter registered by AuthProvider.
 * Keeping the getter here (instead of a React hook) lets non-component
 * code paths — WS reconnect logic, timers, event handlers — reach the
 * current session token without threading props through.
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

// ---------------------------------------------------------------------------
// Auth plumbing — AuthProvider registers handlers on mount
// ---------------------------------------------------------------------------

type TokenGetter = () => string | null;
type UnauthorizedHandler = () => void;

let _tokenGetter: TokenGetter = () => null;
let _onUnauthorized: UnauthorizedHandler = () => {};

export function registerAuthHandlers(
  tokenGetter: TokenGetter,
  onUnauthorized: UnauthorizedHandler,
): void {
  _tokenGetter = tokenGetter;
  _onUnauthorized = onUnauthorized;
}

export function getSessionToken(): string | null {
  return _tokenGetter();
}

function buildHeaders(init?: RequestInit): HeadersInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = _tokenGetter();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal; skipAuth?: boolean },
): Promise<T> {
  const { skipAuth, ...rest } = init ?? {};
  const headers = skipAuth
    ? { "Content-Type": "application/json", ...((rest.headers as Record<string, string>) ?? {}) }
    : buildHeaders(rest);

  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers });

  if (res.status === 401 && !skipAuth) {
    _onUnauthorized();
  }

  if (!res.ok) {
    let code: number | null = null;
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: number; message?: string };
        detail?: string | Array<{ loc?: unknown[]; msg?: string }>;
      };
      if (body.error) {
        code = body.error.code ?? null;
        message = body.error.message ?? message;
      } else if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        message = body.detail
          .map((e) => {
            const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null;
            return field ? `${field}: ${e.msg}` : (e.msg ?? "");
          })
          .filter(Boolean)
          .join("; ");
      }
    } catch {
      message = (await res.text().catch(() => "")) || `${res.status}`;
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ---------------------------------------------------------------------------
// SSE streaming (text/event-stream)
// ---------------------------------------------------------------------------

export interface SseCallbacks {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export function streamFetchSSE(
  path: string,
  payload: unknown,
  callbacks: SseCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    let response: Response;
    try {
      const headers = buildHeaders({
        method: "POST",
        body: JSON.stringify(payload),
      });
      response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        callbacks.onError(
          `Failed to connect to Posit server: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    if (response.status === 401) {
      _onUnauthorized();
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "Unknown error");
      callbacks.onError(`Server error (${response.status}): ${body}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError("No response body from server");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      let currentEvent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);

          if (currentEvent === "error") {
            callbacks.onError(`Server error: ${data}`);
            currentEvent = "";
            return;
          }
          currentEvent = "";

          if (data === "[DONE]") {
            callbacks.onDone();
            return;
          }

          try {
            callbacks.onDelta(JSON.parse(data));
          } catch {
            callbacks.onDelta(data);
          }
        }
      }
      callbacks.onDone();
    } catch (err) {
      if (!controller.signal.aborted) {
        callbacks.onError(
          `Stream interrupted: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  })();

  return controller;
}
