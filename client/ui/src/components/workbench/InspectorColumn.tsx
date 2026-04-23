import { useCallback, useEffect, useRef, useState } from "react";
import { InspectorRouter } from "./InspectorRouter";
import { useFocus } from "../../providers/FocusProvider";
import { useHotkeys } from "../../hooks/useHotkeys";
import { safeGetItem, safeSetItem } from "../../utils";
import { Tooltip } from "../ui/Tooltip";
import {
  INSPECTOR_COLUMN_MAX_WIDTH_PX,
  INSPECTOR_COLUMN_MIN_WIDTH_PX,
  INSPECTOR_COLUMN_OPEN_KEY,
  INSPECTOR_COLUMN_WIDTH_KEY,
  INSPECTOR_COLUMN_WIDTH_PX,
} from "../../constants";

const HANDLE_WIDTH_PX = 18;

function loadPersistedWidth(): number {
  const raw = safeGetItem(INSPECTOR_COLUMN_WIDTH_KEY);
  if (raw == null) return INSPECTOR_COLUMN_WIDTH_PX;
  const n = Number(raw);
  if (!Number.isFinite(n)) return INSPECTOR_COLUMN_WIDTH_PX;
  return clampWidth(n);
}

function clampWidth(px: number): number {
  if (px < INSPECTOR_COLUMN_MIN_WIDTH_PX) return INSPECTOR_COLUMN_MIN_WIDTH_PX;
  if (px > INSPECTOR_COLUMN_MAX_WIDTH_PX) return INSPECTOR_COLUMN_MAX_WIDTH_PX;
  return Math.round(px);
}

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
  const [open, setOpen] = useState<boolean>(
    () => safeGetItem(INSPECTOR_COLUMN_OPEN_KEY) !== "false",
  );
  const [width, setWidth] = useState<number>(loadPersistedWidth);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const { focus } = useFocus();

  const persistOpen = useCallback((next: boolean) => {
    setOpen(next);
    safeSetItem(INSPECTOR_COLUMN_OPEN_KEY, String(next));
  }, []);

  const toggleOpen = useCallback(() => persistOpen(!open), [open, persistOpen]);

  useHotkeys({ "[": toggleOpen, "]": toggleOpen });

  // Drag-to-resize. The handle sits on the column's left edge; pulling it
  // left widens the rail, right narrows. Width persists to localStorage so
  // the next session restores it. Mouse events attach to window for the
  // duration of a drag so the cursor can leave the 4px strip mid-gesture
  // without aborting.
  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!open) return;
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    setDragging(true);
  }, [open, width]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      const dx = e.clientX - dragState.current.startX;
      // Right rail: dragging LEFT (negative dx) widens; subtract.
      setWidth(clampWidth(dragState.current.startWidth - dx));
    };
    const onUp = () => {
      dragState.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // Persist after the drag settles — writing on every move event would
  // thrash localStorage for no visible benefit.
  useEffect(() => {
    if (dragging) return;
    safeSetItem(INSPECTOR_COLUMN_WIDTH_KEY, String(width));
  }, [dragging, width]);

  const totalWidth = open ? width : HANDLE_WIDTH_PX;
  // When the inspector is collapsed but a focus is set, surface a soft
  // pulsing glow on the toggle handle so the user knows there is hidden
  // content to look at.
  const hasHiddenContent = !open && focus !== null;

  return (
    <aside
      className="glass-bar relative flex shrink-0 flex-row border-l"
      style={{ width: totalWidth, userSelect: dragging ? "none" : undefined }}
    >
      {open && (
        <Tooltip label="Drag to resize inspector" side="left">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector column"
            tabIndex={-1}
            onMouseDown={onHandleMouseDown}
            className={`absolute left-0 top-0 z-10 h-full w-1 cursor-ew-resize transition-colors ${
              dragging ? "bg-mm-accent/60" : "hover:bg-mm-accent/30"
            }`}
          />
        </Tooltip>
      )}
      <Tooltip
        label={
          hasHiddenContent
            ? `Expand inspector — ${focusHint(focus)} ( [ or ] )`
            : `${open ? "Collapse" : "Expand"} inspector ( [ or ] )`
        }
        side="left"
      >
        <button
          type="button"
          onClick={() => persistOpen(!open)}
          className={`group flex h-full w-[18px] shrink-0 cursor-pointer items-center justify-center border-r border-black/[0.06] transition-colors hover:bg-mm-accent/[0.06] ${
            hasHiddenContent
              ? "animate-pulse bg-mm-accent/15 shadow-[inset_2px_0_0_0_rgba(79,91,213,0.65)]"
              : "bg-black/[0.02]"
          }`}
          aria-label={open ? "Collapse inspector" : "Expand inspector"}
          aria-expanded={open}
        >
          <span
            className={`text-[11px] font-semibold transition-colors group-hover:text-mm-accent ${
              hasHiddenContent ? "text-mm-accent" : "text-mm-text-subtle"
            }`}
          >
            {open ? "›" : "‹"}
          </span>
        </button>
      </Tooltip>
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
    case "block":
      return `${focus.key.blockName} · ${focus.key.symbol} ${focus.key.expiry}`;
  }
}
