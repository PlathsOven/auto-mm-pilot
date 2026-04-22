import { memo } from "react";

/**
 * "+" tile rendered directly under the stream column in the Anatomy DAG.
 *
 * Click routes through `AnatomyCanvas.onNodeClick` → `openStream("new")`,
 * opening a blank `<StreamCanvas/>` in the right-side detail panel.
 * Deliberately mirrors the 200-wide stream node footprint so the column
 * reads as "streams, then a slot for one more."
 */
export const AddStreamNode = memo(function AddStreamNode() {
  return (
    <div
      className="flex w-[200px] cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-mm-accent/40 bg-mm-accent/[0.04] px-3 py-3 text-mm-accent/80 transition-colors hover:border-mm-accent/70 hover:bg-mm-accent/10 hover:text-mm-accent"
      title="New stream"
    >
      <span aria-hidden className="text-[14px] leading-none">+</span>
      <span className="text-[11px] font-semibold">New stream</span>
    </div>
  );
});
