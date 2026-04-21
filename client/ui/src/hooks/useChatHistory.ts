import { useCallback, useRef, useState } from "react";
import { safeGetItem, safeSetItem } from "../utils";
import { CHAT_HISTORY_KEY, CHAT_HISTORY_MAX } from "../constants";

/**
 * Prompt history for the chat input — persisted across reloads.
 *
 * ``idx === null`` means the user is editing live input. Arrow-up/down walks
 * through the history; typing anywhere in the walk invalidates the cursor
 * and returns to live mode (callers nudge that via ``resetCursor``).
 */

function loadHistory(): string[] {
  const v = safeGetItem(CHAT_HISTORY_KEY);
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function persistHistory(history: string[]): void {
  safeSetItem(CHAT_HISTORY_KEY, JSON.stringify(history.slice(-CHAT_HISTORY_MAX)));
}

export interface ChatHistoryApi {
  /** Append a submitted entry (drops consecutive duplicates). */
  push: (entry: string) => void;
  /** Walk the history. Returns the text to display; ``null`` means "live input". */
  navigate: (direction: 1 | -1, currentInput: string) => string | null;
  /** Drop the cursor back to live-input mode (e.g. on manual edit). */
  resetCursor: () => void;
  /** Whether the cursor is currently walking history (not on live input). */
  isWalking: boolean;
}

export function useChatHistory(): ChatHistoryApi {
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [idx, setIdx] = useState<number | null>(null);
  const liveInputRef = useRef<string>("");

  const push = useCallback((entry: string) => {
    setHistory((prev) => {
      const next = prev[prev.length - 1] === entry ? prev : [...prev, entry];
      const trimmed = next.slice(-CHAT_HISTORY_MAX);
      persistHistory(trimmed);
      return trimmed;
    });
    setIdx(null);
    liveInputRef.current = "";
  }, []);

  const navigate = useCallback(
    (direction: 1 | -1, currentInput: string): string | null => {
      if (history.length === 0) return null;
      const isFirstStep = idx === null;
      if (isFirstStep) liveInputRef.current = currentInput;

      let nextIdx: number | null;
      if (isFirstStep) {
        nextIdx = direction === -1 ? history.length - 1 : null;
      } else {
        const candidate = (idx as number) + direction;
        if (candidate < 0) nextIdx = 0;
        else if (candidate >= history.length) nextIdx = null;
        else nextIdx = candidate;
      }
      setIdx(nextIdx);
      return nextIdx === null ? liveInputRef.current : history[nextIdx];
    },
    [history, idx],
  );

  const resetCursor = useCallback(() => setIdx(null), []);

  return { push, navigate, resetCursor, isWalking: idx !== null };
}
