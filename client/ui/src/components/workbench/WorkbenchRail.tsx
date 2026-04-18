import { useCallback, useEffect, useMemo, useState } from "react";
import { LlmChat } from "../LlmChat";
import { InspectorRouter } from "./InspectorRouter";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useFocus } from "../../providers/FocusProvider";
import { useChat } from "../../providers/ChatProvider";
import { WORKBENCH_RAIL_OPEN_KEY, WORKBENCH_RAIL_TAB_KEY, WORKBENCH_RAIL_WIDTH_PX } from "../../constants";

type RailTab = "inspector" | "chat";

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
 * rail is collapsible; the open/closed state and active tab persist to
 * localStorage so the user's preference survives reloads.
 *
 * Inspector contents come from `<InspectorRouter/>`, which switches on the
 * current focus. Chat is the existing `<LlmChat/>` instance, hosted here
 * instead of in the floating drawer so the user controls when chat appears
 * (Phase 1: chat is a tab, not an automatic side-effect of cell clicks).
 */
export function WorkbenchRail({ signal }: WorkbenchRailProps) {
  const [open, setOpen] = useState<boolean>(() => readPersisted(WORKBENCH_RAIL_OPEN_KEY, "true") === "true");
  const [tab, setTab] = useState<RailTab>(() => readPersisted<RailTab>(WORKBENCH_RAIL_TAB_KEY, "inspector"));
  const { focus } = useFocus();
  const { investigation } = useChat();

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => persistOpen(true)}
        className="glass-card flex h-12 w-7 items-center justify-center self-center text-[12px] text-mm-text-dim transition-colors hover:text-mm-accent"
        title="Open workbench rail ([)"
        aria-label="Open workbench rail"
      >
        ‹
      </button>
    );
  }

  const tabItems = useMemo<TabItem<RailTab>[]>(() => [
    { value: "inspector", label: "Inspector", hint: focusHint(focus) },
    { value: "chat", label: "Chat", hint: "⌘/" },
  ], [focus]);

  return (
    <aside
      className="glass-bar flex shrink-0 flex-col border-l"
      style={{ width: WORKBENCH_RAIL_WIDTH_PX }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-black/[0.05] px-2 py-1.5">
        <Tabs items={tabItems} value={tab} onChange={persistTab} variant="pill" size="sm" />
        <button
          type="button"
          onClick={() => persistOpen(false)}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
          title="Collapse rail (])"
          aria-label="Collapse rail"
        >
          ›
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "inspector" ? <InspectorRouter /> : <LlmChat />}
      </div>
    </aside>
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
