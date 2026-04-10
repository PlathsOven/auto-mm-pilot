import { useEffect, useState } from "react";
import { StreamTable } from "../StreamTable";
import { NewStreamMenu } from "../NewStreamMenu";
import { StreamCanvas } from "../StreamCanvas";
import { useKeyboardShortcut } from "../../../hooks/useKeyboardShortcut";

export type StreamSidebarMode =
  | { kind: "closed" }
  | { kind: "list" }
  | { kind: "canvas"; streamName: string | null; templateId: string | null };

interface Props {
  mode: StreamSidebarMode;
  onOpenList: () => void;
  onOpenCanvas: (streamName: string | null, templateId: string | null) => void;
  onClose: () => void;
}

/**
 * Anatomy's streams drawer.
 *
 * Opens from the left side of the canvas and hosts EITHER the sortable
 * `StreamTable` for bulk comparison OR the `StreamCanvas` editor inline
 * (no separate right drawer). The user toggles between the two modes via
 * the "Streams list" header button on the canvas / the "← Streams list"
 * back button inside the canvas view.
 *
 * Default state is closed — Anatomy is just the pipeline graph until the
 * user clicks a stream node or the toolbar button.
 */
export function StreamSidebar({ mode, onOpenList, onOpenCanvas, onClose }: Props) {
  const [filter, setFilter] = useState("");

  useKeyboardShortcut("Escape", () => mode.kind !== "closed" && onClose(), { mod: false });

  // When a new stream name enters the URL, reset internal filter state so the
  // sidebar content feels fresh to the user.
  useEffect(() => {
    if (mode.kind === "canvas") setFilter("");
  }, [mode.kind === "canvas" ? mode.streamName : null]);

  const width = mode.kind === "canvas" ? 720 : 560;

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-black/[0.08] bg-white/85"
      style={{ width }}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3">
        {mode.kind === "list" && (
          <>
            <div>
              <h3 className="zone-header">Streams</h3>
              <p className="mt-0.5 text-[10px] text-mm-text-dim">
                Every data source feeding the pipeline.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <NewStreamMenu onOpenBlank={() => onOpenCanvas("new", null)} onOpenTemplate={(id) => onOpenCanvas("new", id)} />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
          </>
        )}
        {mode.kind === "canvas" && (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenList}
                className="rounded-md border border-black/[0.06] px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
              >
                ← Streams list
              </button>
              <div>
                <h3 className="zone-header">Stream Canvas</h3>
                <p className="mt-0.5 font-mono text-[10px] text-mm-text-dim">
                  {mode.streamName ?? "new"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-black/[0.04] hover:text-mm-text"
              title="Close (Esc)"
            >
              ✕
            </button>
          </>
        )}
      </header>

      {mode.kind === "list" && (
        <>
          <div className="border-b border-black/[0.06] px-4 py-3">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name or key column…"
              className="form-input w-full"
            />
          </div>
          <div className="flex-1 overflow-auto p-4">
            <StreamTable
              filter={filter}
              onFilterChange={setFilter}
              onOpenStream={(name) => onOpenCanvas(name, null)}
            />
          </div>
        </>
      )}

      {mode.kind === "canvas" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <StreamCanvas
            streamName={mode.streamName === "new" ? null : mode.streamName}
            templateId={mode.templateId}
          />
        </div>
      )}
    </aside>
  );
}
