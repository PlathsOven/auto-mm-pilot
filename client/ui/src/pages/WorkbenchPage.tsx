import { useCallback, useState } from "react";
import { DesiredPositionGrid } from "../components/DesiredPositionGrid";
import { StreamStatusList } from "../components/floor/StreamStatusList";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { BlockDrawer, type DrawerMode } from "../components/studio/brain/BlockDrawer";
import { WorkbenchRail } from "../components/workbench/WorkbenchRail";
import { UpdatesTicker } from "../components/workbench/UpdatesTicker";
import { PipelineChartPanel } from "../components/workbench/PipelineChartPanel";
import { useFocus } from "../providers/FocusProvider";
import type { BlockRow } from "../types";

/**
 * Unified workbench page — replaces the old Floor + Brain split.
 *
 * Layout:
 *  - Top: Updates ticker (horizontal scroll, ~36px)
 *  - Middle (flex-1): Position Grid (left) + Pipeline Chart (right)
 *  - Bottom (h-[280px]): Data Streams (narrow) + Block Inspector (wide)
 *  - Right rail: Inspector + Chat tabs (collapsible)
 *
 * Clicking anything in the canvas sets workbench focus, which channels the
 * pipeline chart, the inspector rail, and (when "follow focus" is on) the
 * block table filters.
 */
export function WorkbenchPage() {
  const { setFocus } = useFocus();
  const [railSignal, setRailSignal] = useState<{ tab: "inspector" | "chat"; nonce: number } | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("create");
  const [selectedBlock, setSelectedBlock] = useState<BlockRow | null>(null);
  const [blockRefreshKey, setBlockRefreshKey] = useState(0);

  const openCreateBlock = useCallback(() => {
    setDrawerMode("create");
    setSelectedBlock(null);
    setDrawerOpen(true);
  }, []);

  const onBlockRowClick = useCallback(
    (block: BlockRow) => {
      setFocus({ kind: "block", name: block.block_name });
      setRailSignal({ tab: "inspector", nonce: Date.now() });
    },
    [setFocus],
  );

  const onBlockRowEdit = useCallback((block: BlockRow) => {
    setSelectedBlock(block);
    setDrawerMode(block.source === "manual" ? "edit" : "inspect");
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const onSaved = useCallback(() => setBlockRefreshKey((k) => k + 1), []);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        <UpdatesTicker />

        <div className="flex min-h-0 flex-1 gap-2">
          <section className="glass-panel flex flex-1 min-w-0 overflow-hidden">
            <DesiredPositionGrid />
          </section>
          <section className="glass-panel flex flex-1 min-w-0 overflow-hidden">
            <PipelineChartPanel />
          </section>
        </div>

        <div className="flex h-[300px] shrink-0 gap-2">
          <section className="glass-panel w-[240px] shrink-0 overflow-hidden">
            <StreamStatusList />
          </section>
          <section className="glass-panel flex min-w-0 flex-1 overflow-hidden">
            <EditableBlockTable
              refreshKey={blockRefreshKey}
              onRowClick={onBlockRowClick}
              onRowEdit={onBlockRowEdit}
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

      <WorkbenchRail signal={railSignal} />

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
