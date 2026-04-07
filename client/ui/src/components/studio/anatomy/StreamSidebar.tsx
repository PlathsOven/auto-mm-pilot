import { useState } from "react";
import { StreamTable } from "../StreamTable";
import { NewStreamMenu } from "../NewStreamMenu";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Collapsible left-side drawer on the Anatomy canvas.
 *
 * Hosts the full `StreamTable` (sortable, filterable) + `NewStreamMenu`
 * split button for bulk comparison and creation. Streams also appear as
 * nodes on the canvas; the sidebar is the power-user alternative when the
 * architect needs to compare many streams side-by-side.
 */
export function StreamSidebar({ open, onClose }: Props) {
  const [filter, setFilter] = useState("");

  if (!open) return null;

  return (
    <aside className="absolute left-0 top-0 z-10 flex h-full w-[520px] flex-col border-r border-mm-border/60 bg-mm-surface/95 shadow-xl shadow-black/30 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-mm-border/40 px-4 py-3">
        <div>
          <h3 className="zone-header">Streams</h3>
          <p className="mt-0.5 text-[10px] text-mm-text-dim">
            Every data source feeding the pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NewStreamMenu />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[12px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="border-b border-mm-border/40 px-4 py-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or key column…"
          className="form-input w-full"
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        <StreamTable filter={filter} onFilterChange={setFilter} />
      </div>
    </aside>
  );
}
