/**
 * HTTP client for the Posit LLM server endpoints.
 *
 * - streamChat(): SSE stream from POST /api/investigate (endpoint name retained
 *   for backwards compatibility — handles all chat modes, not just investigate).
 */

import type { InvestigateRequest } from "../types";
import { streamFetchSSE, type SseCallbacks } from "./api";

/**
 * Stream chat tokens from the server for any mode (investigate, build, general).
 * Calls `onDelta` for each token chunk, `onDone` when complete, `onError` on failure.
 * Returns an AbortController so the caller can cancel.
 */
export function streamChat(
  payload: InvestigateRequest,
  callbacks: SseCallbacks,
): AbortController {
  return streamFetchSSE("/api/investigate", payload, callbacks);
}
