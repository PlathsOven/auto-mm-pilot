import { useEffect } from "react";

interface ShortcutOptions {
  /** Require the platform modifier (cmd on mac, ctrl on win/linux). Default: true. */
  mod?: boolean;
  /** Require Shift. */
  shift?: boolean;
  /** Require Alt. */
  alt?: boolean;
  /** Whether to call preventDefault on match. Default: true. */
  preventDefault?: boolean;
}

/**
 * Register a global keyboard shortcut. The `key` is matched case-insensitively
 * against `event.key` (e.g. "k", "Escape", "\\").
 *
 * By default the mod key (cmd on mac, ctrl elsewhere) is required — pass
 * `{ mod: false }` for bare-key shortcuts like Escape.
 */
export function useKeyboardShortcut(
  key: string,
  handler: (e: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): void {
  const { mod = true, shift = false, alt = false, preventDefault = true } = options;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const modPressed = e.metaKey || e.ctrlKey;
      if (mod && !modPressed) return;
      if (!mod && modPressed) return;
      if (shift !== e.shiftKey) return;
      if (alt !== e.altKey) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      if (preventDefault) e.preventDefault();
      handler(e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, mod, shift, alt, preventDefault]);
}
