/**
 * HTTP client for the APT LLM server endpoints.
 *
 * - streamInvestigation(): SSE stream from POST /api/investigate
 */

import { API_BASE } from "../config";
import type { InvestigatePayload } from "../types";

// ---------------------------------------------------------------------------
// Investigation — SSE streaming
// ---------------------------------------------------------------------------

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
// Studio Stream Canvas — LLM co-pilot
// ---------------------------------------------------------------------------

const STREAM_DRAFT_DIRECTIVE = `You are APT's Stream Drafting Co-pilot. The user is composing a new data stream for APT — a quantitative trading framework that turns ideas into positions via the equation Position = Edge × Bankroll / Variance.

Given the user's free-text description of their idea, propose concrete values for the following Stream Canvas sections. Respond as a single JSON object with these keys:

{
  "identity": { "stream_name": "snake_case_name", "key_cols": ["symbol","expiry"], "description": "one-sentence summary" },
  "data_shape": { "value_column": "raw_value", "sample_csv_header": "timestamp,symbol,expiry,raw_value" },
  "target_mapping": { "scale": 1.0, "offset": 0.0, "exponent": 1.0, "rationale": "..." },
  "block_shape": { "annualized": true, "size_type": "fixed", "temporal_position": "shifting", "decay_end_size_mult": 1.0, "decay_rate_prop_per_min": 0.0 },
  "aggregation": { "aggregation_logic": "average", "rationale": "..." },
  "confidence": { "var_fair_ratio": 1.0, "rationale": "..." }
}

Be precise. Numbers must be plain JSON numbers (not strings). Use snake_case for stream_name. Wrap your reply in a single fenced \`\`\`json code block so the client can parse it.`;

/**
 * Stream a structured stream-draft suggestion from the LLM, given a free-text
 * description of the user's idea.
 *
 * Reuses `/api/investigate` with a stream-drafting system directive prepended
 * client-side. Returns the same `AbortController` shape as `streamInvestigation`
 * so the canvas can cancel mid-flight.
 */
export function draftStreamFromDescription(
  description: string,
  callbacks: {
    onDelta: (text: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  },
): AbortController {
  return streamInvestigation(
    {
      conversation: [
        { role: "system", content: STREAM_DRAFT_DIRECTIVE },
        { role: "user", content: description },
      ],
    },
    callbacks,
  );
}
