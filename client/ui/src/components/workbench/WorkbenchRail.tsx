import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LlmChat } from "../LlmChat";
import { InspectorRouter } from "./InspectorRouter";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useFocus } from "../../providers/FocusProvider";
import { useChat } from "../../providers/ChatProvider";
import { WORKBENCH_RAIL_OPEN_KEY, WORKBENCH_RAIL_TAB_KEY, WORKBENCH_RAIL_WIDTH_PX } from "../../constants";

type RailTab = "inspector" | "chat";

const RAIL_HANDLE_WIDTH_PX = 18;

/** Read+persist UI flags from localStorage with safe defaults. */
function readPersisted<T extends string>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

interface WorkbenchRailProps {
  /** Imperative open-and-focus signal — when this changes the rail opens
   *  and switches to the requested tab. Used by hotkeys (`g c` / `g i`). */
  signal: { tab: RailTab; nonce: number } | null;
}

/**
 * Right rail for the unified Workbench page.
 *
 * Two stacked tabs — Inspector (focus-driven detail) and Chat (LlmChat). The
 * rail is collapsible via an **always-anchored** vertical handle on its
 * left edge: same control, same location whether expanded or collapsed
 * (fixes the earlier UX where the toggle button moved between two
 * different positions).
 *
 * Open/closed state and active tab persist to localStorage so the user's
 * preference survives reloads.
 */
export function WorkbenchRail({ signal }: WorkbenchRailProps) {
  const [open, setOpen] = useState<boolean>(() => readPersisted(WORKBENCH_RAIL_OPEN_KEY, "true") === "true");
  const [tab, setTab] = useState<RailTab>(() => readPersisted<RailTab>(WORKBENCH_RAIL_TAB_KEY, "inspector"));
  const { focus } = useFocus();
  const { investigation, drawerOpen } = useChat();

  const persistOpen = useCallback((next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(WORKBENCH_RAIL_OPEN_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const persistTab = useCallback((next: RailTab) => {
    setTab(next);
    try { localStorage.setItem(WORKBENCH_RAIL_TAB_KEY, next); } catch { /* ignore */ }
  }, []);

  // Imperative signal from the page: switch tab + ensure rail is open.
  useEffect(() => {
    if (!signal) return;
    persistTab(signal.tab);
    persistOpen(true);
  }, [signal, persistTab, persistOpen]);

  // External keyboard toggles (App.tsx [/] hotkeys) write to localStorage and
  // dispatch a synthetic StorageEvent. Sync our local state when the key is
  // touched so the rail collapses/expands without a page reload.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== WORKBENCH_RAIL_OPEN_KEY) return;
      try {
        const v = localStorage.getItem(WORKBENCH_RAIL_OPEN_KEY);
        setOpen(v !== "false");
      } catch {
        // ignore
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // When the user gestures to investigate from an inspector ("Ask @Posit"),
  // ChatProvider sets `investigation`. Surface chat tab automatically so the
  // gesture doesn't require a second click.
  useEffect(() => {
    if (investigation) {
      persistTab("chat");
      persistOpen(true);
    }
  }, [investigation, persistTab, persistOpen]);

  // ChatProvider.drawerOpen acts as a global "show chat" signal — fired by
  // the LeftNav Chat button + ⌘/ shortcut + `g c` chord. Listen for the
  // rising edge so we open + switch to the chat tab.
  const wasDrawerOpen = useRef(false);
  useEffect(() => {
    if (drawerOpen && !wasDrawerOpen.current) {
      persistTab("chat");
      persistOpen(true);
    }
    wasDrawerOpen.current = drawerOpen;
  }, [drawerOpen, persistTab, persistOpen]);

  const tabItems = useMemo<TabItem<RailTab>[]>(() => [
    { value: "inspector", label: "Inspector", hint: focusHint(focus) },
    { value: "chat", label: "Chat", hint: "⌘/" },
  ], [focus]);

  const totalWidth = open ? WORKBENCH_RAIL_WIDTH_PX : RAIL_HANDLE_WIDTH_PX;

  return (
    <aside
      className="glass-bar flex shrink-0 flex-row border-l"
      style={{ width: totalWidth }}
    >
      <RailHandle open={open} onToggle={() => persistOpen(!open)} />
      {open && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-black/[0.05] px-2 py-1.5">
            <Tabs items={tabItems} value={tab} onChange={persistTab} variant="pill" size="sm" />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "inspector" ? <InspectorRouter /> : <LlmChat />}
          </div>
        </div>
      )}
    </aside>
  );
}

function RailHandle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex h-full w-[18px] shrink-0 cursor-pointer items-center justify-center border-r border-black/[0.06] bg-black/[0.02] transition-colors hover:bg-mm-accent/[0.06]"
      title={`${open ? "Collapse" : "Expand"} rail ( [ or ] )`}
      aria-label={open ? "Collapse rail" : "Expand rail"}
    >
      <span className="text-[11px] font-semibold text-mm-text-subtle transition-colors group-hover:text-mm-accent">
        {open ? "›" : "‹"}
      </span>
    </button>
  );
}

function focusHint(focus: ReturnType<typeof useFocus>["focus"]): string | undefined {
  if (!focus) return undefined;
  switch (focus.kind) {
    case "cell": return `${focus.symbol} ${focus.expiry}`;
    case "symbol": return focus.symbol;
    case "expiry": return focus.expiry;
    case "stream": return focus.name;
    case "block": return focus.name;
  }
}
