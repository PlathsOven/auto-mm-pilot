import { useCallback, useState } from "react";
import { InspectorRouter } from "./InspectorRouter";
import { useFocus } from "../../providers/FocusProvider";
import { useHotkeys } from "../../hooks/useHotkeys";
import { INSPECTOR_COLUMN_OPEN_KEY, INSPECTOR_COLUMN_WIDTH_PX } from "../../constants";

const HANDLE_WIDTH_PX = 18;

/**
 * Right-column Inspector for the Workbench.
 *
 * Single-purpose now (no Chat tab — chat lives in its own bottom dock).
 * Renders whichever `<InspectorRouter/>` surface matches the current focus
 * — Cell, Symbol/Expiry, Stream, Block, or Empty.
 *
 * Always visible in the layout (collapsible). The collapse handle is
 * anchored to the column's left edge so the affordance is in the same
 * location whether the column is expanded or collapsed.
 *
 * `[` / `]` hotkeys toggle visibility while the workbench is mounted; the
 * last choice is persisted to localStorage so it survives a reload.
 */
export function InspectorColumn() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(INSPECTOR_COLUMN_OPEN_KEY) !== "false"; } catch { return true; }
  });
  const { focus } = useFocus();

  const persistOpen = useCallback((next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(INSPECTOR_COLUMN_OPEN_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const toggleOpen = useCallback(() => persistOpen(!open), [open, persistOpen]);

  useHotkeys({ "[": toggleOpen, "]": toggleOpen });

  const totalWidth = open ? INSPECTOR_COLUMN_WIDTH_PX : HANDLE_WIDTH_PX;
  // When the inspector is collapsed but a focus is set, surface a soft
  // pulsing glow on the toggle handle so the user knows there is hidden
  // content to look at.
  const hasHiddenContent = !open && focus !== null;

  return (
    <aside
      className="glass-bar flex shrink-0 flex-row border-l"
      style={{ width: totalWidth }}
    >
      <button
        type="button"
        onClick={() => persistOpen(!open)}
        className={`group flex h-full w-[18px] shrink-0 cursor-pointer items-center justify-center border-r border-black/[0.06] transition-colors hover:bg-mm-accent/[0.06] ${
          hasHiddenContent
            ? "animate-pulse bg-mm-accent/15 shadow-[inset_2px_0_0_0_rgba(79,91,213,0.65)]"
            : "bg-black/[0.02]"
        }`}
        title={
          hasHiddenContent
            ? `Expand inspector — ${focusHint(focus)} ( [ or ] )`
            : `${open ? "Collapse" : "Expand"} inspector ( [ or ] )`
        }
        aria-label={open ? "Collapse inspector" : "Expand inspector"}
      >
        <span
          className={`text-[11px] font-semibold transition-colors group-hover:text-mm-accent ${
            hasHiddenContent ? "text-mm-accent" : "text-mm-text-subtle"
          }`}
        >
          {open ? "›" : "‹"}
        </span>
      </button>
      {open && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-baseline gap-2 border-b border-black/[0.05] px-3 py-1.5">
            <span className="zone-header">Inspector</span>
            <span className="text-[9px] text-mm-text-subtle">{focusHint(focus)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <InspectorRouter />
          </div>
        </div>
      )}
    </aside>
  );
}

function focusHint(focus: ReturnType<typeof useFocus>["focus"]): string {
  if (!focus) return "no focus";
  switch (focus.kind) {
    case "cell": return `${focus.symbol} ${focus.expiry}`;
    case "symbol": return focus.symbol;
    case "expiry": return focus.expiry;
    case "stream": return focus.name;
    case "block": return focus.name;
  }
}
