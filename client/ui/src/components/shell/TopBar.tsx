import { useFocus } from "../../providers/FocusProvider";
import { useMode, MODE_LABELS } from "../../providers/ModeProvider";

/**
 * Slim top header — page title + focus breadcrumb.
 *
 * Acts as a "you are here" indicator at the top of the main content area.
 * Always shows the active mode; when a focus is set, appends a breadcrumb
 * trail (e.g. `Workbench › Cell · BTC · 27MAR26`) with an inline clear-focus
 * button. Designed to be ~28px so it doesn't eat much vertical space.
 *
 * Doesn't host nav controls itself — the LeftNav owns mode switching, the
 * StatusBar owns system state, and the command palette owns search. This bar
 * exists purely to give the trader contextual orientation.
 */
export function TopBar() {
  const { mode } = useMode();
  const { focus, clearFocus } = useFocus();

  return (
    <div className="glass-bar flex h-7 shrink-0 items-center gap-2 border-b px-3 text-[10px] text-mm-text-dim">
      <span className="font-semibold uppercase tracking-wider text-mm-text">
        {MODE_LABELS[mode]}
      </span>
      {focus && (
        <>
          <Chevron />
          <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px] uppercase text-mm-text-subtle">
            {focus.kind}
          </span>
          <span className="font-medium text-mm-text">{focusBreadcrumb(focus)}</span>
          <button
            type="button"
            onClick={clearFocus}
            className="rounded p-0.5 text-mm-text-subtle transition-colors hover:bg-black/[0.04] hover:text-mm-text"
            title="Clear focus (Esc)"
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

function Chevron() {
  return <span className="text-mm-text-subtle">›</span>;
}

function focusBreadcrumb(focus: NonNullable<ReturnType<typeof useFocus>["focus"]>): string {
  switch (focus.kind) {
    case "cell": return `${focus.symbol} · ${focus.expiry}`;
    case "symbol": return focus.symbol;
    case "expiry": return focus.expiry;
    case "stream": return focus.name;
    case "block":
      return `${focus.key.blockName} · ${focus.key.symbol} · ${focus.key.expiry}`;
  }
}
