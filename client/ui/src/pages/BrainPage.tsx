import { useState } from "react";
import { PipelineChart } from "../components/PipelineChart";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { AddBlockDrawer } from "../components/studio/brain/AddBlockDrawer";

/**
 * Studio → Brain.
 *
 * "What is the pipeline currently thinking?" — two stacked sections
 * showing the output of the currently-configured pipeline:
 *
 *   1. **Pipeline time series** — the existing PipelineChart (edge, variance,
 *      smoothed position over time) for the focused dimension.
 *   2. **Block inspector** — every block in the pipeline. The "Add manual
 *      block" button opens a drawer that calls `createManualBlock` for
 *      architects who want to drop a one-off block into the pipeline.
 *
 * The previous top-level Decomposition section was removed because the
 * same information is already available as a hover-card on Floor cells
 * (`StreamAttributionHoverCard`) for quick inspection, and the full
 * breakdown lives inside `PipelineChart`'s left sidebar.
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

      {/* Explicit height so PipelineChart's h-full has something to resolve
          against. Without this the chart renders at 0px on initial mount and
          only recovers on a window resize or full page reload. */}
      <section className="h-[520px] shrink-0 overflow-hidden rounded-xl border border-mm-border/60 bg-mm-bg/40">
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
