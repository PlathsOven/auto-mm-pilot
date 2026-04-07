import { useState } from "react";
import { BlockDecompositionView } from "../components/lens/BlockDecompositionView";
import { TimeMachineScrubber } from "../components/lens/TimeMachineScrubber";
import { PipelineDetail } from "../components/lens/PipelineDetail";

type LensTab = "decomposition" | "time_machine" | "pipeline_detail";

const TABS: { id: LensTab; label: string }[] = [
  { id: "decomposition", label: "Decomposition" },
  { id: "time_machine", label: "Time Machine" },
  { id: "pipeline_detail", label: "Pipeline Detail" },
];

/**
 * Lens — the auditor surface.
 *
 * Three sub-tabs:
 *   - Decomposition: stream-level breakdown of a focused (asset, expiry) cell
 *   - Time Machine: scrub historical pipeline state
 *   - Pipeline Detail: existing PipelineChart + read-only block inspector
 *
 * The focused cell flows in from `SelectionProvider`, so a click in Floor →
 * Lens "Decomposition" picks up the same cell automatically.
 */
export function LensPage() {
  const [tab, setTab] = useState<LensTab>("decomposition");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-mm-border/40 bg-mm-surface/40 px-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
              tab === t.id
                ? "border-mm-accent text-mm-accent"
                : "border-transparent text-mm-text-dim hover:border-mm-border hover:text-mm-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === "decomposition" && <BlockDecompositionView />}
        {tab === "time_machine" && <TimeMachineScrubber />}
        {tab === "pipeline_detail" && <PipelineDetail />}
      </div>
    </div>
  );
}
