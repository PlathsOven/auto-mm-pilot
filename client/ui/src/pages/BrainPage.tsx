import { useState } from "react";
import { PipelineChart } from "../components/PipelineChart";
import { BlockDecompositionView } from "../components/studio/brain/BlockDecompositionView";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { AddBlockDrawer } from "../components/studio/brain/AddBlockDrawer";

/**
 * Studio → Brain.
 *
 * "What is the pipeline currently thinking?" — three stacked sections
 * showing the output of the currently-configured pipeline:
 *
 *   1. **Decomposition** — per-stream contributions to fair value + variance
 *      for the focused (asset, expiry) cell. Click a cell on Floor to focus.
 *   2. **Pipeline time series** — the existing PipelineChart (edge, variance,
 *      smoothed position over time) for the focused dimension.
 *   3. **Block inspector** — every block in the pipeline. The "Add manual
 *      block" button opens a drawer that calls `createManualBlock` for
 *      architects who want to drop a one-off block into the pipeline.
 */
export function BrainPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const openDrawer = () => setDrawerOpen(true);
  const closeDrawer = () => setDrawerOpen(false);
  const onBlockCreated = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <header>
        <h2 className="zone-header">Brain</h2>
        <p className="mt-1 text-[11px] text-mm-text-dim">
          The pipeline's current output, decomposed.
        </p>
      </header>

      <BlockDecompositionView />

      <section className="min-h-[400px] rounded-xl border border-mm-border/60 bg-mm-bg/40 p-3">
        <PipelineChart />
      </section>

      <EditableBlockTable
        refreshKey={refreshKey}
        headerAction={
          <button
            type="button"
            onClick={openDrawer}
            className="rounded-lg bg-mm-accent px-3 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-mm-accent/90"
          >
            + Add manual block
          </button>
        }
      />

      <AddBlockDrawer open={drawerOpen} onClose={closeDrawer} onCreated={onBlockCreated} />
    </div>
  );
}
