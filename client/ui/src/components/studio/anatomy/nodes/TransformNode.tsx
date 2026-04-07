import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface TransformNodeData {
  stepNumber: number;
  label: string;
  selectedImpl: string;
  subtitle: string;
  saving: boolean;
  [key: string]: unknown;
}

/**
 * Custom React Flow node for a pipeline transform step.
 *
 * Click-to-select populates AnatomyCanvas's NodeDetailPanel with the full
 * implementation picker + parameter editor. The node itself stays visually
 * clean — step number, label, current implementation chip, and a short
 * narrative.
 */
export const TransformNode = memo(function TransformNode({
  data,
  selected,
}: NodeProps) {
  const { stepNumber, label, selectedImpl, subtitle, saving } = data as TransformNodeData;
  return (
    <div
      className={`flex w-[240px] flex-col gap-1.5 rounded-xl border bg-mm-bg/80 p-3 shadow-sm transition-colors ${
        selected
          ? "border-mm-accent/70 ring-2 ring-mm-accent/40 ring-offset-2 ring-offset-mm-bg-deep"
          : "border-mm-border/60 hover:border-mm-accent/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mm-bg-deep text-[10px] font-semibold text-mm-accent">
          {stepNumber}
        </span>
        <h4 className="truncate text-xs font-semibold text-mm-text">{label}</h4>
        {saving && <span className="ml-auto text-[9px] text-mm-text-dim">saving…</span>}
      </div>
      <div>
        <span className="inline-block rounded bg-mm-accent/15 px-1.5 py-0.5 font-mono text-[9px] text-mm-accent">
          {selectedImpl}
        </span>
      </div>
      <p className="text-[10px] leading-relaxed text-mm-text-dim">{subtitle}</p>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
    </div>
  );
});
