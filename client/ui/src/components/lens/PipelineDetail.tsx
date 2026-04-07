import { PipelineChart } from "../PipelineChart";
import { ReadOnlyBlockTable } from "./ReadOnlyBlockTable";

/**
 * Lens Pipeline Detail tab.
 *
 * Hosts the existing `PipelineChart` (untouched) and the new
 * `ReadOnlyBlockTable` for inspection. Both pull live data through the
 * existing pipeline endpoints.
 */
export function PipelineDetail() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
      <header>
        <h2 className="zone-header">Pipeline Detail</h2>
        <p className="mt-1 text-[11px] text-mm-text-dim">
          Time-series breakdown plus a read-only block inspector.
        </p>
      </header>

      <section className="min-h-[400px] rounded-xl border border-mm-border/60 bg-mm-bg/40 p-3">
        <PipelineChart />
      </section>

      <section className="rounded-xl border border-mm-border/60 bg-mm-bg/40 p-3">
        <ReadOnlyBlockTable />
      </section>
    </div>
  );
}
