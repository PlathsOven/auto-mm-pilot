import { useCallback, useState } from "react";
import { DesiredPositionGrid } from "../components/DesiredPositionGrid";
import { StreamStatusList } from "../components/floor/StreamStatusList";
import { BlockStreamPanel } from "../components/workbench/BlockStreamPanel";
import { BlockDrawer } from "../components/studio/brain/BlockDrawer";
import { InspectorColumn } from "../components/workbench/InspectorColumn";
import { UpdatesTicker } from "../components/workbench/UpdatesTicker";
import { PipelineChartPanel } from "../components/workbench/PipelineChartPanel";
import { useFocus } from "../providers/FocusProvider";
import type { BlockRow, ViewMode } from "../types";
import { blockKeyOf } from "../utils";

/**
 * Unified workbench — vertical-stack canvas + right-side InspectorColumn.
 *
 * Vertical canvas (top → bottom):
 *  - Updates ticker (horizontal scrolling strip, ~36px)
 *  - Position grid (with view-mode tabs; flex-1)
 *  - Pipeline chart (with linked view-mode tabs; flex-1, fills the panel)
 *  - Streams + Block Inspector (h-[260px], side-by-side)
 *
 * The position grid view-mode is owned here so the pipeline panel can mirror
 * it ("Linked" toggle in the pipeline header).
 *
 * Inspector lives in its own right-side column. Chat moved out of the rail
 * and into a bottom dock — see `<ChatDock/>` mounted by `<AppShell/>`.
 */
export function WorkbenchPage() {
  const { setFocus } = useFocus();
  const [gridViewMode, setGridViewMode] = useState<ViewMode>("position");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [blockRefreshKey, setBlockRefreshKey] = useState(0);

  const openCreateBlock = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const onBlockRowClick = useCallback(
    (block: BlockRow) => {
      // Single-click → focus the block. Editing happens in the inspector
      // (sidebar) for manual blocks; stream blocks render read-only there.
      setFocus({ kind: "block", key: blockKeyOf(block) });
    },
    [setFocus],
  );

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onSaved = useCallback(() => setBlockRefreshKey((k) => k + 1), []);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        <UpdatesTicker />

        <section className="glass-panel flex min-h-0 flex-1 overflow-hidden">
          <DesiredPositionGrid viewMode={gridViewMode} onViewModeChange={setGridViewMode} />
        </section>

        <section className="glass-panel flex min-h-0 flex-1 overflow-hidden">
          <PipelineChartPanel gridViewMode={gridViewMode} onGridViewModeChange={setGridViewMode} />
        </section>

        <div className="flex h-[260px] shrink-0 gap-2">
          <section className="glass-panel w-[240px] shrink-0 overflow-hidden">
            <StreamStatusList />
          </section>
          <section className="glass-panel flex min-w-0 flex-1 overflow-hidden">
            <BlockStreamPanel
              refreshKey={blockRefreshKey}
              onRowClick={onBlockRowClick}
              headerAction={
                <button
                  type="button"
                  onClick={openCreateBlock}
                  className="rounded-md bg-mm-accent px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-mm-accent/90"
                >
                  + Manual block
                </button>
              }
            />
          </section>
        </div>
      </main>

      <InspectorColumn />

      {/* BlockDrawer is now create-only — manual block edits happen in the
          BlockInspector sidebar. */}
      <BlockDrawer
        open={drawerOpen}
        mode="create"
        block={null}
        onClose={closeDrawer}
        onSaved={onSaved}
      />
    </div>
  );
}
