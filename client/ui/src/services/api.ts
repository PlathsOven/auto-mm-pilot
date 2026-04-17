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
      const body = (await res.json()) as {
        error?: { code?: number; message?: string };
        detail?: string | Array<{ loc?: unknown[]; msg?: string }>;
      };
      if (body.error) {
        code = body.error.code ?? null;
        message = body.error.message ?? message;
      } else if (typeof body.detail === "string") {
        // FastAPI HTTPException shape: { "detail": "..." }
        message = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        // FastAPI RequestValidationError shape: { "detail": [{ loc, msg, type }] }
        message = body.detail
          .map((e) => {
            const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null;
            return field ? `${field}: ${e.msg}` : (e.msg ?? "");
          })
          .filter(Boolean)
          .join("; ");
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

// ---------------------------------------------------------------------------
// SSE streaming (text/event-stream)
// ---------------------------------------------------------------------------

export interface SseCallbacks {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * POST a JSON payload and stream the SSE response.
 *
 * Protocol handled:
 *   - `data: <json>\n\n` — a text delta (JSON-encoded string)
 *   - `event: error\ndata: <message>\n\n` — a server error; aborts the stream
 *   - `data: [DONE]\n\n` — end-of-stream sentinel
 *
 * This is the canonical SSE path — `apiFetch` cannot express streaming
 * body reads, so services that need SSE call through here instead of
 * reaching for `fetch` directly.
 *
 * Returns an AbortController so the caller can cancel mid-stream.
 */
export function streamFetchSSE(
  path: string,
  payload: unknown,
  callbacks: SseCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
