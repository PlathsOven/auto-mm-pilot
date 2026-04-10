import { useState, useCallback } from "react";
import { PipelineChart } from "../components/PipelineChart";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { AddBlockDrawer } from "../components/studio/brain/AddBlockDrawer";

/**
 * Studio -> Brain.
 *
 * Two stacked sections showing the pipeline's current output:
 *   1. Block Canvas — interactive SVG time-axis block editor (fair + variance lanes)
 *   2. Block Inspector — editable table of every block in the pipeline
 */
export function BrainPage() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const openDrawer = () => setDrawerOpen(true);
  const closeDrawer = () => setDrawerOpen(false);
  const onBlockCreated = () => setRefreshKey((k) => k + 1);

  // Canvas click-to-edit: open drawer for a specific block
  const handleEditBlock = useCallback((_streamName: string) => {
    setDrawerOpen(true);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
      <header>
        <h2 className="zone-header">Brain</h2>
        <p className="mt-1 text-[11px] text-mm-text-dim">
          The pipeline's current output, decomposed.
        </p>
      </header>

      {/* Block Canvas — flex to fill available space */}
      <section className="min-h-[400px] flex-1 overflow-hidden rounded-xl border border-black/[0.08] bg-black/[0.03]">
        <PipelineChart onEditBlock={handleEditBlock} />
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

      <AddBlockDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        onCreated={onBlockCreated}
      />
    </div>
  );
}
