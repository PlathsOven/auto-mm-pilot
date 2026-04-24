/**
 * OpinionsPanel — tabbed bottom panel of the Workbench.
 *
 * Replaces the old 240px StreamStatusList + flex-1 EditableBlockTable
 * side-by-side layout with a single full-width panel containing two
 * tabs:
 *
 *  - Opinions — the trader-facing list of beliefs driving the book.
 *    Each row is one stream (data-driven) or one manual block (view).
 *  - Blocks   — the existing EditableBlockTable for engine verification.
 *               Stays per-dim today; M3 will collapse fan-outs into
 *               block families.
 *
 * The "+ New opinion" header action is only shown on the Opinions tab —
 * that's the authoring affordance, not a global action.
 */
import { useCallback, useState } from "react";
import { Tabs, type TabItem } from "../ui/Tabs";
import { useMode } from "../../providers/ModeProvider";
import { EditableBlockTable } from "../studio/brain/EditableBlockTable";
import { OpinionsTable } from "./OpinionsTable";
import type { BlockRow } from "../../types";

type OpinionsTab = "opinions" | "blocks";

const TABS: readonly TabItem<OpinionsTab>[] = [
  { value: "opinions", label: "Opinions" },
  { value: "blocks", label: "Blocks" },
] as const;

interface Props {
  /** Called when the user clicks the "+ New opinion" header button. */
  onCreateOpinion: () => void;
  /** Refresh trigger forwarded to the Blocks tab. */
  blockRefreshKey?: number;
  /** Click handler for a block row (sets focus for BlockInspector). */
  onBlockRowClick?: (block: BlockRow) => void;
}

export function OpinionsPanel({ onCreateOpinion, blockRefreshKey, onBlockRowClick }: Props) {
  const [tab, setTab] = useState<OpinionsTab>("opinions");
  const { navigate } = useMode();

  const gotoAnatomy = useCallback(() => navigate("anatomy"), [navigate]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-3 py-2">
        <div className="flex items-center gap-3">
          <h2 className="zone-header">Opinions</h2>
          <Tabs items={TABS} value={tab} onChange={setTab} size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={gotoAnatomy}
            className="rounded-md bg-mm-accent/8 px-2 py-0.5 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/10"
            title="Open Anatomy to create or edit data streams"
          >
            Manage in Anatomy →
          </button>
          {tab === "opinions" && (
            <button
              type="button"
              onClick={onCreateOpinion}
              className="btn-accent-gradient rounded-md px-2.5 py-1 text-[10px] font-semibold"
            >
              <span className="relative">+ New opinion</span>
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {tab === "opinions" ? (
          <OpinionsTable />
        ) : (
          <EditableBlockTable
            refreshKey={blockRefreshKey}
            onRowClick={onBlockRowClick}
          />
        )}
      </div>
    </section>
  );
}
