import { useState } from "react";
import { StreamTable } from "./StreamTable";
import { NewStreamMenu } from "./NewStreamMenu";

/**
 * Studio Streams Library.
 *
 * Primary surface for architects: a sortable, filterable table of registered
 * streams for side-by-side parameter comparison. Templates are tucked behind
 * the `+ New stream` split button to keep them subordinate to live data.
 */
export function StreamLibrary() {
  const [filter, setFilter] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="zone-header">Streams Library</h2>
          <p className="mt-1 text-[11px] text-mm-text-dim">
            Every data source that contributes a view on fair value lives here.
          </p>
        </div>
        <NewStreamMenu />
      </header>

      <div className="mb-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or key column…"
          className="form-input max-w-xs"
        />
      </div>

      <StreamTable filter={filter} onFilterChange={setFilter} />
    </div>
  );
}
