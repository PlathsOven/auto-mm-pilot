import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

export interface LaneBandNodeData {
  label: string;
  width: number;
  height: number;
  tint: string;
  [key: string]: unknown;
}

/**
 * Non-interactive background rectangle marking one of the pipeline's
 * three data lanes (raw / calc / target). Emitted first in the node
 * array and assigned zIndex -1 so transform cards render on top; inner
 * content uses pointer-events-none so a click on a lane never swallows
 * a click meant for a transform card sitting above it.
 */
export const LaneBandNode = memo(function LaneBandNode({ data }: NodeProps) {
  const { label, width, height, tint } = data as LaneBandNodeData;
  return (
    <div
      className="pointer-events-none flex items-start justify-start rounded-2xl p-3"
      style={{
        width,
        height,
        backgroundColor: tint,
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-mm-text-dim/50">
        {label}
      </span>
    </div>
  );
});
