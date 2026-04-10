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
        className="fixed right-0 top-[56px] z-50 flex h-[calc(100vh-56px)] w-[420px] flex-col border-l border-black/[0.06] bg-white/70 shadow-xl shadow-black/[0.06]"
        style={{ backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/[0.06] px-3 py-2">
          <span className="zone-header">APT Chat</span>
          <div className="flex items-center gap-2">
            <span className="hidden text-[9px] tabular-nums text-mm-text-subtle sm:inline">
              ⌘\
            </span>
            <button
              type="button"
              onClick={closeDrawer}
              className="rounded-md p-1 text-[12px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
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
