import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface ConnectorNodeData {
  streamName: string;
  connectorName: string;
  displayName: string;
  inputLabel: string;
  outputLabel: string;
  [key: string]: unknown;
}

/**
 * Anatomy DAG node for a connector — sits to the left of its connector-fed
 * stream node. Visually distinct (subtle accent background + "⚙ CONNECTOR"
 * badge) so the trader sees the provenance of the stream's `raw_value` at
 * a glance: ``input → connector → stream → pipeline``.
 *
 * The node is non-clickable in v1 — selecting the downstream stream node
 * opens the Stream Canvas with the connector picker pre-selected. Click
 * surfaces here would duplicate that path.
 */
export const ConnectorNode = memo(function ConnectorNode({ data }: NodeProps) {
  const { connectorName, displayName, inputLabel } = data as ConnectorNodeData;
  return (
    <div className="flex w-[200px] flex-col gap-1 rounded-xl border border-mm-accent/30 bg-mm-accent/[0.07] p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-mm-accent/20 px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-wide text-mm-accent">
          ⚙ Connector
        </span>
        <span className="truncate text-[11px] font-semibold text-mm-text">
          {displayName}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="truncate text-[9px] font-mono text-mm-text-dim">
          {connectorName}
        </span>
        <span className="truncate text-[9px] font-mono text-mm-text-dim">
          {inputLabel}
        </span>
      </div>
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
