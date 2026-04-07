import { useState } from "react";
import { BlockDecompositionView } from "../components/lens/BlockDecompositionView";
import { PipelineDetail } from "../components/lens/PipelineDetail";

type LensTab = "decomposition" | "pipeline_detail";

const TABS: { id: LensTab; label: string }[] = [
  { id: "decomposition", label: "Decomposition" },
  { id: "pipeline_detail", label: "Pipeline Detail" },
];

/**
 * Lens — the auditor surface.
 *
 * Two sub-tabs:
 *   - Decomposition: stream-level breakdown of a focused (asset, expiry) cell
 *   - Pipeline Detail: existing PipelineChart + read-only block inspector
 *
 * Time Machine will land once `snapshot_buffer.py`'s timestamp-lookup support
 * is verified and `GET /api/pipeline/snapshot_at` is exposed.
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
        {tab === "pipeline_detail" && <PipelineDetail />}
      </div>
    </div>
  );
}
