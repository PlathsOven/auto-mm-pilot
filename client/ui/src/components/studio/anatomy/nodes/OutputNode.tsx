import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface OutputNodeData {
  [key: string]: unknown;
}

/**
 * Terminal node of the Anatomy canvas: "Desired Positions".
 *
 * Click → mode switches to Floor so the architect can see the live positions
 * produced by the currently-configured pipeline. Handled in AnatomyCanvas's
 * `onNodeClick`.
 */
export const OutputNode = memo(function OutputNode({ selected }: NodeProps) {
  return (
    <div
      className={`flex w-[220px] flex-col items-center gap-1 rounded-xl border bg-mm-accent/10 p-3 shadow-sm transition-colors ${
        selected
          ? "border-mm-accent/70 ring-2 ring-mm-accent/40"
          : "border-mm-accent/40 hover:border-mm-accent/60"
      }`}
    >
      <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-mm-accent">
        Desired Positions
      </span>
      <span className="text-center text-[10px] text-mm-text-dim">
        Live in Floor →
      </span>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
    </div>
  );
});
