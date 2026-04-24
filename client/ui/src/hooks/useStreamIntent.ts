/**
 * Hook backing the "Why this block exists" card.
 *
 * Fetches `/api/streams/{name}/intent` once per focus change. The 4-state
 * model disambiguates the three "nothing rendered" cases the card cares
 * about: loading (don't render anything yet), hidden (server said 404 —
 * this stream has no stored intent, so render nothing), and ready (render
 * the card). `error` surfaces transport failures as a small placeholder.
 *
 * Rapid focus changes are race-proofed via an AbortController — responses
 * for a superseded stream name are discarded before they can overwrite
 * the visible state.
 */
import { useEffect, useState } from "react";
import { fetchStreamIntent } from "../services/buildApi";
import type { StoredBlockIntent } from "../types";

export type StreamIntentState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "ready"; intent: StoredBlockIntent }
  | { status: "error"; error: string };

export function useStreamIntent(streamName: string): StreamIntentState {
  const [state, setState] = useState<StreamIntentState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchStreamIntent(streamName, controller.signal)
      .then((intent) => {
        if (controller.signal.aborted) return;
        setState(intent === null ? { status: "hidden" } : { status: "ready", intent });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to load intent for stream "${streamName}":`, err);
        setState({ status: "error", error: message });
      });
    return () => controller.abort();
  }, [streamName]);

  return state;
}
