import { useCallback, useState } from "react";
import { DesiredPositionGrid } from "../components/DesiredPositionGrid";
import { StreamStatusList } from "../components/floor/StreamStatusList";
import { UpdatesFeed } from "../components/UpdatesFeed";
import { EditableBlockTable } from "../components/studio/brain/EditableBlockTable";
import { BlockDrawer, type DrawerMode } from "../components/studio/brain/BlockDrawer";
import { WorkbenchRail } from "../components/workbench/WorkbenchRail";
import { useFocus } from "../providers/FocusProvider";
import type { BlockRow } from "../types";

/**
 * Unified workbench page — replaces the old Floor + Brain split.
 *
 * Layout:
 *  - **Main canvas** (flex-grow): the position grid sits on top, with the
 *    streams + block table along the bottom edge so the trader's primary
 *    surfaces are all visible without panel-juggling.
 *  - **Right rail** (`<WorkbenchRail/>`): focus-driven Inspector + Chat tabs.
 *
 * Clicking anything in the canvas sets focus, which channels the rail. The
 * old fragile Floor↔Brain hop is gone — Brain's pipeline chart now lives in
 * the rail, channelled to whichever cell/symbol/expiry is focused.
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
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <section className="glass-panel flex min-h-[280px] flex-1 overflow-hidden">
          <DesiredPositionGrid />
        </section>

        <section className="grid h-[200px] shrink-0 grid-cols-12 gap-3">
          <div className="glass-panel col-span-3 overflow-hidden">
            <StreamStatusList />
          </div>
          <div className="glass-panel col-span-9 overflow-hidden">
            <UpdatesFeed />
          </div>
        </section>

        <section className="glass-panel max-h-[40%] shrink-0 overflow-hidden">
          <EditableBlockTable
            refreshKey={blockRefreshKey}
            onRowClick={onBlockRowClick}
            onRowEdit={onBlockRowEdit}
            headerAction={
              <button
                type="button"
                onClick={openCreateBlock}
                className="rounded-lg bg-mm-accent px-3 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-mm-accent/90"
              >
                + Add manual block
              </button>
            }
          />
        </section>
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
