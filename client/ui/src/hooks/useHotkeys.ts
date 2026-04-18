import { useEffect, useRef } from "react";

/**
 * Bind a small map of `key string → handler` shortcuts globally.
 *
 * Supports two forms:
 *  - Single key (e.g. `"Escape"`, `"["`, `"?"`).
 *  - Two-key chord with the `g` prefix (e.g. `"g c"`, `"g s"`). The chord
 *    only fires if the second key is pressed within `CHORD_WINDOW_MS` and
 *    no modifier key was held.
 *
 * Designed for trader-friendly nav: bare keys, no `Cmd-` mod required. Skips
 * firing while the user is typing in an input/textarea/contenteditable so
 * shortcuts never steal characters.
 */

type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

const CHORD_WINDOW_MS = 1200;
const CHORD_PREFIXES = new Set(["g"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

function singleKeyForEvent(e: KeyboardEvent): string {
  // Normalise — Shift+/ produces `?` already; arrow keys keep their full name.
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export function useHotkeys(map: HotkeyMap): void {
  // Stash latest map so handlers can refer to it without re-binding listeners.
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    let pendingPrefix: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    function clearPending() {
      pendingPrefix = null;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      // Ignore key combos with modifiers — those are reserved for the palette
      // (`Cmd-K`) or the chat toggle (`Cmd-/`), bound elsewhere.
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearPending();
        return;
      }

      const key = singleKeyForEvent(e);

      // Mid-chord: try to resolve `<prefix> <key>`.
      if (pendingPrefix) {
        const chord = `${pendingPrefix} ${key}`;
        clearPending();
        const handler = mapRef.current[chord];
        if (handler) {
          e.preventDefault();
          handler(e);
          return;
        }
        // Unknown chord — fall through and try the bare key match.
      }

      // Start a new chord if this is a known prefix and a chord exists.
      if (
        CHORD_PREFIXES.has(key)
        && Object.keys(mapRef.current).some((k) => k.startsWith(`${key} `))
      ) {
        pendingPrefix = key;
        pendingTimer = setTimeout(clearPending, CHORD_WINDOW_MS);
        e.preventDefault();
        return;
      }

      const handler = mapRef.current[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPending();
    };
  }, []);
}
