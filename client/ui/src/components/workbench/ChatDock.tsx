import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LlmChat } from "../LlmChat";
import { useChat } from "../../providers/ChatProvider";
import { safeSetItem } from "../../utils";
import { CHAT_DOCK_HEIGHT_PX, CHAT_DOCK_OPEN_KEY } from "../../constants";

/**
 * Bottom chat dock — terminal-style.
 *
 * Sits across the full width of the main canvas (between the workbench main
 * area and the StatusBar). Toggled via the LeftNav Chat button, ⌘/, or `g c`
 * — the same `drawerOpen` flag in `ChatProvider` everything else already
 * targets, so we don't need a separate signaling channel.
 *
 * The dock pushes content above it (it's a real flex item, not an overlay),
 * which means opening it shrinks the workbench main area. That's
 * intentional: the dock is a workspace, not a popup. It supports a
 * maximize-to-full-screen toggle and a vertical drag handle to resize
 * (snaps to 200 / 400 / 600 px presets).
 */
export function ChatDock() {
  const { drawerOpen, closeDrawer } = useChat();

  // Sync local "is the dock visible?" with localStorage on first mount.
  // ChatProvider's `drawerOpen` is the source of truth across the session;
  // localStorage is for survives-reload UX.
  const [maximized, setMaximized] = useState(false);
  const [height, setHeight] = useState<number>(CHAT_DOCK_HEIGHT_PX);
  // Maximized-dock ceiling tracked in state so viewport resize updates it.
  // Replacing the old `calc(100vh - 64px)` CSS string with a numeric height
  // unlocks framer-motion tweening but loses the implicit resize response;
  // this listener restores it.
  const [viewportHeight, setViewportHeight] = useState<number>(window.innerHeight);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    safeSetItem(CHAT_DOCK_OPEN_KEY, drawerOpen ? "true" : "false");
  }, [drawerOpen]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (maximized) return;
    dragRef.current = { startY: e.clientY, startH: height };
    e.preventDefault();
  }, [height, maximized]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const next = Math.max(160, Math.min(window.innerHeight - 200, dragRef.current.startH + delta));
      setHeight(next);
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    function onResize() {
      setViewportHeight(window.innerHeight);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Resolve effective height as a number in px so framer-motion can animate
  // the open/close + maximize transitions smoothly. `calc()` strings don't
  // tween, but numeric pixels do.
  const maxHeight = Math.max(200, viewportHeight - 64);
  const effectiveHeight = maximized ? maxHeight : height;

  return (
    <AnimatePresence>
      {drawerOpen && (
        <motion.aside
          key="chat-dock"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: effectiveHeight, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          className="glass-bar relative shrink-0 overflow-hidden border-t"
        >
          {/* Resize handle */}
          {!maximized && (
            <div
              onMouseDown={onMouseDown}
              className="absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize bg-black/[0.04] transition-colors hover:bg-mm-accent/30"
              title="Drag to resize"
            />
          )}

          <div className="flex h-full flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-black/[0.05] px-3 py-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">Posit Chat</span>
              <span className="text-[9px] text-mm-text-subtle">⌘/ to toggle · /help for commands</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMaximized((v) => !v)}
                  className="rounded p-1 text-[10px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
                  title={maximized ? "Restore" : "Maximize"}
                >
                  {maximized ? "⤢" : "⤡"}
                </button>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
                  title="Close (⌘/)"
                >
                  ✕
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
              <LlmChat />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
