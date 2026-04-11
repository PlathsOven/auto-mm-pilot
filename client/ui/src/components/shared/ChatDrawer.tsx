import { useChat } from "../../providers/ChatProvider";
import { useKeyboardShortcut } from "../../hooks/useKeyboardShortcut";
import { LlmChat } from "../LlmChat";

/**
 * Global docked chat sidebar.
 *
 * Mounted once at the App level inside a flex row alongside the active page,
 * so opening it pushes the page content aside rather than overlaying it.
 * Open/close state lives on ChatProvider so any component can trigger it via
 * `useChat().openDrawer()` / `toggleDrawer()`.
 *
 * Listens for `cmd+/` (or `ctrl+/`) globally to toggle visibility. Esc closes
 * when open. Clicks outside the drawer do NOT dismiss it — it stays until the
 * user explicitly closes it via the shortcut, the Chat button, or the ✕.
 */
export function ChatDrawer() {
  const { drawerOpen, toggleDrawer, closeDrawer } = useChat();

  useKeyboardShortcut("/", toggleDrawer);
  useKeyboardShortcut("Escape", () => drawerOpen && closeDrawer(), { mod: false });

  if (!drawerOpen) return null;

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-black/[0.06] bg-white/85 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-3 py-2">
        <span className="zone-header">APT Chat</span>
        <div className="flex items-center gap-2">
          <span className="hidden text-[9px] tabular-nums text-mm-text-subtle sm:inline">
            ⌘/
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
  );
}
