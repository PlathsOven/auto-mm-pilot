/**
 * Client for POST /api/build/converse — the five-stage Build pipeline.
 *
 * The server multiplexes two event shapes onto one SSE stream:
 *   - `{ delta: "<text>" }` — natural-language assistant text
 *   - `{ stage: "router"|"intent"|"synthesis"|"critique", output: {...} }`
 *   - `{ stage: "proposal", payload: ProposedBlockPayload }`
 *   - `{ error: "<detail>" }`
 *
 * This helper routes each event to the right callback so the caller
 * doesn't need to understand the wire shape.
 */
import type {
  BlockCommitRequest,
  BlockCommitResponse,
  BlockPreviewRequest,
  LlmFailureLogRequest,
  PreviewResponse,
  ProposedBlockPayload,
} from "../types";
import { apiFetch, streamFetchSSE } from "./api";

export type BuildStageName = "router" | "intent" | "synthesis" | "critique";

export interface BuildConverseCallbacks {
  /** Called for every natural-language chunk (clarifying Q, fallthrough, or final summary). */
  onDelta: (text: string) => void;
  /** Called once per completed stage with the stage's structured output. */
  onStageOutput?: (stage: BuildStageName, output: unknown) => void;
  /** Called when Stage 3 produces a fully parameterised block proposal. */
  onProposal: (payload: ProposedBlockPayload) => void;
  /** Called with the conversation_turn_id as soon as it's known —
   *  currently emitted alongside the Stage 1 (router) event so the
   *  client can reference it in later failure signals
   *  (preview_rejection, silent_rejection). */
  onTurnId?: (turnId: string) => void;
  /** Called on `[DONE]`. */
  onDone: () => void;
  /** Called on any server-side stage failure or transport error. */
  onError: (detail: string) => void;
}

export interface BuildConverseRequest {
  conversation: Array<{ role: string; content: string }>;
}

function isProposalEvent(
  ev: Record<string, unknown>,
): ev is { stage: "proposal"; payload: ProposedBlockPayload } {
  return ev.stage === "proposal" && typeof ev.payload === "object" && ev.payload !== null;
}

function isStageEvent(
  ev: Record<string, unknown>,
): ev is { stage: BuildStageName; output: unknown } {
  return (
    (ev.stage === "router" ||
      ev.stage === "intent" ||
      ev.stage === "synthesis" ||
      ev.stage === "critique") &&
    "output" in ev
  );
}

/** POST /api/blocks/preview — Stage-4 desired-position diff. */
export async function previewBlock(
  payload: ProposedBlockPayload,
): Promise<PreviewResponse> {
  return apiFetch<PreviewResponse>("/api/blocks/preview", {
    method: "POST",
    body: JSON.stringify({ payload } satisfies BlockPreviewRequest),
  });
}

/** POST /api/blocks/commit — Stage-5 finalise the proposal + persist the intent triplet. */
export async function commitBlock(
  req: BlockCommitRequest,
): Promise<BlockCommitResponse> {
  return apiFetch<BlockCommitResponse>("/api/blocks/commit", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** POST /api/llm/failures — record a UI-driven failure signal. Fire-and-forget. */
export async function logFailure(req: LlmFailureLogRequest): Promise<void> {
  await apiFetch<void>("/api/llm/failures", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/** Fire a Build-mode conversation at /api/build/converse and dispatch stage events. */
export function streamBuildConverse(
  req: BuildConverseRequest,
  callbacks: BuildConverseCallbacks,
): AbortController {
  return streamFetchSSE("/api/build/converse", req, {
    // streamFetchSSE's `onDelta` is typed as string but at runtime passes
    // the parsed JSON value — which for this endpoint is a dict event.
    // Dispatch on shape here.
    onDelta: (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const ev = payload as Record<string, unknown>;
      // The orchestrator attaches conversation_turn_id to the Stage 1
      // event so the client can reference it later. Relay on any event
      // that carries it — first-wins at the caller's end.
      if (typeof ev.conversation_turn_id === "string") {
        callbacks.onTurnId?.(ev.conversation_turn_id);
      }
      if (typeof ev.delta === "string") {
        callbacks.onDelta(ev.delta);
        return;
      }
      if (typeof ev.error === "string") {
        callbacks.onError(ev.error);
        return;
      }
      if (isProposalEvent(ev)) {
        callbacks.onProposal(ev.payload);
        return;
      }
      if (isStageEvent(ev)) {
        callbacks.onStageOutput?.(ev.stage, ev.output);
      }
    },
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  });
}
