import { useChat } from "../../providers/ChatProvider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { LlmChat } from "../LlmChat";

/**
 * Global right-side chat drawer.
 *
 * Mounted once at the App level so it overlays any mode (Floor, Studio,
 * Lens, Docs). Open/close state lives on ChatProvider so any component can
 * trigger it via `useChat().openDrawer()` / `toggleDrawer()`.
 *
 * Listens for `cmd+\` (or `ctrl+\`) globally to toggle visibility.
 *
 * Phase 1 reuses the existing `LlmChat` body verbatim. Mode-aware context
 * injection lands in later phases as `useMode()` is read here.
 */
export function ChatDrawer() {
  const { drawerOpen, toggleDrawer, closeDrawer } = useChat();

  useKeyboardShortcut("\\", toggleDrawer);
  useKeyboardShortcut("Escape", () => drawerOpen && closeDrawer(), { mod: false });

  if (!drawerOpen) return null;

  return (
    <>
      {/* Click-outside backdrop (transparent — drawer floats on top of mode content) */}
      <div
        className="fixed inset-0 z-40"
        onClick={closeDrawer}
        aria-hidden
      />

      <aside
        className="fixed right-0 top-[60px] z-50 flex h-[calc(100vh-60px)] w-[420px] flex-col border-l border-mm-border/60 bg-mm-surface shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-mm-border/40 px-3 py-2">
          <span className="zone-header">APT Chat</span>
          <div className="flex items-center gap-2">
            <span className="hidden text-[9px] tabular-nums text-mm-text-dim sm:inline">
              ⌘\
            </span>
            <button
              type="button"
              onClick={closeDrawer}
              className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <LlmChat />
        </div>
      </aside>
    </>
  );
}
