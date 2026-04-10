import { useCallback, useEffect, useState } from "react";
import { PipelineChart } from "../components/PipelineChart";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { BlockDrawer, type DrawerMode } from "../components/studio/brain/BlockDrawer";
import type { BlockRow } from "../types";

/**
 * Studio -> Brain.
 *
 * "What is the pipeline currently thinking?" — two stacked sections
 * showing the output of the currently-configured pipeline:
 *
 *   1. **Pipeline time series** — the existing PipelineChart (edge, variance,
 *      smoothed position over time) for the focused dimension.
 *   2. **Block inspector** — every block in the pipeline with column
 *      visibility, sorting, and filtering via TanStack Table. Clicking a
 *      row opens a detail drawer (editable for manual blocks, read-only
 *      for stream blocks). The "Add manual block" button opens the drawer
 *      in create mode.
 */
export function BrainPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  // Drawer state
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
      <header>
        <h2 className="zone-header">Brain</h2>
        <p className="mt-1 text-[11px] text-mm-text-dim">
          The pipeline's current output, decomposed.
        </p>
      </header>

      {/* Explicit height so PipelineChart's h-full has something to resolve
          against. Without this the chart renders at 0px on initial mount and
          only recovers on a window resize or full page reload. */}
      <section className="h-[520px] shrink-0 overflow-hidden rounded-xl border border-black/[0.08] bg-black/[0.03]">
        <PipelineChart />
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
