import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Focus } from "../types";
import { blockKeyEquals } from "../utils";

/**
 * Workbench focus state.
 *
 * One global "what is the user inspecting right now?" pointer. Every
 * interactive surface (grid cell, stream row, block row, chart series)
 * writes here; every Inspector panel subscribes here. Replaces the older
 * `SelectionProvider`'s narrower block/dimension model with a typed union
 * over every focusable entity in the app.
 *
 * Selection is single-select on purpose: the user is investigating one
 * thing at a time. Click again on the same target to clear.
 */

interface FocusContextValue {
  focus: Focus | null;
  setFocus: (focus: Focus | null) => void;
  clearFocus: () => void;
  /** Toggle: if `next` matches the current focus, clear; else set to `next`. */
  toggleFocus: (next: Focus) => void;
  isFocused: (focus: Focus) => boolean;
}

const FocusContext = createContext<FocusContextValue | null>(null);

function focusEquals(a: Focus | null, b: Focus | null): boolean {
  if (a == null || b == null) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "cell":
      return a.symbol === (b as Extract<Focus, { kind: "cell" }>).symbol
        && a.expiry === (b as Extract<Focus, { kind: "cell" }>).expiry;
    case "symbol":
      return a.symbol === (b as Extract<Focus, { kind: "symbol" }>).symbol;
    case "expiry":
      return a.expiry === (b as Extract<Focus, { kind: "expiry" }>).expiry;
    case "stream":
      return a.name === (b as Extract<Focus, { kind: "stream" }>).name;
    case "opinion":
      return a.name === (b as Extract<Focus, { kind: "opinion" }>).name;
    case "block":
      return blockKeyEquals(a.key, (b as Extract<Focus, { kind: "block" }>).key);
  }
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<Focus | null>(null);

  const clearFocus = useCallback(() => setFocus(null), []);

  const toggleFocus = useCallback((next: Focus) => {
    setFocus((prev) => (focusEquals(prev, next) ? null : next));
  }, []);

  const isFocused = useCallback(
    (target: Focus) => focusEquals(focus, target),
    [focus],
  );

  const value = useMemo<FocusContextValue>(
    () => ({ focus, setFocus, clearFocus, toggleFocus, isFocused }),
    [focus, clearFocus, toggleFocus, isFocused],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocus must be used within FocusProvider");
  return ctx;
}

/** Read-only convenience: extract the (symbol, expiry) dimension implied by the
 *  current focus, when one exists. Returns null otherwise.
 *
 *  - `cell` → both symbol and expiry
 *  - `symbol` / `expiry` → that one axis (the other is undefined)
 *  - `stream` / `block` → null
 */
export function useFocusDimension(): { symbol?: string; expiry?: string } | null {
  const { focus } = useFocus();
  return useMemo(() => {
    if (!focus) return null;
    if (focus.kind === "cell") return { symbol: focus.symbol, expiry: focus.expiry };
    if (focus.kind === "symbol") return { symbol: focus.symbol };
    if (focus.kind === "expiry") return { expiry: focus.expiry };
    return null;
  }, [focus]);
}
