import { useCallback, useEffect, useState } from "react";
import { PipelineChart } from "../components/PipelineChart";
import { DecompositionPanel } from "../components/PipelineChart/DecompositionPanel";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { BlockDrawer, type DrawerMode } from "../components/studio/brain/BlockDrawer";
import { useSelection } from "../providers/SelectionProvider";
import { usePipelineTimeSeries } from "../hooks/usePipelineTimeSeries";
import { formatExpiry } from "../utils";
import type { BlockRow } from "../types";
import type { DecompositionMode } from "../components/PipelineChart/chartOptions";

/**
 * Brain — "what is the pipeline currently thinking?"
 *
 * Three stacked sections, each in its own glass panel:
 *
 *  1. **Decomposition** — current snapshot of the focused dimension. Cards
 *     show the four headline scalars (raw/smoothed desired position, fair,
 *     variance); bars below break each one down by block. Cards double as
 *     mode toggles for the bars.
 *
 *  2. **Pipeline** — three stacked time-series grids (position, fair,
 *     variance) over the recent history of the focused dimension.
 *
 *  3. **Block inspector** — every block in the pipeline as a sortable,
 *     filterable table; click a row for the detail drawer.
 *
 * The dimension selector lives in the page header so a single control drives
 * both the Decomposition and Pipeline sections — same `usePipelineTimeSeries`
 * hook hosted here, no duplicate fetches.
 */
export function BrainPage() {
  const { selectBlock, selectedBlocks, selectedDimension } = useSelection();
  const { dimensions, selected, setSelected, data, error, loading } =
    usePipelineTimeSeries(selectedDimension);

  const [decompositionMode, setDecompositionMode] = useState<DecompositionMode>("variance");
  const [refreshKey, setRefreshKey] = useState(0);

  // Block inspector drawer state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("create");
  const [selectedBlock, setSelectedBlock] = useState<BlockRow | null>(null);

  const openCreate = useCallback(() => {
    setDrawerMode("create");
    setSelectedBlock(null);
    setDrawerOpen(true);
  }, []);

  const onRowClick = useCallback((block: BlockRow) => {
    setSelectedBlock(block);
    setDrawerMode(block.source === "manual" ? "edit" : "inspect");
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onSaved = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleDimChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const [sym, exp] = e.target.value.split("|");
      setSelected({ symbol: sym, expiry: exp });
    },
    [setSelected],
  );

  const onBarBlockClick = useCallback(
    (blockName: string) => {
      if (selected) selectBlock(blockName, selected.symbol, selected.expiry);
    },
    [selected, selectBlock],
  );

  // ECharts (inside PipelineChart) measures its container at mount-time.
  // When BrainPage mounts as a sub-tab — without a full page reload — the
  // chart sometimes captures a transitional 0x0 layout from React's render
  // batch and stays stuck there. Dispatch a synthetic resize twice (once
  // after the next paint, once after a short delay) to nudge ECharts and
  // any other ResizeObserver consumers to remeasure once the real layout
  // has settled.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const t = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 120);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="zone-header">Brain</h2>
          <p className="mt-1 text-[11px] text-mm-text-dim">
            The pipeline's current output, decomposed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-mm-text-dim">
            Instrument
          </label>
          <select
            className="rounded-md border border-black/[0.08] bg-mm-surface-solid px-2 py-1 text-[11px] text-mm-text focus:border-mm-accent/40 focus:outline-none"
            value={selected ? `${selected.symbol}|${selected.expiry}` : ""}
            onChange={handleDimChange}
          >
            {dimensions.map((d) => (
              <option key={`${d.symbol}|${d.expiry}`} value={`${d.symbol}|${d.expiry}`}>
                {d.symbol} — {formatExpiry(d.expiry)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Decomposition — current snapshot, sized to its content */}
      <section className="glass-panel shrink-0 overflow-hidden">
        {data ? (
          <DecompositionPanel
            blocks={data.currentDecomposition.blocks}
            aggregated={data.currentDecomposition.aggregated}
            mode={decompositionMode}
            onModeChange={setDecompositionMode}
            selectedBlocks={selectedBlocks}
            onBlockClick={onBarBlockClick}
          />
        ) : (
          <div className="flex h-32 items-center justify-center text-[11px] text-mm-text-dim">
            {loading ? <span className="animate-pulse">Loading decomposition…</span> : "No data"}
          </div>
        )}
      </section>

      {/* Pipeline time series — fixed height so ECharts has something to
          measure against on first mount. */}
      <section className="h-[520px] shrink-0">
        <PipelineChart data={data} selected={selected} loading={loading} error={error} />
      </section>

      <EditableBlockTable
        refreshKey={refreshKey}
        onRowClick={onRowClick}
        headerAction={
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-mm-accent px-3 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-mm-accent/90"
          >
            + Add manual block
          </button>
        }
      />

      <BlockDrawer
        open={drawerOpen}
        mode={drawerMode}
        block={selectedBlock}
        onClose={closeDrawer}
        onSaved={onSaved}
      />
    </div>
  );
}
