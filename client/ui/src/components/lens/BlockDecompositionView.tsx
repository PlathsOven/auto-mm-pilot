import { useEffect, useMemo, useState } from "react";
import { useFocusedCell } from "../../hooks/useFocusedCell";
import { useStreamContributions } from "../../hooks/useStreamContributions";
import { useWebSocket } from "../../providers/WebSocketProvider";
import { useMode } from "../../providers/ModeProvider";
import { useSelection } from "../../providers/SelectionProvider";
import type { StreamContribution } from "../../hooks/useStreamContributions";
import { valColor } from "../../utils";

type SortKey = "magnitude" | "fair" | "variance" | "name";

/**
 * Lens Decomposition view.
 *
 * Shows stream-level contributions to fair value and variance for a focused
 * (asset, expiry) cell. Sortable, with bar visualisations and links to the
 * Studio canvas for each stream.
 */
export function BlockDecompositionView() {
  const focused = useFocusedCell();
  const { payload } = useWebSocket();
  const { setMode } = useMode();
  const { selectDimension } = useSelection();
  const { contributions, loading, error } = useStreamContributions(
    focused ? { asset: focused.asset, expiry: focused.expiry } : null,
  );
  const [sortKey, setSortKey] = useState<SortKey>("magnitude");
  const [filter, setFilter] = useState("");

  // Auto-pick the largest cell if nothing focused
  useEffect(() => {
    if (focused || !payload || payload.positions.length === 0) return;
    const top = [...payload.positions].sort(
      (a, b) => Math.abs(b.desiredPos) - Math.abs(a.desiredPos),
    )[0];
    if (top) selectDimension(top.asset, top.expiry);
  }, [focused, payload, selectDimension]);

  const sorted = useMemo(() => {
    if (!contributions) return [];
    let list = contributions;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter((c) => c.blockName.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "fair":
          return Math.abs(b.fair) - Math.abs(a.fair);
        case "variance":
          return b.variance - a.variance;
        case "name":
          return a.blockName.localeCompare(b.blockName);
        case "magnitude":
        default:
          return b.magnitude - a.magnitude;
      }
    });
  }, [contributions, sortKey, filter]);

  const maxMagnitude = useMemo(() => {
    if (sorted.length === 0) return 1;
    return Math.max(...sorted.map((s) => s.magnitude), 1e-9);
  }, [sorted]);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="zone-header">Decomposition</h2>
          <p className="mt-1 text-[11px] text-mm-text-dim">
            Stream-level contributions to fair value and variance.
            {focused && (
              <>
                {" "}Currently inspecting{" "}
                <span className="font-mono text-mm-accent">
                  {focused.asset} {focused.expiry}
                </span>
              </>
            )}
          </p>
        </div>
        {focused && (
          <button
            type="button"
            onClick={() => setMode("floor")}
            className="rounded-md border border-mm-border/40 px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:bg-mm-border/30 hover:text-mm-text"
          >
            ← View live
          </button>
        )}
      </header>

      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter streams…"
          className="form-input max-w-xs"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="form-input max-w-[160px]"
        >
          <option value="magnitude">Sort: |edge|</option>
          <option value="fair">Sort: |fair|</option>
          <option value="variance">Sort: variance</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      {!focused && (
        <p className="rounded-md border border-mm-border/40 bg-mm-bg/40 p-4 text-center text-[11px] text-mm-text-dim">
          Click a cell in Floor to inspect its decomposition here.
        </p>
      )}

      {focused && loading && (
        <p className="text-[11px] text-mm-text-dim">Loading decomposition…</p>
      )}

      {focused && error && (
        <p className="rounded-md border border-mm-error/40 bg-mm-error/10 p-2 text-[11px] text-mm-error">
          {error}
        </p>
      )}

      {focused && sorted.length > 0 && (
        <div className="flex flex-col gap-1.5 overflow-y-auto">
          {sorted.map((c) => (
            <ContributionRow
              key={c.blockName}
              c={c}
              maxMagnitude={maxMagnitude}
              onOpen={() => setMode("studio", `streams/${c.blockName}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContributionRow({
  c,
  maxMagnitude,
  onOpen,
}: {
  c: StreamContribution;
  maxMagnitude: number;
  onOpen: () => void;
}) {
  const widthPct = Math.max(2, (c.magnitude / maxMagnitude) * 100);
  return (
    <div className="rounded-lg border border-mm-border/40 bg-mm-bg/40 p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-mm-text">{c.blockName}</span>
        <div className="flex shrink-0 items-baseline gap-3 tabular-nums text-[10px]">
          <span className="text-mm-text-dim">space {c.spaceId}</span>
          <span className={valColor(c.edge)}>
            edge {c.edge >= 0 ? "+" : ""}
            {c.edge.toFixed(4)}
          </span>
          <span className="text-mm-text-dim">σ² {c.variance.toFixed(4)}</span>
          <button
            type="button"
            onClick={onOpen}
            className="text-mm-accent hover:underline"
          >
            edit stream →
          </button>
        </div>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-mm-bg-deep">
        <div
          className={`h-full ${c.edge >= 0 ? "bg-mm-accent/60" : "bg-mm-error/60"}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}
