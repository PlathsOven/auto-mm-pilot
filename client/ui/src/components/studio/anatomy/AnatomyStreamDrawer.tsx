import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";
import { StreamCanvas } from "../StreamCanvas";

interface Props {
  streamName: string | null;
  templateId: string | null;
  onClose: () => void;
}

/**
 * Right-side drawer that hosts the existing 7-section `StreamCanvas`.
 *
 * Opens from the Anatomy canvas when a stream node (or "Open canvas" button
 * in the NodeDetailPanel) is clicked. Dismisses on Esc + click-outside.
 */
export function AnatomyStreamDrawer({ streamName, templateId, onClose }: Props) {
  useKeyboardShortcut("Escape", onClose, { mod: false });

  const open = streamName !== null;
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-[60px] z-50 flex h-[calc(100vh-60px)] w-[640px] flex-col border-l border-mm-border/60 bg-mm-surface shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-mm-border/40 px-3 py-2">
          <div>
            <span className="zone-header">Stream Canvas</span>
            <span className="ml-2 font-mono text-[11px] text-mm-text-dim">{streamName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <StreamCanvas
            streamName={streamName === "new" ? null : streamName}
            templateId={templateId}
          />
        </div>
      </aside>
    </>
  );
}
