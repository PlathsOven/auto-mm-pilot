/**
 * HTTP client for the APT LLM server endpoints.
 *
 * - streamChat(): SSE stream from POST /api/investigate (endpoint name retained
 *   for backwards compatibility — handles all chat modes, not just investigate).
 */

import { API_BASE } from "../config";
import type { InvestigatePayload } from "../types";

// ---------------------------------------------------------------------------
// Chat — SSE streaming
// ---------------------------------------------------------------------------

/**
 * Stream chat tokens from the server for any mode (investigate, build, general).
 * Calls `onDelta` for each token chunk, `onDone` when complete, `onError` on failure.
 * Returns an AbortController so the caller can cancel.
 */
export function streamChat(
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

