import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { RegisteredStreamStatus } from "../../../../types";

export interface StreamNodeData {
  streamName: string;
  status: RegisteredStreamStatus;
  keyCols: string[];
  selected?: boolean;
  [key: string]: unknown;
}

const STATUS_DOT: Record<RegisteredStreamStatus, string> = {
  PENDING: "bg-mm-warn",
  READY: "bg-mm-accent",
};

const STATUS_TEXT: Record<RegisteredStreamStatus, string> = {
  PENDING: "text-mm-warn",
  READY: "text-mm-accent",
};

/**
 * Custom React Flow node for a registered stream feeding the pipeline.
 *
 * Draggable, clickable, and linked via an edge to `unit_conversion`. Click
 * selection is handled by React Flow's `onNodeClick`; AnatomyCanvas opens
 * the StreamCanvas drawer on click.
 */
export const StreamNode = memo(function StreamNode({
  data,
  selected,
}: NodeProps) {
  const { streamName, status, keyCols } = data as StreamNodeData;
  return (
    <div
      className={`flex w-[200px] flex-col gap-1 rounded-xl border bg-black/[0.05] p-3 shadow-sm transition-colors ${
        selected
          ? "border-mm-accent/70 ring-2 ring-mm-accent/40"
          : "border-black/[0.08] hover:border-mm-accent/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
        <span className="truncate text-[11px] font-semibold text-mm-text">{streamName}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className={`text-[9px] font-medium uppercase ${STATUS_TEXT[status]}`}>
          {status}
        </span>
        <span className="truncate text-[9px] font-mono text-mm-text-dim">
          {keyCols.join(", ")}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-mm-accent/60 !bg-mm-accent/30"
      />
    </div>
  );
});
