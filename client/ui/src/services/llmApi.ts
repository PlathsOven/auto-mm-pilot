/**
 * HTTP client for the APT LLM server endpoints.
 *
 * - streamInvestigation(): SSE stream from POST /api/investigate
 * - fetchJustification(): JSON from POST /api/justify
 */

import { API_BASE } from "../config";

// ---------------------------------------------------------------------------
// Investigation — SSE streaming
// ---------------------------------------------------------------------------

export interface InvestigatePayload {
  conversation: { role: string; content: string }[];
  cell_context?: Record<string, unknown> | null;
}

/**
 * Stream investigation tokens from the server.
 * Calls `onDelta` for each token chunk, `onDone` when complete, `onError` on failure.
 * Returns an AbortController so the caller can cancel.
 */
export function streamInvestigation(
  payload: InvestigatePayload,
  callbacks: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  },
): AbortController {
  const controller = new AbortController();

  (async () => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/investigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        callbacks.onError(
          `Failed to connect to APT server: ${err instanceof Error ? err.message : String(err)}`,
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

// ---------------------------------------------------------------------------
// Justification — single JSON response
// ---------------------------------------------------------------------------

export interface JustifyPayload {
  asset: string;
  expiry: string;
  old_pos: number;
  new_pos: number;
  delta: number;
}

export interface JustifyResponse {
  justification: string;
}

/**
 * Fetch a one-line justification for a position change.
 * Throws on any failure.
 */
export async function fetchJustification(
  payload: JustifyPayload,
): Promise<string> {
  const response = await fetch(`${API_BASE}/api/justify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    throw new Error(`Justification failed (${response.status}): ${body}`);
  }

  const data: JustifyResponse = await response.json();
  return data.justification;
}
